import { LOCKS } from '../../const';

class DWService {
  #portToSW: MessagePort | null = null;
  #owner: string | null = null;
  #ready: { promise: Promise<unknown>; resolve: () => void } | null = null;
  #recovery: Promise<void> | null = null;
  #close: { resolve: () => void; reject: () => void } | null = null;

  getPort = () => {
    return this.#portToSW;
  };

  resetPortAndOwner = () => {
    this.#portToSW = null;
    this.#owner = null;
  };

  setPortAndOwner = (port: MessagePort, clientId: string) => {
    this.#portToSW = port;
    this.#owner = clientId;
    if (this.#ready !== null) {
      this.#ready.resolve();
      this.#ready = null;
    }
  };

  private handleRecovery = async (
    sw: ServiceWorkerGlobalScope,
    getClient: (sw: ServiceWorkerGlobalScope) => Promise<WindowClient>,
  ) => {
    try {
      this.resetPortAndOwner();

      const client = await getClient(sw);

      let resolve: (value?: unknown) => void = () => {};
      const promise = new Promise((res) => {
        resolve = res;
      });

      this.#ready = {
        promise,
        resolve,
      };

      client.postMessage({
        type: !this.#portToSW ? 'CREATE_WORKER' : 'RESEND_PORT',
      });

      await this.#ready.promise;
    } finally {
      //This has to be cleared otherwise next failures can't trigger recovery again
      this.#recovery = null;
    }
  };

  ensurePortIsReady = async (
    sw: ServiceWorkerGlobalScope,
    getClient: (sw: ServiceWorkerGlobalScope) => Promise<WindowClient>,
  ) => {
    if (this.#recovery) {
      await this.#recovery;
      return;
    }

    if (this.#portToSW && this.#owner) {
      const allClients = await sw.clients.matchAll({ type: 'window' });
      const ownerAlive = allClients.some((c) => c.id === this.#owner);
      if (ownerAlive) {
        return;
      }
    }

    this.#recovery = this.handleRecovery(sw, getClient);
    await this.#recovery;
  };

  setupClosing = async (onStart: () => void) => {
    await navigator.locks.request(LOCKS.closeDW, async () => {
      await new Promise<void>((resolve, reject) => {
        this.#close = { resolve, reject };
        onStart();
      });
    });
  };

  confirmClosing = () => {
    this.#close?.resolve();
    this.#close = null;
  };
}

export { DWService };
