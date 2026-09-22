/**
 * Folder Loader Composable
 *
 * Loads what the explorer shows at a location from the OpenRelik REST API:
 * the root folders, or a folder together with its ancestors (for the path)
 * and its subfolders.
 */

import { onScopeDispose, ref, type Ref } from 'vue'
import { api, ApiError, errorMessage, type Folder, type FolderDetail } from '@/api'
import { setRootFolders, setSubfolders, upsertItems, type Item } from '@/data/folders'

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

export interface UseFolderLoaderReturn {
  isLoading: Ref<boolean>
  error: Ref<string | null>
  /** Loads the root folders (no id) or the given folder and its subfolders. */
  load: (folderId?: number) => Promise<void>
}

export function useFolderLoader(): UseFolderLoaderReturn {
  const isLoading = ref(false)
  const error = ref<string | null>(null)
  // Only the latest load may touch isLoading/error. Navigating away supersedes
  // it and cancels its requests, so a slow connection is not kept busy with
  // folders the user has already left.
  let latest = 0
  let controller: AbortController | null = null

  async function fetchInto(folderId: number | undefined, signal: AbortSignal): Promise<void> {
    if (folderId === undefined) {
      const folders = await api.folders.getRootFolders({ signal })
      setRootFolders(folders.map((folder) => mapFolderToItem(folder)))
      return
    }

    const [folder, subfolders] = await Promise.all([
      api.folders.getFolder(folderId, { signal }),
      api.folders.getSubfolders(folderId, { signal }),
    ])
    upsertItems(mapFolderChain(folder))
    setSubfolders(
      folderId,
      subfolders.map((subfolder) => mapFolderToItem(subfolder, folderId)),
    )
  }

  async function load(folderId?: number): Promise<void> {
    const request = ++latest
    controller?.abort()
    controller = new AbortController()
    isLoading.value = true
    error.value = null

    try {
      await fetchInto(folderId, controller.signal)
    } catch (err: unknown) {
      if (request !== latest) return
      // Expired session: the client's onUnauthorized handler redirects to login.
      // Missing folder: the view shows its own not-found state.
      if (err instanceof ApiError && (err.status === 401 || err.status === 404)) return

      // Leave what was loaded before in place; the view shows the error next to it.
      const message = errorMessage(err, 'Failed to load folders')
      error.value = message
      console.warn('[useFolderLoader] Failed to load folders:', message)
    } finally {
      if (request === latest) isLoading.value = false
    }
  }

  onScopeDispose(() => controller?.abort())

  return {
    isLoading,
    error,
    load,
  }
}
