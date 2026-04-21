import { Tab } from '@mkzxc/cross-tab-without-shared-worker--alpha/tab';
import { useSuspenseQuery } from '@tanstack/react-query';
import type { paths } from '@pillage-first/api/open-api';
import ApiWorker from '@pillage-first/api?worker&url';
import type { Server } from '@pillage-first/types/models/server';

type Paths = typeof paths;
type Path = keyof Paths;

type Config = Record<Path, (payload: { method: any; body: any }) => unknown>;

const createApiTab = async (serverSlug: string): Promise<Tab<Config>> => {
  const url = new URL(ApiWorker, import.meta.url);
  url.searchParams.set('server-slug', serverSlug);

  const tab = new Tab<Config>(url, serverSlug);
  await tab.setup();
  return tab;
};

export const useApiTab = (serverSlug: Server['slug']) => {
  const { data: apiTab } = useSuspenseQuery({
    queryKey: ['api-tab', serverSlug],
    queryFn: async () => createApiTab(serverSlug),
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: Number.POSITIVE_INFINITY,
  });

  return {
    apiTab,
  };
};
