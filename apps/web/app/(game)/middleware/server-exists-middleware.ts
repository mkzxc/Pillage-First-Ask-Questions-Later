import { redirect } from 'react-router';
import type { Route } from '@react-router/types/app/(game)/+types/layout';
import { checkGameWorld } from 'app/utils/middleware';

// Check whether server even exists
export const serverExistsMiddleware: Route.ClientMiddlewareFunction = async ({
  params,
}) => {
  const { serverSlug } = params;

  const gameWorldExists = await checkGameWorld(serverSlug);

  if (!gameWorldExists) {
    throw redirect(`/game/${serverSlug}/not-found`);
  }
};
