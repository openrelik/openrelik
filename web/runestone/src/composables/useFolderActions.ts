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
import { api, errorMessage, type FolderRole } from '@/api'
import { refreshAll } from '@/composables/useAutoRefresh'
import { confirmAction } from '@/composables/useConfirm'
import { folderKeys, mapFolderToItem } from '@/composables/useFolderLoader'
import {
  canDeleteItem,
  canRename,
  ensureRole,
  forgetRoles,
  roleOf,
} from '@/composables/useFolderPermissions'
import { forget, invalidate, markFresh } from '@/composables/useQueryCache'
import { findItem, removeTree, upsertItems } from '@/data/folders'
import type { Item } from '@/types/item'
import { dropFromRootPages, prependToRootPages } from '@/data/rootPages'
import { useAuthStore } from '@/stores/auth'
import { count } from '@/utils/format'

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
  /** Ids of items whose deletion is still in flight. */
  deletingIds: ReadonlySet<number>
  /**
   * Deletes folders (with everything below them) and files, in parallel. Each
   * one leaves the store once the server confirms; failures stay and are
   * reported. Resolves to the ids that were deleted.
   */
  deleteItems: (ids: number[]) => Promise<number[]>
  /**
   * Asks for confirmation, then deletes. The one entry point for deleting from
   * the UI (inspector, Delete key, prompt `rm`). Resolves to the ids deleted;
   * none when cancelled.
   */
  confirmDeleteItems: (items: Item[]) => Promise<number[]>
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
    if (item.parent === null) {
      // The newest folder: first on page 1 now; later pages shift by one, so
      // they refetch when visited.
      const written = prependToRootPages(item.id)
      invalidate(folderKeys.rootPrefix)
      for (const key of written) markFresh(key)
    }
    // A new folder is empty: opening it needs no request, for either listing.
    markFresh(folderKeys.subfolders(item.id))
    markFresh(folderKeys.files(item.id))
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

async function deleteItems(ids: number[]): Promise<number[]> {
  const targets = ids
    .map((id) => findItem(id))
    .filter((item): item is Item => !!item && !deletingIds.has(item.id))
  if (!targets.length) return []
  clearError()
  for (const item of targets) deletingIds.add(item.id)

  const results = await Promise.allSettled(
    targets.map((item) =>
      item.kind === 'folder' ? api.folders.deleteFolder(item.id) : api.files.deleteFile(item.id),
    ),
  )

  const deleted: number[] = []
  const failures: { name: string; reason: string }[] = []
  const removed: number[] = []
  results.forEach((result, index) => {
    const item = targets[index]!
    deletingIds.delete(item.id)
    if (result.status === 'fulfilled') {
      deleted.push(item.id)
      // Gone on the server: drop it, everything below it, their cached data and
      // roles. A file takes nothing else with it.
      const gone = removeTree(item.id)
      forget(
        gone.flatMap((g) => [
          folderKeys.folder(g),
          folderKeys.subfolders(g),
          folderKeys.files(g),
          folderKeys.role(g),
        ]),
      )
      forgetRoles(gone)
      removed.push(...gone)
    } else {
      failures.push({
        name: item.name,
        reason: errorMessage(result.reason, 'request failed'),
      })
    }
  })

  // Listed at the top: pages shrink now, then refill from the server (the
  // current page right away, the others when visited).
  if (dropFromRootPages(removed)) {
    invalidate(folderKeys.rootPrefix)
    refreshAll()
  }

  if (failures.length === 1 && targets.length === 1) {
    error.value = `Could not delete “${failures[0]!.name}”: ${failures[0]!.reason}`
  } else if (failures.length) {
    error.value = `Could not delete ${failures.length} of ${targets.length} items: ${failures[0]!.reason}`
  }
  return deleted
}

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

async function confirmDeleteItems(items: Item[]): Promise<number[]> {
  const targets = items.filter((item) => !deletingIds.has(item.id))
  if (!targets.length) return []
  clearError()

  // Checked before asking, so nobody confirms something the server refuses.
  // Roles are per folder: a file's rights come from the folder it is in, or
  // from having uploaded it.
  const folders = targets.filter((item) => item.kind === 'folder')
  const fileParents = targets
    .filter((item) => item.kind === 'file' && item.parent !== null)
    .map((item) => findItem(item.parent!))
    .filter((item): item is Item => !!item)

  try {
    await Promise.all([...folders, ...fileParents].map((item) => ensureRole(item.id)))
  } catch (err: unknown) {
    error.value = `Could not check permissions: ${errorMessage(err, 'request failed')}`
    return []
  }

  const viewer = useAuthStore().user
  const viewerName = viewer?.display_name || viewer?.username

  const denied = targets.filter((item) => !canDeleteItem(item, viewerName))
  if (denied.length) {
    error.value =
      denied.length === 1
        ? denied[0]!.kind === 'folder'
          ? `Only an owner can delete “${denied[0]!.name}”.`
          : `Only an owner of “${denied[0]!.name}” or of its folder can delete it.`
        : `Only an owner can delete ${denied.length} of the selected items.`
    return []
  }

  const single = targets.length === 1 ? targets[0]! : null
  const title = single ? `Delete “${single.name}”?` : `Delete ${count(targets.length, 'item')}?`
  const message = single
    ? single.kind === 'folder'
      ? 'The folder is deleted with everything inside — subfolders, files and workflows. This cannot be undone.'
      : 'The file is deleted. This cannot be undone.'
    : `${folders.length ? 'Folders are deleted with everything inside. ' : ''}This cannot be undone.`

  const confirmed = await confirmAction({
    title,
    message,
    items: single ? undefined : targets.map((item) => item.name),
    confirmLabel: 'Delete',
    danger: true,
  })
  return confirmed ? deleteItems(targets.map((item) => item.id)) : []
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
    deleteItems,
    confirmDeleteItems,
    mayRename,
  }
}
