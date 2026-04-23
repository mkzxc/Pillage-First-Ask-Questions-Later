import { TAB_TO_SW_MESSAGE_TYPES } from '../const';
import type { DWToSWMessage, SWToTabMessage, TabToSWMessage } from '../types';
import { Gateway } from './gateway';
import { DWService } from './services/DWService';
import { TabService } from './services/TabsService';

class SW {
  #sw: ServiceWorkerGlobalScope;
  //TODO Rename
  #map = new Map<string, { tabsService: TabService; dwService: DWService }>();
  #Gateway: Gateway;
  #header: string;

  constructor(header: string) {
    this.#sw = self as unknown as ServiceWorkerGlobalScope;
    this.#Gateway = new Gateway();
    this.#header = header;
  }

  private isPortAlive(idDW: string) {
    const portDW = this.#map.get(idDW)?.dwService.getMainPort();
    if (!portDW) {
      return false;
    }

    return new Promise<boolean>((resolve) => {
      const timeout = setTimeout(() => {
        const linked = this.#map.get(idDW);
        if (!linked) {
          console.error("Can't get linked services", idDW);
        } else {
          linked.dwService.resetPortsAndOwner();
        }
        resolve(false);
      }, 300);

      portDW.onmessage = (e: MessageEvent<DWToSWMessage>) => {
        if (e.data.type === 'PONG') {
          clearTimeout(timeout);
          resolve(true);
        }
      };

      portDW.postMessage({ type: 'PING' });
    });
  }

  private isTabMessage = (data: unknown): data is TabToSWMessage => {
    return Boolean(
      typeof data === 'object' &&
        data &&
        'type' in data &&
        typeof data.type === 'string' &&
        TAB_TO_SW_MESSAGE_TYPES.includes(
          data.type as (typeof TAB_TO_SW_MESSAGE_TYPES)[number],
        ),
    );
  };

  private sendMessageToTab = (
    wire: MessagePort | WindowClient,
    message: SWToTabMessage,
  ) => {
    wire.postMessage(message);
  };

  private getDWLinkedToTab = (id: string) => {
    //Find DW linked to Tab causing request
    const idDW = Array.from(this.#map.keys()).find((item) =>
      this.#map.get(item)?.tabsService.getTabs().has(id),
    );
    //Not the cleanest but should be good enough
    const linkedDW = this.#map.get(idDW || '');

    if (!linkedDW || !idDW) {
      throw new Error(`Can't find DW linked to ${id}`);
    }

    return { id: idDW, worker: linkedDW };
  };

  initializeSW = (
    onInstall?: (sw: ServiceWorkerGlobalScope, event: ExtendableEvent) => void,
    onActivate?: (sw: ServiceWorkerGlobalScope, event: ExtendableEvent) => void,
  ) => {
    this.#sw.addEventListener('install', (event) => {
      onInstall?.(this.#sw, event);
    });

