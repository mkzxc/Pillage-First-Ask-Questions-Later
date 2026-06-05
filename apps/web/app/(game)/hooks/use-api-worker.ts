import { useSuspenseQuery } from '@tanstack/react-query';
import { OutdatedDatabaseSchemaError } from '@pillage-first/api/errors';
import ApiWorker from '@pillage-first/api?worker&url';
import { CrossTabWorker } from '@pillage-first/cross-tab';
import type { Server } from '@pillage-first/types/models/server';
import { isNotificationMessageEvent } from 'app/(game)/providers/guards/api-notification-event-guards';

const createWorkerWithReadySignal = (
  serverSlug: string,
): Promise<CrossTabWorker> => {
  return new Promise((resolve, reject) => {
    const url = new URL(ApiWorker, import.meta.url);
    url.searchParams.set('server-slug', serverSlug);
    const sharedWorker = new CrossTabWorker(
      'pillage-first-cross-tab-worker',
      () => new Worker(url.toString(), { type: 'module' }),
      () => {
        const handleWorkerInitializationMessage = (event: MessageEvent) => {
          if (!isNotificationMessageEvent(event)) {
            return;
          }

          if (event.data.eventKey === 'event:database-initialization-success') {
            sharedWorker.removeEventListener(
              'message',
              handleWorkerInitializationMessage,
            );
            resolve(sharedWorker);
          }

          if (event.data.eventKey === 'event:database-initialization-error') {
            sharedWorker.removeEventListener(
              'message',
              handleWorkerInitializationMessage,
            );
            reject(new OutdatedDatabaseSchemaError());
          }
        };

        sharedWorker.addEventListener(
          'message',
          handleWorkerInitializationMessage,
        );

        sharedWorker.postMessage({
          type: 'WORKER_INIT',
        });
      },
    );
  });
};

export const useApiWorker = (serverSlug: Server['slug']) => {
  const { data: apiWorker } = useSuspenseQuery({
    queryKey: ['api-worker', serverSlug],
    queryFn: async () => createWorkerWithReadySignal(serverSlug),
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: Number.POSITIVE_INFINITY,
  });

  return {
    apiWorker,
  };
};
