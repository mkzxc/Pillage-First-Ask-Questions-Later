import { OutboundBuffer } from './buffer.ts';
import { BROKER_WORKER_SOURCE } from './generated/broker-worker-source.ts';
import { newTabId } from './ids.js';
import {
  type BrokerMessage,
  type CoordinationMessage,
  type DirectedReplyMessage,
  isLeaderReady,
  isTabPropagatedMessage,
  isWorkerMessage,
  isWorkerMessageError,
  type RelayMessage,
} from './protocol.ts';

type Role = 'leader' | 'follower';
type EventType = 'message' | 'messageerror';
type EventHandler =
  | ((event: MessageEvent) => void)
  | { handleEvent(event: MessageEvent): void };
const BROKER_WORKER_URL = `data:text/javascript;charset=utf-8,${encodeURIComponent(BROKER_WORKER_SOURCE)}`;

export class CrossTabWorker {
  onmessage: ((event: MessageEvent) => void) | null = null;
  onmessageerror: ((event: MessageEvent) => void) | null = null;

  // ── Configuration ─────────────────────────────────────────────────────────────

  readonly #factory: () => Worker;

  /**
   * To keep WORKER_INIT behavior it's important to be able to run
   * asynchronous logic after the creation of the Worker.
   * This flow has to be executed every time a new leader is elected otherwise
   * db related properties can be null.
   */
  readonly #init: () => void;

  // ── Identity ──────────────────────────────────────────────────────────────────

  readonly #tabId: string;
  readonly #lockName: string;
  readonly #channelId: string;

  // ── Runtime state ─────────────────────────────────────────────────────────────

  #role: Role = 'follower';
  #worker: Worker | null = null;
  #terminated = false;

  // Messages buffered while there is no direct channel to the leader yet.
  // Once a message is sent via #leaderPort it is no longer buffered — if the
  // leader dies mid-flight the message is lost (documented behavior).
  readonly #outboundBuffer = new OutboundBuffer();
  readonly #eventListeners = new Map<EventType, Set<EventHandler>>();

  // Resolving this callback releases the Web Lock and lets the next follower become leader.
  #releaseLockCallback: (() => void) | null = null;

  // Allows cancelling the queued blocking lock request when terminate() is called on a follower.
  #pendingLockRequest: AbortController | null = null;

  // Registered once in the constructor and removed in terminate() so beforeunload
  // triggers automatic cleanup when the tab navigates away or closes.
  readonly #unloadHandler = () => this.terminate();

  // ── Ports ─────────────────────────────────────────────────────────────────────

  /** This tab's connection to the broker SharedWorker. */
  #brokerPort: MessagePort;

  /** Direct MessagePort to the current leader tab (follower side only). */
  #leaderPort: MessagePort | null = null;

  /** Direct MessagePorts from each follower tab (leader side only). */
  readonly #followerPorts = new Map<string, MessagePort>();

  // ─────────────────────────────────────────────────────────────────────────────

