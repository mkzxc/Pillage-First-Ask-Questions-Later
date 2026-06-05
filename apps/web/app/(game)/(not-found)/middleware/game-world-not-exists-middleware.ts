import { redirect } from 'react-router';
import type { Route } from '@react-router/types/app/(game)/(not-found)/+types/page';
import { checkGameWorld } from 'app/utils/middleware';

export const gameWorldNotExistsMiddleware: Route.ClientMiddlewareFunction =
  async ({ params }) => {
    const { serverSlug } = params;

    const gameWorldExists = await checkGameWorld(serverSlug);

    if (gameWorldExists) {
      throw redirect(`/game/${serverSlug}/v-1/resources`);
    }
  };
