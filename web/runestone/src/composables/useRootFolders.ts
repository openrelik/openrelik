/**
 * Root Folders Composable
 *
 * Coordinates fetching, mapping, and state management of root folders
 * from the OpenRelik REST API.
 */

import { ref, type Ref } from 'vue'
import { api, ApiError, errorMessage, type Folder } from '@/api'
import { setRootFolders, type Item } from '@/data/folders'

/**
 * Maps an API Folder contract into a UI Item.
 */
export function mapFolderToItem(folder: Folder): Item {
  return {
    id: folder.id,
    parent: folder.parent_id ?? null,
    kind: 'folder',
    name: folder.display_name || folder.name || `Folder ${folder.id}`,
    owner: folder.user?.display_name || folder.user?.username || 'user',
    created: folder.created_at ?? folder.updated_at ?? new Date().toISOString(),
    modified: folder.updated_at ?? folder.created_at ?? new Date().toISOString(),
  }
}

export interface UseRootFoldersReturn {
  isLoading: Ref<boolean>
  error: Ref<string | null>
  fetchRootFolders: () => Promise<Item[]>
}

export function useRootFolders(): UseRootFoldersReturn {
  const isLoading = ref(false)
  const error = ref<string | null>(null)

  async function fetchRootFolders(): Promise<Item[]> {
    isLoading.value = true
    error.value = null

    try {
      const folders = await api.folders.getRootFolders()
      const items = folders.map(mapFolderToItem)
      setRootFolders(items)
      return items
    } catch (err: unknown) {
      // Expired session: the client's onUnauthorized handler redirects to login.
      if (err instanceof ApiError && err.status === 401) return []

      // Leave the last loaded folders in place; the view shows the error next to them.
      const message = errorMessage(err, 'Failed to fetch root folders')
      error.value = message
      console.warn('[useRootFolders] Failed to fetch root folders:', message)
      return []
    } finally {
      isLoading.value = false
    }
  }

  return {
    isLoading,
    error,
    fetchRootFolders,
  }
}