  constructor(name: string, factory: () => Worker, init: () => void) {
    if (typeof navigator.locks === 'undefined') {
      throw new Error(
        'CrossTabWorker: Web Locks API is not available in this environment.',
      );
    }
    if (typeof SharedWorker === 'undefined') {
      throw new Error(
        'CrossTabWorker: SharedWorker is not available in this environment.',
      );
    }

    this.#factory = factory;
    this.#init = init;
    this.#tabId = newTabId();
    this.#lockName = `cross-tab-worker:${name}`;
    this.#channelId = this.#lockName;

    const sharedWorker = new SharedWorker(BROKER_WORKER_URL, {
      name: 'cross-tab-worker-broker',
    });
    this.#brokerPort = sharedWorker.port;
    this.#brokerPort.onmessage = (event: MessageEvent<BrokerMessage>) =>
      this.#handleBrokerMessage(event);
    this.#brokerPort.start();
    this.#brokerPort.postMessage({
      type: 'register',
      tabId: this.#tabId,
      channelId: this.#channelId,
    });

    globalThis.addEventListener('beforeunload', this.#unloadHandler);

    this.#tryBecomeLeader();
  }

  // ── Public API ────────────────────────────────────────────────────────────────

  get isLeader(): boolean {
    return this.#role === 'leader';
  }

  /** True once this tab has an open direct channel to the leader. */
  get hasLeaderPort(): boolean {
    return this.#leaderPort !== null;
  }

  postMessage(message: unknown, transfer: Transferable[] = []): void {
    if (this.#terminated) {
      return;
    }

    if (this.#role === 'leader' && this.#worker) {
      this.#worker.postMessage(message, transfer);
      return;
    }

    if (this.#leaderPort) {
      // Direct path — transferable objects move follower → leader → worker without copying.
      // Not buffered: if the leader dies after this point the message is lost,
      // which is documented behavior.
      this.#leaderPort.postMessage(
        { message, transfer } satisfies RelayMessage,
        transfer,
      );
      return;
    }

    // No direct channel yet — buffer until #openDirectChannelToLeader drains it.
    this.#outboundBuffer.push(message, transfer);
  }

  async fetcher<TArgs = unknown>(
    url: string,
    init?: Omit<RequestInit, 'body'> & {
      body?: TArgs;
    },
  ): Promise<MessageEvent> {
    const { port1, port2 } = new MessageChannel();

    return await navigator.locks.request(
      `${this.#lockName}-fetcher`,
      async () => {
        return new Promise((resolve, reject) => {
          const timeout = setTimeout(() => {
            port1.close();
            reject(new Error('CrossTabWorker: Worker request timed out'));
          }, 10_000);

          const handler = (event: MessageEvent) => {
            clearTimeout(timeout);
            resolve(event);
            port1.removeEventListener('message', handler);
            port1.close();
          };

          port1.addEventListener('message', handler);
          port1.start();

          this.postMessage(
            {
              type: 'WORKER_MESSAGE',
              url,
              method: init?.method ?? 'GET',
              body: init?.body ?? null,
              ...init,
            },
            [port2],
          );
        });
      },
    );
  }

  addEventListener(type: EventType, handler: EventHandler): void {
    if (!this.#eventListeners.has(type)) {
      this.#eventListeners.set(type, new Set());
    }
    this.#eventListeners.get(type)!.add(handler);
  }

  removeEventListener(type: EventType, handler: EventHandler): void {
    this.#eventListeners.get(type)?.delete(handler);
  }

  /**
   * Shut down this CrossTabWorker instance and release all resources.
   *
   * - **Leader**: terminates the underlying Worker and releases the Web Lock,
   *   triggering failover to a follower.
   * - **Follower**: closes ports and cancels the queued lock request.
   *
   * Safe to call from either role. Also called automatically on `beforeunload`.
   */
  terminate(): void {
    if (this.#terminated) {
      return;
    }
    this.#terminated = true;

    globalThis.removeEventListener('beforeunload', this.#unloadHandler);

    // Tell the broker to remove this tab from its registry.
    this.#brokerPort.postMessage({
      type: 'unregister',
      tabId: this.#tabId,
      channelId: this.#channelId,
    });
    this.#brokerPort.close();

    this.#leaderPort?.close();
    this.#leaderPort = null;

    if (this.#role === 'leader') {
      for (const port of this.#followerPorts.values()) {
        port.close();
      }
      this.#followerPorts.clear();
      this.#worker?.terminate();
      this.#worker = null;
      this.#releaseLockCallback?.();
      this.#releaseLockCallback = null;
    } else {
      // Cancel the queued blocking lock request so it never fires for a terminateed instance.
      this.#pendingLockRequest?.abort();
      this.#pendingLockRequest = null;
    }
  }

  // ── Broker message handling ───────────────────────────────────────────────────

  #handleBrokerMessage(event: MessageEvent<BrokerMessage>): void {
    if (this.#terminated) {
      return;
    }
    const message = event.data;

    if (message.type === 'leader-info') {
      // Broker sent the current leader's tabId immediately after we registered.
      // This happens when we join after a leader is already established.
      if (this.#role === 'follower') {
        this.#openDirectChannelToLeader(message.leaderTabId);
      }
      return;
    }

    if (message.type === 'incoming-port') {
      // A follower opened a direct MessageChannel and forwarded one end to us.
      // We must be the leader — store the port and start listening for relay messages.
      if (this.#role !== 'leader') {
        return;
      }
      const directFollowerPort = event.ports[0];
      if (!directFollowerPort) {
        return;
      }

      // Close any existing port for this follower before replacing it.
      this.#followerPorts.get(message.fromTabId)?.close();
      this.#followerPorts.set(message.fromTabId, directFollowerPort);
      directFollowerPort.start();

      directFollowerPort.onmessage = (
        relayEvent: MessageEvent<RelayMessage>,
      ) => {
        if (!this.#worker) {
          return;
        }
        const { message: workerMessage, transfer: transferList } =
          relayEvent.data;

        // Create a one-shot reply channel. The worker receives port2 in e.ports[0].
        // If the worker wants to reply zero-copy to this specific follower, it posts
        // a DirectedReplyMessage through that port instead of calling self.postMessage().
        const replyChannel = new MessageChannel();
        replyChannel.port1.start();
        replyChannel.port1.onmessage = (
          replyEvent: MessageEvent<DirectedReplyMessage>,
        ) => {
          replyChannel.port1.close();
          const { payload, transfer: replyTransferList } = replyEvent.data;
          // Re-transfer: objects moved worker → leader are now re-transferred leader → follower.
          directFollowerPort.postMessage(payload, replyTransferList ?? []);
        };

        this.#worker.postMessage(workerMessage, [
          ...(transferList ?? []),
          replyChannel.port2,
        ]);
      };
      return;
    }

    if (message.type === 'broadcast') {
      this.#handleCoordinationMessage(message.message);
    }
  }

  #handleCoordinationMessage(message: CoordinationMessage): void {
    if (isLeaderReady(message)) {
      // A new leader has been elected. Open a fresh direct channel to it.
      if (this.#role === 'follower') {
        this.#openDirectChannelToLeader(message.tabId);
      }
      return;
    }

    if (isWorkerMessage(message) && this.#role === 'follower') {
      this.#deliverToApplication('message', message.message);
      return;
    }

    if (isWorkerMessageError(message) && this.#role === 'follower') {
      this.#deliverToApplication('messageerror', message.message);
      return;
    }

    if (isTabPropagatedMessage(message)) {
      this.#deliverToApplication('message', message.message);
    }
  }

  // ── Follower: direct port handshake ───────────────────────────────────────────

  #openDirectChannelToLeader(leaderTabId: string): void {
    this.#leaderPort?.close();

    // port1 stays in this tab. port2 travels to the leader tab via the broker.
    const directChannel = new MessageChannel();
    this.#leaderPort = directChannel.port1;
    directChannel.port1.start();
    directChannel.port1.onmessage = (event: MessageEvent) => {
      // Directed zero-copy replies from the leader arrive here.
      this.#deliverToApplication('message', event.data);
    };

    this.#brokerPort.postMessage(
      {
        type: 'forward-port',
        toTabId: leaderTabId,
        fromTabId: this.#tabId,
        channelId: this.#channelId,
      },
      [directChannel.port2],
    );

    // Drain any messages that were buffered before this channel was ready.
    for (const buffered of this.#outboundBuffer.drain()) {
      directChannel.port1.postMessage(
        {
          message: buffered.message,
          transfer: buffered.transfer,
        } satisfies RelayMessage,
        buffered.transfer,
      );
    }
  }

  // ── Leader election ───────────────────────────────────────────────────────────

  #tryBecomeLeader(): void {
    navigator.locks.request(
      this.#lockName,
      { mode: 'exclusive', ifAvailable: true },
      async (lock) => {
        if (lock === null) {
          // Another tab holds the lock — become a follower and queue up as the next
          // leader. The Web Lock API guarantees our callback fires as soon as the
          // current leader's tab closes or calls terminate().
          this.#becomeFollower();
          this.#pendingLockRequest = new AbortController();
          try {
            await navigator.locks.request(
              this.#lockName,
              { mode: 'exclusive', signal: this.#pendingLockRequest.signal },
              async () => {
                if (this.#terminated) {
                  return;
                }
                this.#pendingLockRequest = null;
                await this.#becomeLeader();
              },
            );
          } catch (error) {
            // AbortError is expected when terminate() is called on a follower.
            if (error instanceof DOMException && error.name === 'AbortError') {
              return;
            }
            throw error;
          }
          return;
        }
        // We won the lock — become the leader and hold it until terminate() is called.
        await this.#becomeLeader();
      },
    );
  }

  // ── Leader role ───────────────────────────────────────────────────────────────

  async #becomeLeader(): Promise<void> {
    this.#role = 'leader';

    // Leaders don't need a direct port to themselves.
    this.#leaderPort?.close();
    this.#leaderPort = null;

    this.#brokerPort.postMessage({
      type: 'declare-leader',
      tabId: this.#tabId,
      channelId: this.#channelId,
    });

    this.#worker = this.#factory();
    this.#worker.onmessage = (event: MessageEvent) => {
      // Broadcast the worker's response to all follower tabs, then deliver locally.
      this.broadcastCoordinationMessage({
        type: 'worker-msg',
        message: event.data,
      });
      this.#deliverToApplication('message', event.data);
    };
    this.#worker.onmessageerror = (event: MessageEvent) => {
      this.broadcastCoordinationMessage({
        type: 'worker-msg-error',
        message: event.data,
      });
      this.#deliverToApplication('messageerror', event.data);
    };

    // Tell all followers a new leader is ready so they can open direct channels.
    this.broadcastCoordinationMessage({
      type: 'leader-ready',
      tabId: this.#tabId,
    });

    // Flush any messages that were buffered while waiting to win the election.
    for (const buffered of this.#outboundBuffer.drain()) {
      this.#worker.postMessage(buffered.message, buffered.transfer);
    }

    this.#init();

    // Hold the lock open until terminate() is called.
    await new Promise<void>((resolve) => {
      this.#releaseLockCallback = resolve;
    });
  }

  broadcastCoordinationMessage(message: CoordinationMessage): void {
    this.#brokerPort.postMessage({
      type: 'broadcast',
      fromTabId: this.#tabId,
      channelId: this.#channelId,
      message,
    });
  }

  // ── Follower role ─────────────────────────────────────────────────────────────

  #becomeFollower(): void {
    this.#role = 'follower';
    this.#init();
  }

  // ── Event delivery ────────────────────────────────────────────────────────────

  #deliverToApplication(type: EventType, data: unknown): void {
    const event = new MessageEvent(type, { data });
    if (type === 'message' && this.onmessage) {
      this.onmessage(event);
    }
    if (type === 'messageerror' && this.onmessageerror) {
      this.onmessageerror(event);
    }
    for (const handler of this.#eventListeners.get(type) ?? []) {
      if (typeof handler === 'function') {
        handler(event);
      } else {
        handler.handleEvent(event);
      }
    }
  }
}
