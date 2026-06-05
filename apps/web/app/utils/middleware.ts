const doesGameWorldExist = async (
  serverSlug: string,
  rootHandle: FileSystemDirectoryHandle,
) => {
  try {
    await rootHandle.getDirectoryHandle(serverSlug);
    return true;
  } catch {
    return false;
  }
};

const clearLegacyGameWorld = async (
  serverSlug: string,
  rootHandle: FileSystemDirectoryHandle,
) => {
  try {
    await rootHandle.getFileHandle(`${serverSlug}.json`);
  } catch (error) {
    /**
     * Since we're checking for legacy implementation, log error only if not related to not found
     * https://developer.mozilla.org/en-US/docs/Web/API/FileSystemDirectoryHandle/getFileHandle#exceptions
     */
    if (error instanceof DOMException && error.NOT_FOUND_ERR) {
      return;
    }
    console.error(`Error clearing legacy game world: ${error}`);
  }
};

export const checkGameWorld = async (serverSlug: string): Promise<boolean> => {
  const root = await navigator.storage.getDirectory();
  const rootHandle = await root.getDirectoryHandle(
    'pillage-first-ask-questions-later',
    {
      create: true,
    },
  );

  clearLegacyGameWorld(serverSlug, rootHandle);

  return doesGameWorldExist(serverSlug, rootHandle);
};
