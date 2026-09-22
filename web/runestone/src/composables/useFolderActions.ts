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
 * - `deletingIds`: folders whose deletion is in flight. They stay on screen,
 *   dimmed, until the server confirms, then disappear with everything below.
 * - `error`: why the last create, rename or delete failed.
 */

import { reactive, readonly, ref, type Ref } from 'vue'
import { api, errorMessage } from '@/api'
import { confirmAction } from '@/composables/useConfirm'
import { folderKeys, mapFolderToItem } from '@/composables/useFolderLoader'
import {
  canDelete,
  canRename,
  ensureRole,
  forgetRoles,
  roleOf,
} from '@/composables/useFolderPermissions'
import type { FolderRole } from '@/api'
import { forget, markFresh } from '@/composables/useQueryCache'
import { findItem, removeTree, upsertItems, type Item } from '@/data/folders'

export interface PendingFolder {
  /** Stable key for the placeholder row; not a server id. */
  key: string
  parent: number | null
  name: string
}

const error = ref<string | null>(null)
const pendingCreates = reactive<PendingFolder[]>([])
const savingIds = reactive(new Set<number>())
const deletingIds = reactive(new Set<number>())
let nextPendingKey = 0

export interface UseFolderActionsReturn {
  /** Why the last create, rename or delete failed, until the next action or `clearError()`. */
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
  /** Ids of folders whose deletion is still in flight. */
  deletingIds: ReadonlySet<number>
  /**
   * Deletes folders (in parallel) with everything below them. Each one leaves
   * the store once the server confirms; failures stay and are reported.
   * Resolves to the ids that were deleted.
   */
  deleteFolders: (ids: number[]) => Promise<number[]>
  /**
   * Asks for confirmation, then deletes. The one entry point for deleting from
   * the UI (inspector, Delete key, prompt `rm`). Resolves to the ids deleted;
   * none when cancelled.
   */
  confirmDeleteFolders: (items: Item[]) => Promise<number[]>
  /**
   * Whether the operator may rename `item` (Owner or Editor). Checked before a
   * rename starts, so nobody types a new name the server would refuse; the
   * reason is reported through `error`.
   */
  mayRename: (item: Item) => Promise<boolean>
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

async function deleteFolders(ids: number[]): Promise<number[]> {
  const targets = ids.filter((id) => findItem(id)?.kind === 'folder' && !deletingIds.has(id))
  if (!targets.length) return []
  clearError()
  const names = new Map(targets.map((id) => [id, findItem(id)!.name]))
  for (const id of targets) deletingIds.add(id)

  const results = await Promise.allSettled(targets.map((id) => api.folders.deleteFolder(id)))

  const deleted: number[] = []
  const failures: { name: string; reason: string }[] = []
  results.forEach((result, index) => {
    const id = targets[index]!
    deletingIds.delete(id)
    if (result.status === 'fulfilled') {
      deleted.push(id)
      // Gone on the server: drop it, everything below it, their cached data and roles.
      const gone = removeTree(id)
      forget(
        gone.flatMap((g) => [folderKeys.folder(g), folderKeys.subfolders(g), folderKeys.role(g)]),
      )
      forgetRoles(gone)
    } else {
      failures.push({ name: names.get(id)!, reason: errorMessage(result.reason, 'request failed') })
    }
  })

  if (failures.length === 1 && targets.length === 1) {
    error.value = `Could not delete “${failures[0]!.name}”: ${failures[0]!.reason}`
  } else if (failures.length) {
    error.value = `Could not delete ${failures.length} of ${targets.length} folders: ${failures[0]!.reason}`
  }
  return deleted
}

/**
 * Checks the operator's role on each folder (only the folders themselves:
 * rights on a folder cover everything inside it). Reports why not through
 * `error`. Roles come from the cache, so a check usually costs nothing.
 */
async function permitted(
  folders: Item[],
  allows: (role: FolderRole | null | undefined) => boolean,
  refusal: (denied: Item[]) => string,
): Promise<boolean> {
  try {
    await Promise.all(folders.map((item) => ensureRole(item.id)))
  } catch (err: unknown) {
    error.value = `Could not check permissions: ${errorMessage(err, 'request failed')}`
    return false
  }
  const denied = folders.filter((item) => !allows(roleOf(item.id)))
  if (!denied.length) return true
  error.value = refusal(denied)
  return false
}

async function mayRename(item: Item): Promise<boolean> {
  // Files are not loaded from the server yet: no rights to check, nothing to rename.
  if (item.kind !== 'folder') return false
  clearError()
  return permitted([item], canRename, () => `Only an owner or editor can rename “${item.name}”.`)
}

async function confirmDeleteFolders(items: Item[]): Promise<number[]> {
  const folders = items.filter((item) => item.kind === 'folder' && !deletingIds.has(item.id))
  if (!folders.length) return []
  clearError()

  // Only owners may delete. Every entry point (button, Delete key, rm) passes
  // here, so check before asking rather than let the server refuse after.
  const allowed = await permitted(folders, canDelete, (denied) =>
    denied.length === 1
      ? `Only an owner can delete “${denied[0]!.name}”.`
      : `Only an owner can delete ${denied.length} of the selected folders.`,
  )
  if (!allowed) return []

  const single = folders.length === 1 ? folders[0]! : null

  const confirmed = await confirmAction({
    title: single ? `Delete “${single.name}”?` : `Delete ${folders.length} folders?`,
    message: `${single ? 'The folder is' : 'They are'} deleted with everything inside — subfolders, files and workflows. This cannot be undone.`,
    items: single ? undefined : folders.map((item) => item.name),
    confirmLabel: 'Delete',
    danger: true,
  })
  return confirmed ? deleteFolders(folders.map((item) => item.id)) : []
}

export function useFolderActions(): UseFolderActionsReturn {
  return {
    error: readonly(error),
    clearError,
    pendingIn,
    savingIds,
    createFolder,
    renameFolder,
    deletingIds,
    deleteFolders,
    confirmDeleteFolders,
    mayRename,
  }
}
