import { use, useCallback } from 'react';
import { ApiContext } from 'app/(game)/providers/api-provider';
import { invalidateQueries } from 'app/utils/react-query';

export const useInvalidateAndPropagateQueries = () => {
  const { apiWorker } = use(ApiContext);

  const func = useCallback(
    async (...args: Parameters<typeof invalidateQueries>) => {
      await Promise.all([
        invalidateQueries(...args),
        apiWorker.broadcastCoordinationMessage({
          type: 'tab-propagated-message',
          message: { eventKey: 'invalidation', queryKeys: args[1] },
        }),
      ]);
    },
    [apiWorker],
  );

  return func;
};
