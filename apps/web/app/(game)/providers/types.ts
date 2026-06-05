import type { QueryKey } from '@tanstack/react-query';

export type PropagationEvent = {
  eventKey: 'invalidation';
  queryKeys: QueryKey[];
};
