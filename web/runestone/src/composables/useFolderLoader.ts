/**
 * Folder Loader Composable
 *
 * Loads what the explorer shows at a location from the OpenRelik REST API:
 * the root folders, or a folder's subfolders, plus the folder and its
 * ancestors when they are not known yet (a direct link or reload).
 *
 * The top level is paginated on the server (`GET /folders/all/`): each page
 * is its own cache entry and its folder ids are kept in `rootPages.ts`.
 *
 * Built on the query cache: listings seen in the last 30s cost no request,
 * older ones show at once and refresh in the background, and each listing
 * carries its own state so "loading", "empty" and "failed" never mix up.
 */

import { onScopeDispose } from 'vue'
import { api, ApiError, errorMessage, type Folder, type FolderDetail, type FolderFile } from '@/api'
import { ensure, queryState, type QueryState } from '@/composables/useQueryCache'
import {
  findItem,
  setFiles,
  setSubfolders,
  upsertItems,
  upsertListed,
  type Item,
} from '@/data/folders'
import { setRootPage } from '@/data/rootPages'
import { useSettingsStore } from '@/stores/settings'

/** Query cache keys for folder data. */
export const folderKeys = {
  /** Every top-level page of every size: invalidate this when the list shifts. */
  rootPrefix: 'folders:root:',
  /** One top-level page. Size first, so `folders:root:s40:` covers one size. */
  rootPage: (page: number, size: number) => `folders:root:s${size}:p${page}`,
  folder: (id: number) => `folder:${id}`,
  subfolders: (id: number) => `folder:${id}:subfolders`,
  files: (id: number) => `folder:${id}:files`,
  role: (id: number) => `folder:${id}:role`,
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
    ownerUsername: folder.user?.username,
    ownerAvatar: folder.user?.profile_picture_url || undefined,
    created: folder.created_at ?? folder.updated_at ?? new Date().toISOString(),
    modified: folder.updated_at ?? folder.created_at ?? new Date().toISOString(),
  }
}

