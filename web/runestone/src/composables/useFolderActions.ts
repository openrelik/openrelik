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
 * - `deletingKeys`: items (`itemKey`) whose deletion is in flight. They stay on
 *   screen, dimmed, until the server confirms, then disappear with everything below.
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
import { useItemsStore } from '@/stores/items'
import type { Item } from '@/types/item'
import { useRootPagesStore } from '@/stores/rootPages'
import { useAuthStore } from '@/stores/auth'
import { useWorkflowsStore } from '@/stores/workflows'
import { count } from '@/utils/format'
import { awaitsOutputs, itemKey } from '@/utils/item'

export interface PendingFolder {
  /** Stable key for the placeholder row; not a server id. */
  key: string
  parent: number | null
  name: string
}

const error = ref<string | null>(null)
const pendingCreates = reactive<PendingFolder[]>([])
const savingIds = reactive(new Set<number>())
const deletingKeys = reactive(new Set<string>())
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
  /** Items (`itemKey`) whose deletion is still in flight. */
  deletingKeys: ReadonlySet<string>
  /**
   * Deletes folders (with everything below them) and files, in parallel. Each
   * one leaves the store once the server confirms; failures stay and are
   * reported. Resolves to the items that were deleted.
   */
  deleteItems: (items: Item[]) => Promise<Item[]>
  /**
   * Asks for confirmation, then deletes. The one entry point for deleting from
   * the UI (inspector, Delete key, prompt `rm`). Resolves to the items deleted;
   * none when cancelled.
   */
  confirmDeleteItems: (items: Item[]) => Promise<Item[]>
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
  // Every way in (the toolbar, `mkdir`) meets the same rule here.
  if (parent !== null) {
    const itemsStore = useItemsStore()
    if (awaitsOutputs(itemsStore.findFolder(parent), itemsStore.childrenOf(parent).length)) {
      error.value = `Could not create “${name}”: the workflow has not produced its outputs yet`
      return null
    }
  }
  const pending: PendingFolder = { key: `pending-${nextPendingKey++}`, parent, name }
  pendingCreates.push(pending)

  try {
    const folder = await api.folders.createFolder(name, parent)
    const item = mapFolderToItem(folder, folder.parent?.id ?? parent)
    useItemsStore().upsertItems([item])
    if (item.parent === null) {
      // The newest folder: first on page 1 now; later pages shift by one, so
      // they refetch when visited.
      const written = useRootPagesStore().prependToRootPages(item.id)
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

/**
 * A folder and the workflow it holds share one name, owned by the folder: a
 * rename of either is a rename of both. The two requests go out together; if
 * the folder's fails, the workflow's is put back. If only the workflow's
 * fails, the folder keeps its new name — the one every view shows — and the
 * next rename brings the workflow along.
 */
async function renameFolder(id: number, name: string): Promise<boolean> {
  const itemsStore = useItemsStore()
  const item = itemsStore.findFolder(id)
  if (!item || savingIds.has(id)) return false
  clearError()

  const workflow = useWorkflowsStore().workflowOf(id)
  const workflowId = item.workflowId ?? workflow?.id
  const previousName = item.name
  const previousWorkflowName = workflow?.name
  item.name = name
  if (workflow) workflow.name = name
  savingIds.add(id)
  try {
    const [folder, renamed] = await Promise.allSettled([
      api.folders.renameFolder(id, name),
      workflowId === undefined ? Promise.resolve(null) : api.workflows.rename(id, workflowId, name),
    ])
    if (folder.status === 'rejected') throw folder.reason
    itemsStore.upsertItems([mapFolderToItem(folder.value, folder.value.parent?.id ?? item.parent)])
    if (renamed.status === 'rejected' && workflow) workflow.name = previousWorkflowName!
    return true
  } catch (err: unknown) {
    const current = itemsStore.findFolder(id)
    if (current) current.name = previousName
    if (workflow && previousWorkflowName !== undefined) {
      workflow.name = previousWorkflowName
      if (workflowId !== undefined) {
        api.workflows.rename(id, workflowId, previousWorkflowName).catch(() => {})
      }
    }
    error.value = `Could not rename “${previousName}”: ${errorMessage(err, 'request failed')}`
    return false
  } finally {
    savingIds.delete(id)
  }
}

async function deleteItems(items: Item[]): Promise<Item[]> {
  const itemsStore = useItemsStore()
  const targets = items.filter((item) => !deletingKeys.has(itemKey(item)))
  if (!targets.length) return []
  clearError()
  for (const item of targets) deletingKeys.add(itemKey(item))

  const results = await Promise.allSettled(
    targets.map((item) =>
      item.kind === 'folder' ? api.folders.deleteFolder(item.id) : api.files.deleteFile(item.id),
    ),
  )

  const deleted: Item[] = []
  const failures: { name: string; reason: string }[] = []
  const removedFolders: number[] = []
  results.forEach((result, index) => {
    const item = targets[index]!
    deletingKeys.delete(itemKey(item))
    if (result.status === 'fulfilled') {
      deleted.push(item)
      // Gone on the server: drop it, everything below it, and the folders'
      // cached data and roles. A file takes nothing else with it.
      const gone = itemsStore
        .removeTree(item)
        .filter((removed) => removed.kind === 'folder')
        .map((folder) => folder.id)
      forget(
        gone.flatMap((g) => [
          folderKeys.folder(g),
          folderKeys.subfolders(g),
          folderKeys.files(g),
          folderKeys.role(g),
        ]),
      )
      forgetRoles(gone)
      removedFolders.push(...gone)
    } else {
      failures.push({
        name: item.name,
        reason: errorMessage(result.reason, 'request failed'),
      })
    }
  })

  // Listed at the top: pages shrink now, then refill from the server (the
  // current page right away, the others when visited).
  if (useRootPagesStore().dropFromRootPages(removedFolders)) {
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

async function confirmDeleteItems(items: Item[]): Promise<Item[]> {
  const targets = items.filter((item) => !deletingKeys.has(itemKey(item)))
  if (!targets.length) return []
  clearError()

  // Checked before asking, so nobody confirms something the server refuses.
  // Roles are per folder: a file's rights come from the folder it is in, or
  // from having uploaded it.
  const folders = targets.filter((item) => item.kind === 'folder')
  const fileParents = targets
    .filter((item) => item.kind === 'file' && item.parent !== null)
    .map((item) => useItemsStore().findFolder(item.parent!))
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
  return confirmed ? deleteItems(targets) : []
}

export function useFolderActions(): UseFolderActionsReturn {
  return {
    error: readonly(error),
    clearError,
    pendingIn,
    savingIds,
    createFolder,
    renameFolder,
    deletingKeys,
    deleteItems,
    confirmDeleteItems,
    mayRename,
  }
}