    this.#sw.addEventListener('activate', (event) => {
      onActivate?.(this.#sw, event);
    });

    this.#sw.addEventListener('message', async (event) => {
      if (!this.isTabMessage(event.data)) {
        console.error(
          'Unsupported message, SW expects TabToSWMessage',
          event.data,
        );
        return;
      }

      if (event.data.type === 'TAB_READY') {
        const source = event.source as WindowClient;
        const linked = this.#map.get(event.data.payload);
        if (!linked) {
          console.error(
            `Can't get linked services\nPayload: ${event.data.payload}\nType: ${event.data.type}`,
          );
        } else {
          linked.tabsService.addTab(source.id);
        }
      }

      if (event.data.type === 'HAS_WORKER_REQUEST') {
        const isAlive = await this.isPortAlive(event.data.payload);
        this.sendMessageToTab(event.ports[0], {
          type: 'HAS_WORKER_RESPONSE',
          payload: isAlive,
        });
      }

      if (event.data.type === 'WORKER_PORTS') {
        const source = event.source as WindowClient;
        const linked = this.#map.get(event.data.payload.idDW);
        const ports = {
          main: event.data.payload.ports[0],
          custom: event.data.payload.ports[1],
        };
        if (!linked) {
          const dwService = new DWService();
          const tabsService = new TabService();
          dwService.setPortsAndOwner(ports, source.id);
          this.#Gateway.setupListenerDWCustomMessages(
            event.data.payload.ports[1],
            (payload) =>
              tabsService.notifyReadyTabs(
                this.#sw,
                payload,
                'WORKER_CUSTOM_MESSAGE',
              ),
          );

          this.#map.set(event.data.payload.idDW, {
            tabsService,
            dwService,
          });
        } else {
          linked.dwService.setPortsAndOwner(ports, source.id);
          this.#Gateway.setupListenerDWCustomMessages(
            event.data.payload.ports[1],
            (payload) =>
              linked.tabsService.notifyReadyTabs(
                this.#sw,
                payload,
                'WORKER_CUSTOM_MESSAGE',
              ),
          );
        }
        this.sendMessageToTab(source, { type: 'PORT_READY' });
      }

      if (event.data.type === 'FIND_TAB_TO_TERMINATE_WORKER') {
        try {
          const { worker: linkedDW } = this.getDWLinkedToTab(
            (event.source as Client).id,
          );
          await linkedDW.dwService.setupClosing(() =>
            linkedDW.tabsService.notifyReadyTabs(
              this.#sw,
              null,
              'ELECTED_TAB_SHOULD_TERMINATE_WORKER',
            ),
          );
        } catch (error) {
          let message =
            'Error in SW upon receiving FIND_TAB_TO_TERMINATE_WORKER';
          if (error instanceof Error) {
            message += `: ${error.message}`;
          }
          console.error(message);
        }
      }

      if (event.data.type === 'ELECTED_TAB_TERMINATED_WORKER') {
        try {
          const { id: idDW, worker: linkedDW } = this.getDWLinkedToTab(
            (event.source as Client).id,
          );
          linkedDW.dwService.confirmClosing();
          linkedDW.tabsService.notifyReadyTabs(
            this.#sw,
            null,
            'WORKER_TERMINATED',
          );
          this.#map.delete(idDW);
        } catch (error) {
          let message = 'Error in SW upon receiving WORKER_TERMINATED';
          if (error instanceof Error) {
            message += `: ${error.message}`;
          }
          console.error(message);
        }
      }

      if (event.data.type === 'PROPAGATE_MESSAGE') {
        try {
          const { worker: linkedDW } = this.getDWLinkedToTab(
            (event.source as Client).id,
          );
          linkedDW.tabsService.notifyReadyTabs(
            this.#sw,
            event.data.payload,
            'PROPAGATED_MESSAGE',
          );
        } catch (error) {
          let message = 'Error in SW upon receiving PROPAGATE_MESSAGE';
          if (error instanceof Error) {
            message += `: ${error.message}`;
          }
          console.error(message);
        }
      }
    });

    this.#sw.addEventListener('fetch', (event) => {
      //Only request with user supplied header will be custom handled
      const keyHeader = event.request.headers.get(this.#header);

      if (typeof keyHeader === 'string' && keyHeader.length > 0) {
        //Find DW linked to Tab causing request
        const idDW = Array.from(this.#map.keys()).find((id) =>
          this.#map.get(id)?.tabsService.getTabs().has(event.clientId),
        );
        //Not the cleanest but should be good enough
        const linkedDW = this.#map.get(idDW || '');

        if (!linkedDW) {
          console.error(
            "Error in SW fetch handler: can't find linked DW",
            event.clientId,
          );
        } else {
          event.respondWith(
            this.#Gateway.handleFetch(
              keyHeader,
              event,
              this.#sw,
              (sw: ServiceWorkerGlobalScope) => {
                return linkedDW.dwService.ensurePortsAreReady(
                  sw,
                  linkedDW.tabsService.getReadyTab,
                );
              },
              linkedDW.dwService.getMainPort,
              linkedDW.tabsService.notifyReadyTabs,
            ),
          );
        }
      }
    });
  };
}

export { SW };
