import { OutdatedDatabaseSchemaError } from '@pillage-first/api/errors';
import type { CrossTabWorker } from '@pillage-first/cross-tab';
import { isControllerMessageErrorNotificationMessageEvent } from 'app/(game)/providers/guards/api-notification-event-guards';

export type Fetcher = ReturnType<typeof createWorkerFetcher>;

export const createWorkerFetcher = (worker: CrossTabWorker) => {
  return async <TData = void, TArgs = unknown>(
    url: string,
    init?: Omit<RequestInit, 'body'> & { body?: TArgs },
  ): Promise<{ data: TData }> => {
    const event = await worker.fetcher(url, init);
    const { data } = event;
    if (isControllerMessageErrorNotificationMessageEvent(event)) {
      const { error } = data;

      if (error.message.includes('sqlite3 result code 1')) {
        throw new OutdatedDatabaseSchemaError();
      }

      throw error;
    }
    return data;
  };
};