/** Maps a listed file into a UI Item. The listing says which folder it is in. */
export function mapFileToItem(file: FolderFile, parent: number): Item {
  return {
    id: file.id,
    parent,
    kind: 'file',
    name: file.display_name || `File ${file.id}`,
    owner: file.user?.display_name || file.user?.username || 'user',
    ownerUsername: file.user?.username,
    ownerAvatar: file.user?.profile_picture_url || undefined,
    created: file.created_at ?? file.updated_at ?? new Date().toISOString(),
    modified: file.updated_at ?? file.created_at ?? new Date().toISOString(),
    size: file.filesize ?? 0,
    mime: file.magic_mime ?? undefined,
    dataType: file.data_type,
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

/** Where the top-level list is: which page, at which page size. */
export interface RootPageRef {
  page: number
  size: number
}

async function fetchRootPage(
  { page, size }: RootPageRef,
  signal: AbortSignal,
  background = false,
): Promise<void> {
  const result = await api.folders.getAllFolders({ page, pageSize: size }, { signal, background })
  upsertListed(result.folders.map((folder) => mapFolderToItem(folder)))
  setRootPage(folderKeys.rootPage(page, size), {
    ids: result.folders.map((folder) => folder.id),
    total: result.total_count,
    page,
    size,
  })
}

/**
 * Loads a top-level page ahead of time, as a background request. Opening
 * that page then joins this request instead of starting another. Never rejects.
 */
export function prefetchRootPage(ref: RootPageRef, signal: AbortSignal): Promise<void> {
  return ensure(
    folderKeys.rootPage(ref.page, ref.size),
    (fetchSignal) => fetchRootPage(ref, fetchSignal, true),
    { signal },
  ).catch(() => {
    // Retried when the page is opened (failed data counts as stale).
  })
}

/** The page size the operator chose (Settings → explorer). */
const currentPageSize = (): number => useSettingsStore().settings.explorer.pageSize

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

async function fetchFiles(
  folderId: number,
  signal: AbortSignal,
  background = false,
): Promise<void> {
  const files = await api.folders.getFolderFiles(folderId, { signal, background })
  // The listing includes deleted files; the explorer must not.
  setFiles(
    folderId,
    files.filter((file) => !file.is_deleted).map((file) => mapFileToItem(file, folderId)),
  )
}

/**
 * Loads what a folder holds — subfolders and files — ahead of time, as
 * background requests (not shown as activity). If the user then opens the
 * folder, the view joins these instead of starting its own. Never rejects.
 */
export function prefetchFolderContents(folderId: number, signal: AbortSignal): Promise<void> {
  const swallow = () => {
    // A failed prefetch is retried when the folder is opened (failed data counts as stale).
  }
  return Promise.all([
    ensure(
      folderKeys.subfolders(folderId),
      (fetchSignal) => fetchSubfolders(folderId, fetchSignal, true),
      { signal },
    ).catch(swallow),
    ensure(folderKeys.files(folderId), (fetchSignal) => fetchFiles(folderId, fetchSignal, true), {
      signal,
    }).catch(swallow),
  ]).then(swallow)
}

/**
 * A folder's listing is its subfolders and its files together: it is only
 * loaded when both are, and it fails when either does. Without this, a folder
 * with no subfolders would claim to be empty while its files were still
 * loading. The folder's own answer comes first, so a 404 still reads as
 * "no such folder".
 */
function combined(subfolders: QueryState, files: QueryState): QueryState {
  const status: QueryState['status'] =
    subfolders.status === 'error' || files.status === 'error'
      ? 'error'
      : subfolders.status === 'success' && files.status === 'success'
        ? 'success'
        : subfolders.status === 'idle' && files.status === 'idle'
          ? 'idle'
          : 'loading'

  return {
    status,
    isFetching: subfolders.isFetching || files.isFetching,
    error: subfolders.error ?? files.error,
    errorStatus: subfolders.errorStatus ?? files.errorStatus,
    fetchedAt: Math.min(subfolders.fetchedAt, files.fetchedAt),
  }
}

export interface UseFolderLoaderReturn {
  /**
   * Makes sure the location is loaded: a top-level page (no id; page 1 and the
   * chosen size unless given) or a folder. Fresh data costs nothing; `force`
   * refetches (refresh, retry). Never rejects — failures land in
   * `listingState` / `folderState`.
   */
  load: (folderId?: number, options?: { force?: boolean } & Partial<RootPageRef>) => Promise<void>
  /** A top-level page (no id) or a folder's subfolders. */
  listingState: (folderId?: number, root?: Partial<RootPageRef>) => QueryState
  /** A folder's own details; only fetched when not already known from a listing. */
  folderState: (folderId: number) => QueryState
}

export function useFolderLoader(): UseFolderLoaderReturn {
  // Leaving a location releases its requests; the cache aborts them unless
  // someone else still needs the result.
  let controller: AbortController | null = null

  async function load(
    folderId?: number,
    options: { force?: boolean } & Partial<RootPageRef> = {},
  ): Promise<void> {
    controller?.abort()
    controller = new AbortController()
    const common = { signal: controller.signal, force: options.force }
    const root = { page: options.page ?? 1, size: options.size ?? currentPageSize() }

    const requests =
      folderId === undefined
        ? [
            ensure(
              folderKeys.rootPage(root.page, root.size),
              (signal) => fetchRootPage(root, signal),
              common,
            ),
          ]
        : [
            ensure(
              folderKeys.subfolders(folderId),
              (signal) => fetchSubfolders(folderId, signal),
              common,
            ),
            ensure(folderKeys.files(folderId), (signal) => fetchFiles(folderId, signal), common),
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
    listingState: (folderId?: number, root: Partial<RootPageRef> = {}) =>
      folderId === undefined
        ? queryState(folderKeys.rootPage(root.page ?? 1, root.size ?? currentPageSize()))
        : combined(
            queryState(folderKeys.subfolders(folderId)),
            queryState(folderKeys.files(folderId)),
          ),
    folderState: (folderId: number) => queryState(folderKeys.folder(folderId)),
  }
}
