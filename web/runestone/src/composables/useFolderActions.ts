/**
 * Folder Actions Composable
 *
 * Creates and renames folders through the OpenRelik REST API and mirrors the
 * result into the reactive items store. State is module-scoped, so the
 * explorer can show work started anywhere (listing, prompt `mkdir`):
 *
 * - `pendingCreates`: folders the server has not confirmed yet, shown as
 *   placeholder rows in their parent until the real folder replaces them.
 * - `savingIds`: folders whose rename is in flight. The new name shows right
 *   away; a second rename waits until the first one settles.
 * - `error`: why the last create or rename failed.
 */

import { reactive, readonly, ref, type Ref } from 'vue'
import { api, errorMessage } from '@/api'
import { folderKeys, mapFolderToItem } from '@/composables/useFolderLoader'
import { markFresh } from '@/composables/useQueryCache'
import { findItem, upsertItems, type Item } from '@/data/folders'

export interface PendingFolder {
  /** Stable key for the placeholder row; not a server id. */
  key: string
  parent: number | null
  name: string
}

const error = ref<string | null>(null)
const pendingCreates = reactive<PendingFolder[]>([])
const savingIds = reactive(new Set<number>())
let nextPendingKey = 0

export interface UseFolderActionsReturn {
  /** Why the last create or rename failed, until the next action or `clearError()`. */
  error: Readonly<Ref<string | null>>
  clearError: () => void
  /** Folders being created inside `parent`, oldest first. Reactive when read in a computed. */
  pendingIn: (parent: number | null) => PendingFolder[]
  /** Ids of folders whose rename is still being saved. */
  savingIds: ReadonlySet<number>
  /** Resolves to the created folder, or null when the server refused it. */
  createFolder: (parent: number | null, name: string) => Promise<Item | null>
  /** Renames right away and reverts if the server refuses. Resolves to success. */
  renameFolder: (id: number, name: string) => Promise<boolean>
}

function clearError(): void {
  error.value = null
}

function pendingIn(parent: number | null): PendingFolder[] {
  return pendingCreates.filter((pending) => pending.parent === parent)
}

async function createFolder(parent: number | null, name: string): Promise<Item | null> {
  clearError()
  const pending: PendingFolder = { key: `pending-${nextPendingKey++}`, parent, name }
  pendingCreates.push(pending)

  try {
    const folder = await api.folders.createFolder(name, parent)
    const item = mapFolderToItem(folder, folder.parent?.id ?? parent)
    upsertItems([item])
    // A new folder is empty: opening it needs no request.
    markFresh(folderKeys.subfolders(item.id))
    return item
  } catch (err: unknown) {
    error.value = `Could not create “${name}”: ${errorMessage(err, 'request failed')}`
    return null
  } finally {
    const index = pendingCreates.findIndex((entry) => entry.key === pending.key)
    if (index !== -1) pendingCreates.splice(index, 1)
  }
}

async function renameFolder(id: number, name: string): Promise<boolean> {
  const item = findItem(id)
  if (!item || savingIds.has(id)) return false
  clearError()

  const previousName = item.name
  item.name = name
  savingIds.add(id)
  try {
    const folder = await api.folders.renameFolder(id, name)
    upsertItems([mapFolderToItem(folder, folder.parent?.id ?? item.parent)])
    return true
  } catch (err: unknown) {
    const current = findItem(id)
    if (current) current.name = previousName
    error.value = `Could not rename “${previousName}”: ${errorMessage(err, 'request failed')}`
    return false
  } finally {
    savingIds.delete(id)
  }
}

export function useFolderActions(): UseFolderActionsReturn {
  return {
    error: readonly(error),
    clearError,
    pendingIn,
    savingIds,
    createFolder,
    renameFolder,
  }
}
