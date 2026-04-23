import { useQueryClient } from '@tanstack/react-query';
import { debounce } from 'moderndash';
import {
  createContext,
  type PropsWithChildren,
  useEffect,
  useMemo,
} from 'react';
import type { EventApiNotificationEvent } from '@pillage-first/types/api-events';
import type { Server } from '@pillage-first/types/models/server';
import { eventsCacheKey } from 'app/(game)/constants/query-keys';
// import { useApiWorker } from 'app/(game)/hooks/use-api-worker';
import { cachesToClearOnResolve } from 'app/(game)/providers/constants/caches-to-clear-on-resolve';
import { isEventResolvedSuccessfullyNotificationMessageEvent } from 'app/(game)/providers/guards/api-notification-event-guards';
import {
  createWorkerFetcher,
  type Fetcher,
} from 'app/(game)/providers/utils/worker-fetch';
import { useApiTab } from '../hooks/use-api-tab';

type PropagatedInvalidationMessage = {
  type: 'INVALIDATION';
  queryKeys: string[][];
  source: string;
};

function isPropagatedInvalidationMessage(
  data: unknown,
): data is PropagatedInvalidationMessage {
  return Boolean(
    typeof data === 'object' &&
      data &&
      'type' in data &&
      data.type === 'INVALIDATION' &&
      'queryKeys' in data &&
      Array.isArray(data.queryKeys) &&
      'source' in data &&
      typeof data.source === 'string',
  );
}

type ApiProviderProps = {
  serverSlug: Server['slug'];
};

type ApiContextReturn = {
  apiTab: ReturnType<typeof useApiTab>['apiTab'];
  fetcher: Fetcher;
};

export const ApiContext = createContext<ApiContextReturn>(
  {} as ApiContextReturn,
);

export const ApiProvider = ({
  children,
  serverSlug,
}: PropsWithChildren<ApiProviderProps>) => {
  const queryClient = useQueryClient();
  // const { apiWorker } = useApiWorker(serverSlug);
  const { apiTab } = useApiTab(serverSlug);

  useEffect(() => {
    if (!apiTab) {
      return;
    }

    const DEBOUNCE_MS = 150;
    const debouncedInvalidators = new Map<
      string,
      ReturnType<typeof debounce>
    >();

    const makeDebouncedInvalidator = (
      keyId: string,
      resolvedKey: readonly unknown[],
    ) => {
      const fn = async () => {
        try {
          await queryClient.invalidateQueries({
            queryKey: Array.from(resolvedKey),
          });
        } catch (error) {
          console.error('Failed to invalidate query', resolvedKey, error);
        }
      };

      // create debounced wrapper and store it
      const debounced = debounce(fn, DEBOUNCE_MS);
      debouncedInvalidators.set(keyId, debounced);
      return debounced;
    };

    const handleMessage = (event: MessageEvent<EventApiNotificationEvent>) => {
      if (!isEventResolvedSuccessfullyNotificationMessageEvent(event)) {
        return;
      }

      const gameEvent = event.data;
      const { type } = gameEvent;

      // @ts-expect-error - We can't provide a generic here, so TS doesn't know which event it's dealing with
      const cachesToClear = cachesToClearOnResolve[type](gameEvent);

      for (const queryKey of cachesToClear) {
        const keyId = JSON.stringify(queryKey);

        const resolvedKey = Array.isArray(queryKey) ? queryKey : [queryKey];
        const debounced =
          debouncedInvalidators.get(keyId) ??
          makeDebouncedInvalidator(keyId, resolvedKey);
        debounced();
      }

      // also debounce invalidation of the global events cache key
      const eventsKeyId = JSON.stringify(eventsCacheKey);

      const evResolvedKey = [eventsCacheKey];
      const evDebounced =
        debouncedInvalidators.get(eventsKeyId) ??
        makeDebouncedInvalidator(eventsKeyId, evResolvedKey);
      evDebounced();
    };

    // apiWorker.addEventListener('message', handleMessage);

    // return () => {
    //   apiWorker.removeEventListener('message', handleMessage);

    //   // Attempt to cancel pending debounced calls
    //   for (const debounced of debouncedInvalidators.values()) {
    //     if (typeof debounced.cancel === 'function') {
    //       debounced.cancel();
    //     }
    //   }
    //   debouncedInvalidators.clear();
    // };

    const onMessage = apiTab.subscribe('WORKER_CUSTOM_MESSAGE', (payload) => {
      //@ts-expect-error Testing purposes
      handleMessage({ data: payload });
    });

    return () => {
      onMessage?.();

      for (const debounced of debouncedInvalidators.values()) {
        if (typeof debounced.cancel === 'function') {
          debounced.cancel();
        }
      }
      debouncedInvalidators.clear();
    };
  }, [apiTab, queryClient]);

  useEffect(() => {
    const onMessage = apiTab.subscribe('PROPAGATED_MESSAGE', (payload) => {
      if (
        isPropagatedInvalidationMessage(payload) &&
        payload.source !== apiTab.getUID()
      ) {
        payload.queryKeys.forEach((arr) => {
          queryClient.invalidateQueries({ queryKey: arr as string[] });
        });
      }
    });

    return () => {
      onMessage?.();
    };
  }, [queryClient, apiTab]);

  const value: ApiContextReturn = useMemo(() => {
    return {
      apiTab,
      fetcher: createWorkerFetcher(),
    };
  }, [apiTab]);

  return <ApiContext value={value}>{children}</ApiContext>;
};
