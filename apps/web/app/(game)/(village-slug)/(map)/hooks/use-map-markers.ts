import { useMutation, useSuspenseQuery } from '@tanstack/react-query';
import { use } from 'react';
import type { MapMarker } from '@pillage-first/types/models/map-marker';
import { mapMarkersCacheKey } from 'app/(game)/constants/query-keys';
import { ApiContext } from 'app/(game)/providers/api-provider';
import { useInvalidateAndPropagateQueries } from '../../hooks/use-invalidate-and-propagate-queries';

export const useMapMarkers = () => {
  const { fetcher } = use(ApiContext);
  const invalidateAndPropagateQueries = useInvalidateAndPropagateQueries();

  const { data: mapMarkers } = useSuspenseQuery<MapMarker[]>({
    queryKey: [mapMarkersCacheKey],
    queryFn: async () => {
      const { data } = await fetcher<MapMarker[]>('/me/map-markers');
      return data;
    },
  });

  const { mutate: createMapMarker } = useMutation<
    void,
    Error,
    { tileId: number }
  >({
    mutationFn: async ({ tileId }) => {
      await fetcher('/me/map-markers', {
        method: 'POST',
        body: { tileId },
      });
    },
    onSuccess: async (_data, _vars, _onMutateResult, context) => {
      await invalidateAndPropagateQueries(context, [[mapMarkersCacheKey]]);
    },
  });

  const { mutate: deleteMapMarker } = useMutation<
    void,
    Error,
    { tileId: number }
  >({
    mutationFn: async ({ tileId }) => {
      await fetcher(`/me/map-markers/${tileId}`, {
        method: 'DELETE',
      });
    },
    onSuccess: async (_data, _vars, _onMutateResult, context) => {
      await invalidateAndPropagateQueries(context, [[mapMarkersCacheKey]]);
    },
  });

  return {
    mapMarkers,
    createMapMarker,
    deleteMapMarker,
  };
};
