/**
 * Folder Loader Composable
 *
 * Loads what the explorer shows at a location from the OpenRelik REST API:
 * the root folders, or a folder's subfolders, plus the folder and its
 * ancestors when they are not known yet (a direct link or reload).
 *
 * Built on the query cache: listings seen in the last 30s cost no request,
 * older ones show at once and refresh in the background, and each listing
 * carries its own state so "loading", "empty" and "failed" never mix up.
 */

import { onScopeDispose } from 'vue'
import { api, ApiError, errorMessage, type Folder, type FolderDetail } from '@/api'
import { ensure, queryState, type QueryState } from '@/composables/useQueryCache'
import { findItem, setRootFolders, setSubfolders, upsertItems, type Item } from '@/data/folders'

/** Query cache keys for folder data. */
export const folderKeys = {
  root: 'folders:root',
  folder: (id: number) => `folder:${id}`,
  subfolders: (id: number) => `folder:${id}:subfolders`,
}

/**
 * Maps an API Folder contract into a UI Item. Listings do not include the
 * parent, so callers that know it pass it in.
 */
export function mapFolderToItem(folder: Folder, parent: number | null = null): Item {
  return {
    id: folder.id,
    parent: folder.parent_id ?? parent,
    kind: 'folder',
    name: folder.display_name || folder.name || `Folder ${folder.id}`,
    owner: folder.user?.display_name || folder.user?.username || 'user',
    created: folder.created_at ?? folder.updated_at ?? new Date().toISOString(),
    modified: folder.updated_at ?? folder.created_at ?? new Date().toISOString(),
  }
}

/** The folder and each of its ancestors as items, each pointing at its parent. */
function mapFolderChain(folder: FolderDetail): Item[] {
  const items: Item[] = []
  for (let node: FolderDetail | null = folder; node; node = node.parent) {
    items.push(mapFolderToItem(node, node.parent?.id ?? null))
  }
  return items
}

/** Whether the folder and every ancestor up to the root are loaded, so the path can be drawn. */
function isChainKnown(folderId: number): boolean {
  for (
    let item = findItem(folderId);
    item;
    item = item.parent === null ? undefined : findItem(item.parent)
  ) {
    if (item.parent === null) return true
  }
  return false
}

async function fetchRoot(signal: AbortSignal): Promise<void> {
  const folders = await api.folders.getRootFolders({ signal })
  setRootFolders(folders.map((folder) => mapFolderToItem(folder)))
}

async function fetchFolder(folderId: number, signal: AbortSignal): Promise<void> {
  upsertItems(mapFolderChain(await api.folders.getFolder(folderId, { signal })))
}

async function fetchSubfolders(
  folderId: number,
  signal: AbortSignal,
  background = false,
): Promise<void> {
  const subfolders = await api.folders.getSubfolders(folderId, { signal, background })
  setSubfolders(
    folderId,
    subfolders.map((subfolder) => mapFolderToItem(subfolder, folderId)),
  )
}

/**
 * Loads a folder's subfolders ahead of time, as a background request (not
 * shown as activity). If the user then opens the folder, the view joins this
 * request instead of starting another. Never rejects.
 */
export function prefetchSubfolders(folderId: number, signal: AbortSignal): Promise<void> {
  return ensure(
    folderKeys.subfolders(folderId),
    (fetchSignal) => fetchSubfolders(folderId, fetchSignal, true),
    { signal },
  ).catch(() => {
    // A failed prefetch is retried when the folder is opened (failed data counts as stale).
  })
}

export interface UseFolderLoaderReturn {
  /**
   * Makes sure the location is loaded: the root (no id) or a folder. Fresh
   * data costs nothing; `force` refetches (refresh, retry). Never rejects —
   * failures land in `listingState` / `folderState`.
   */
  load: (folderId?: number, options?: { force?: boolean }) => Promise<void>
  /** The root list (no id) or a folder's subfolders. */
  listingState: (folderId?: number) => QueryState
  /** A folder's own details; only fetched when not already known from a listing. */
  folderState: (folderId: number) => QueryState
}

export function useFolderLoader(): UseFolderLoaderReturn {
  // Leaving a location releases its requests; the cache aborts them unless
  // someone else still needs the result.
  let controller: AbortController | null = null

  async function load(folderId?: number, options: { force?: boolean } = {}): Promise<void> {
    controller?.abort()
    controller = new AbortController()
    const common = { signal: controller.signal, force: options.force }

    const requests =
      folderId === undefined
        ? [ensure(folderKeys.root, fetchRoot, common)]
        : [
            ensure(
              folderKeys.subfolders(folderId),
              (signal) => fetchSubfolders(folderId, signal),
              common,
            ),
            // Clicking into a folder already put it and its parents in the store.
            ...(options.force || !isChainKnown(folderId)
              ? [
                  ensure(
                    folderKeys.folder(folderId),
                    (signal) => fetchFolder(folderId, signal),
                    common,
                  ),
                ]
              : []),
          ]

    for (const result of await Promise.allSettled(requests)) {
      if (result.status === 'fulfilled') continue
      const err = result.reason
      // Expired session: the client's onUnauthorized handler redirects to login.
      // Missing folder: the view shows its not-found state.
      if (err instanceof ApiError && (err.status === 401 || err.status === 404)) continue
      console.warn('[useFolderLoader] Failed to load folders:', errorMessage(err, 'unknown error'))
    }
  }

  onScopeDispose(() => controller?.abort())

  return {
    load,
    listingState: (folderId?: number) =>
      queryState(folderId === undefined ? folderKeys.root : folderKeys.subfolders(folderId)),
    folderState: (folderId: number) => queryState(folderKeys.folder(folderId)),
  }
}
