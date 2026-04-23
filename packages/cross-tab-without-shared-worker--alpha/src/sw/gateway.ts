import { LOCKS } from '../const';
import type { DWToSWMessage, SWToDWMessage, SWToTabMessage } from '../types';

class Gateway {
  //TODO Overriding the onmessage callback really doesn't seem like a good solution
  //TODO Should there be a retry instead of just returning 500 and waiting for the next request?
  private sendToDW = (
    message: SWToDWMessage,
    getDWPort: () => MessagePort | null,
  ) => {
    return new Promise((resolve, reject) => {
      const port = getDWPort();
      if (!port) {
        reject(new Error('No worker port'));
        return;
      }

      const timeout = setTimeout(
        () => reject(new Error('Worker response timed out')),
        5000,
      );

      port.onmessage = (e: MessageEvent<DWToSWMessage>) => {
        clearTimeout(timeout);

        switch (e.data.type) {
          case 'SUCCESS':
            resolve(e.data);
            break;
          case 'FAILURE':
            reject(new Error(e.data.error));
            break;
          default:
            reject(new Error(`Unexpected message event data: ${e.data}`));
        }
      };

      port.postMessage(message);
    });
  };

  setupListenerDWCustomMessages = (
    port: MessagePort,
    notifyTabs: (
      payload: Extract<DWToSWMessage, { type: 'CUSTOM' }>['payload'],
    ) => Promise<void>,
  ) => {
    port.onmessage = (e: MessageEvent<DWToSWMessage>) => {
      if (e.data.type === 'CUSTOM') {
        notifyTabs(e.data.payload);
      }
    };
  };

  handleFetch = async (
    key: string,
    event: FetchEvent,
    sw: ServiceWorkerGlobalScope,
    ensureDWPort: (sw: ServiceWorkerGlobalScope) => Promise<void>,
    getDWPort: () => MessagePort | null,
    notifyTabs: (
      sw: ServiceWorkerGlobalScope,
      data: unknown,
      type: SWToTabMessage['type'],
    ) => Promise<void>,
  ) => {
    return await navigator.locks.request(LOCKS.customOperation, async () => {
      try {
        const body = (await event.request.json()) as object;
        await ensureDWPort(sw);
        const result = await this.sendToDW(
          {
            type: 'OP',
            payload: { data: { ...body }, key },
          },
          getDWPort,
        );
        const response = (result as { result: unknown }).result;
        await notifyTabs(
          sw,
          {
            result: response,
            key,
          },
          'OP_SUCCESS',
        );
        return new Response(JSON.stringify(response));
      } catch (err) {
        const error = err as Error;
        console.error('SW operation error:', error.message);
        await notifyTabs(
          sw,
          {
            result: error.message,
            key,
          },
          'OP_ERROR',
        );
        return new Response(JSON.stringify({ error: error.message }), {
          status: 500,
        });
      }
    });
  };
}

export { Gateway };
