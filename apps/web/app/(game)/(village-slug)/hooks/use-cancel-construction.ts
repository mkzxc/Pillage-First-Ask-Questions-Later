import { useMutation } from '@tanstack/react-query';
import { use } from 'react';
import type { GameEvent } from '@pillage-first/types/models/game-event';
import {
  currentVillageCacheKey,
  eventsCacheKey,
} from 'app/(game)/constants/query-keys';
import { ApiContext } from 'app/(game)/providers/api-provider';
import { useInvalidateAndPropagateQueries } from './use-invalidate-and-propagate-queries';

export const useCancelConstruction = () => {
  const { fetcher } = use(ApiContext);
  const invalidateAndPropagateQueries = useInvalidateAndPropagateQueries();

  return useMutation<void, Error, { eventId: GameEvent['id'] }>({
    mutationFn: async ({ eventId }) => {
      await fetcher(`/events/${eventId}`, { method: 'DELETE' });
    },
    onSuccess: async (_data, _vars, _onMutateResult, context) => {
      await invalidateAndPropagateQueries(context, [
        [eventsCacheKey],
        [currentVillageCacheKey],
      ]);
    },
  });
};
