import type { ActionData } from './adapters/types';
import { LOCKS } from './const';
import { EventBus } from './core/EventBus';
import type {
  DWToTabMessage,
  SWToTabMessage,
  TabToDWMessage,
  TabToSWMessage,
} from './types';

//I don't like this generic here, probably it's acceptable to use unknown here
class Tab<T extends ActionData> {
  //This can't be shared across instances since only one tab must have this set different to null
  #currentDW: Worker | null = null;
  #pathSW;
  #pathDW;
  #idDW;
  #eventBus;

  constructor(
    pathServiceWorker: string | URL,
    pathWorker: string | URL,
    idWorker: string,
  ) {
    this.#pathSW = pathServiceWorker;
    this.#pathDW = pathWorker;
    this.#idDW = idWorker;
    this.#eventBus = new EventBus<T>();
  }

  private getActiveSW = async () => {
    try {
      const reg = await navigator.serviceWorker.ready;
      if (!reg.active) {
        throw new Error('SW not active yet');
      }
      return reg.active;
    } catch (error) {
      window.location.reload();
      throw error; //This won't ever happen, added only to narrow return type
    }
  };

  private postMessageToDW = (
    DW: Worker,
    message: TabToDWMessage,
    port: MessagePort,
  ) => {
    DW.postMessage(message, [port]);
  };

  private postMessageToSW = (
    SW: ServiceWorker,
    message: TabToSWMessage,
    port?: MessagePort,
  ) => {
    const transferable: Transferable[] = [];
    if (port) {
      transferable.push(port);
    }
    SW.postMessage(message, transferable);
  };

  private sendPortToSW = async (DW: Worker, idDW: string) => {
    const reg = await this.getActiveSW();
    const { port1, port2 } = new MessageChannel();
    this.postMessageToDW(DW, { type: 'SW_PORT', payload: port1 }, port1);

    await new Promise((resolve) => {
      const listener = (e: MessageEvent<SWToTabMessage>) => {
        if (e.data.type === 'PORT_READY') {
          navigator.serviceWorker.removeEventListener('message', listener);
          resolve(void 0);
        }
      };

      navigator.serviceWorker.addEventListener('message', listener);
      this.postMessageToSW(
        reg,
        { type: 'WORKER_PORT', payload: { port: port2, idDW } },
        port2,
      );
    });
  };

  private doesSWHaveDW = async (SW: ServiceWorker, idDW: string) => {
    return await new Promise<boolean>((resolve, reject) => {
      const { port1, port2 } = new MessageChannel();
      port1.onmessage = (e: MessageEvent<SWToTabMessage>) => {
        if (e.data.type !== 'HAS_WORKER_RESPONSE') {
          reject(
            `Unexpected message, should be: HAS_WORKER_RESPONSE instead of ${e.data.type}`,
          );
          return;
        }
        resolve(e.data.payload);
      };
      this.postMessageToSW(
        SW,
        { type: 'HAS_WORKER_REQUEST', payload: idDW },
        port2,
      );
    });
  };

  private createDW = async () => {
    await navigator.locks.request(LOCKS.createDW, async () => {
      const reg = await this.getActiveSW();

      const hasDW = await this.doesSWHaveDW(reg, this.#idDW);
      if (hasDW) {
        return;
      }

      const DW = new Worker(this.#pathDW, {
        type: 'module',
        name: this.#idDW,
      });

      await new Promise((resolve) => {
        DW.addEventListener('message', (e) => {
          if (e.data.type === 'READY') {
            resolve(void 0);
          }
        });
      });

      this.#currentDW = DW;
      await this.sendPortToSW(DW, this.#idDW);
    });
  };

  private publish: EventBus<T>['publish'] = (topic, ...args) => {
    if (topic === 'WORKER_TERMINATED') {
      this.#eventBus.publish('WORKER_TERMINATED');
      return;
    }

    this.#eventBus.publish(topic, ...args);
  };

  subscribe: EventBus<T>['subscribe'] = (...args) => {
    return this.#eventBus.subscribe(...args);
  };

  private terminateWorker = async () => {
    if (!this.#currentDW) {
      //TODO
      return;
    }

    const reg = await this.getActiveSW();

    const { port1, port2 } = new MessageChannel();

    const onMessage = (e: MessageEvent<DWToTabMessage>) => {
      if (e.data.type === 'PROCEED_TERMINATION') {
        this.#currentDW?.terminate();
        this.#currentDW = null;
        port1.onmessage = null;
        this.postMessageToSW(reg, { type: 'ELECTED_TAB_TERMINATED_WORKER' });
      }
    };
    port1.onmessage = onMessage;

    this.postMessageToDW(this.#currentDW, { type: 'CAN_TERMINATE' }, port2);
  };

  closeWorker = async () => {
    const reg = await this.getActiveSW();
    this.postMessageToSW(reg, { type: 'FIND_TAB_TO_TERMINATE_WORKER' });
  };

  setup = async () => {
    navigator.serviceWorker.addEventListener(
      'message',
      async (event: MessageEvent<SWToTabMessage>) => {
        if (event.data.type === 'ELECTED_TAB_SHOULD_TERMINATE_WORKER') {
          await this.terminateWorker();
        }

        if (event.data.type === 'WORKER_TERMINATED') {
          this.publish(event.data.type);
        }

        if (event.data.type === 'OP_SUCCESS') {
          this.publish(event.data.type, {
            key: event.data.payload.key,
            result: event.data.payload.result as ReturnType<T[keyof T]>,
          });
        }

        if (event.data.type === 'OP_ERROR') {
          this.publish(event.data.type, event.data.payload);
        }

        if (event.data.type === 'CREATE_WORKER') {
          await this.createDW();
        }

        if (event.data.type === 'RESEND_PORT') {
          if (this.#currentDW) {
            await this.sendPortToSW(this.#currentDW, this.#idDW);
          } else {
            await this.createDW();
          }
        }
      },
    );

    await navigator.serviceWorker.register(this.#pathSW, { type: 'module' });
    const reg = await this.getActiveSW();

    if (!navigator.serviceWorker.controller) {
      window.location.reload();
      return;
    }

    const hasDW = await this.doesSWHaveDW(reg, this.#idDW);

    if (!hasDW) {
      await this.createDW();
    }

    this.postMessageToSW(reg, { type: 'TAB_READY', payload: this.#idDW });
  };
}

export { Tab };
