import type { SWToTabMessage } from '../../types';

class TabService {
  #readyTabs = new Set<string>();

  private updateReadyTabs = async (sw: ServiceWorkerGlobalScope) => {
    const allClients = await sw.clients.matchAll({ type: 'window' });
    const aliveIds = new Set(allClients.map((c) => c.id));

    for (const id of this.#readyTabs) {
      if (!aliveIds.has(id)) {
        this.#readyTabs.delete(id);
      }
    }
  };

  addTab = (id: string) => {
    this.#readyTabs.add(id);
  };

  getReadyTab = async (sw: ServiceWorkerGlobalScope) => {
    await this.updateReadyTabs(sw);

    const allClients = await sw.clients.matchAll({ type: 'window' });
    if (allClients.length < 1) {
      throw new Error('There are no open tabs');
    }
    //This could be considered a redundant check
    const readyClients = allClients.filter((c) => this.#readyTabs.has(c.id));
    if (readyClients.length > 0) {
      return readyClients[0];
    }

    return new Promise<WindowClient>((resolve, reject) => {
      //This is a bit dirty but it seems to do the job
      const interval = setInterval(async () => {
        const allClients = await sw.clients.matchAll({ type: 'window' });

        if (allClients.length < 1) {
          clearInterval(interval);
          reject(new Error('There are no open tabs'));
          return;
        }

        const readyClients = allClients.filter((c) =>
          this.#readyTabs.has(c.id),
        );
        if (readyClients.length > 0) {
          clearInterval(interval);
          resolve(readyClients[0]);
        }
      }, 100);
    });
  };

  notifyReadyTabs = async (
    sw: ServiceWorkerGlobalScope,
    data: unknown,
    type: SWToTabMessage['type'],
  ) => {
    const allClients = await sw.clients.matchAll({
      includeUncontrolled: true,
      type: 'window',
    });

    allClients
      .filter((c) => this.#readyTabs.has(c.id))
      .forEach((client) => {
        client.postMessage({
          payload: { ...(data as object) },
          type: type,
        });
      });
  };

  getTabs = () => {
    return this.#readyTabs;
  };
}

export { TabService };
