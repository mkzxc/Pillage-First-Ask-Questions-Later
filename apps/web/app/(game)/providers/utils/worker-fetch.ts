// import { OutdatedDatabaseSchemaError } from '@pillage-first/api/errors';
// import { isControllerMessageErrorNotificationMessageEvent } from 'app/(game)/providers/guards/api-notification-event-guards';
import { CUSTOM_HEADER } from 'app/const';

export type Fetcher = ReturnType<typeof createWorkerFetcher>;

// export const createWorkerFetcher = (worker: Worker) => {
//   return async <TData = void, TArgs = unknown>(
//     url: string,
//     init?: Omit<RequestInit, 'body'> & { body?: TArgs },
//   ): Promise<{ data: TData }> => {
//     const { port1, port2 } = new MessageChannel();

//     return new Promise((resolve, reject) => {
//       const timeout = setTimeout(() => {
//         port1.close();
//         reject(new Error('Worker request timed out'));
//       }, 10_000);

//       const handler = (event: MessageEvent) => {
//         const { data } = event;

//         clearTimeout(timeout);
//         port1.removeEventListener('message', handler);
//         port1.close();

//         if (isControllerMessageErrorNotificationMessageEvent(event)) {
//           const { error } = data;

//           if (error.message.includes('sqlite3 result code 1')) {
//             reject(new OutdatedDatabaseSchemaError());
//             return;
//           }

//           reject(error);
//           return;
//         }

//         resolve(data);
//       };

//       port1.addEventListener('message', handler);
//       port1.start();

//       worker.postMessage(
//         {
//           type: 'WORKER_MESSAGE',
//           url,
//           method: init?.method ?? 'GET',
//           body: init?.body ?? null,
//           ...init,
//         },
//         [port2],
//       );
//     });
//   };
// };

//TODO Temporary fix?
function isValidBody(
  body: unknown,
): body is string | URLSearchParams | FormData | Blob | BufferSource {
  return (
    typeof body === 'string' ||
    body instanceof URLSearchParams ||
    body instanceof FormData ||
    body instanceof Blob ||
    body instanceof ArrayBuffer
  );
}

export const createWorkerFetcher = () => {
  return async <TData = void, TArgs = unknown>(
    url: string,
    init?: Omit<RequestInit, 'body'> & { body?: TArgs },
  ): Promise<{ data: TData }> => {
    if (!isValidBody(init?.body)) {
      //TODO Replicate old error logic if possible
      throw new Error(`Body invalid for: ${url}`);
    }

    const headers = new Headers(init.headers);
    headers.append(CUSTOM_HEADER, url);

    const response = await fetch(url, {
      ...init,
      method: init?.method ?? 'GET',
      body: init.body ?? null,
      headers,
    });

    const result = await response.json();

    return result;
  };
};
