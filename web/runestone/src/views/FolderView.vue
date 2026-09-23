<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'

import FolderPager from '@/components/folders/FolderPager.vue'
import FolderStatusBar from '@/components/folders/FolderStatusBar.vue'
import FolderTable, { type SortKey } from '@/components/folders/FolderTable.vue'
import FolderToolbar from '@/components/folders/FolderToolbar.vue'
import ItemInspector from '@/components/folders/ItemInspector.vue'
import LoadState from '@/components/base/LoadState.vue'
import TaskInspector from '@/components/workflow/TaskInspector.vue'
import WorkflowPanel from '@/components/workflow/WorkflowPanel.vue'
import { useRowSelection } from '@/composables/useRowSelection'
import { lastRun, openAddToWorkflow, openRun, runError } from '@/composables/useRun'
import { bytesOf, typeOf } from '@/data/files'
import { childrenOf, findItem, pathTo, renameItem, type Item } from '@/data/folders'
import { rootPageItems, rootPageOf } from '@/data/rootPages'
import { openShareDialog } from '@/composables/useShareDialog'
import { openWorkflowDialog } from '@/composables/useWorkflowDialog'
import { useAutoRefresh } from '@/composables/useAutoRefresh'
import { useDelayedFlag } from '@/composables/useDelayedFlag'
import { useFolderActions } from '@/composables/useFolderActions'
import { useFolderLoader } from '@/composables/useFolderLoader'
import { canDeleteItem, useFolderPermissions } from '@/composables/useFolderPermissions'
import { useFolderPrefetch } from '@/composables/useFolderPrefetch'
import { useDropZone } from '@/composables/useDropZone'
import { useUploadPanel } from '@/composables/useUploadPanel'
import { useUploadQueue } from '@/composables/useUploadQueue'
import { useRootPager } from '@/composables/useRootPager'
import { useWorkflowLoader } from '@/composables/useWorkflowLoader'
import { discardWorkflow, type AddAt } from '@/composables/useWorkflow'
import { everyTask, findTask } from '@/data/workflows'
import { useAuthStore } from '@/stores/auth'
import { useModalStore } from '@/stores/modals'
import { isTyping } from '@/utils/keyboard'

/**
 * A two-pane explorer: what is here (listing) and what the highlighted thing
 * is (inspector), under a path bar that doubles as the prompt for moving.
 */
const props = defineProps<{ id?: string }>()
const route = useRoute()
const router = useRouter()
const modalStore = useModalStore()

const atRoot = computed(() => props.id === undefined)
/** The folder id from the route, or undefined at the root or for a malformed id. */
const folderId = computed(() =>
  props.id !== undefined && /^\d+$/.test(props.id) ? Number(props.id) : undefined,
)
const folder = computed(() => {
  if (atRoot.value) return undefined
  const item = findItem(Number(props.id))
  return item?.kind === 'folder' ? item : undefined
})
const crumbs = computed(() => (folder.value ? pathTo(folder.value.id) : []))

const filter = ref('')
const toolbar = ref<InstanceType<typeof FolderToolbar> | null>(null)
const table = ref<InstanceType<typeof FolderTable> | null>(null)

const defaultSort = (): { key: SortKey; dir: 1 | -1 } =>
  atRoot.value ? { key: 'modified', dir: -1 } : { key: 'name', dir: 1 }
const sort = ref(defaultSort())
const { load, listingState, folderState } = useFolderLoader()
const prefetch = useFolderPrefetch()
/** The top level is paginated on the server; the page is in the URL. */
const pager = useRootPager(() => atRoot.value)
const uploads = useUploadQueue()
const uploadPanel = useUploadPanel()
const rootRef = computed(() => ({ page: pager.page.value, size: pager.size.value }))
const {
  error: actionError,
  clearError,
  pendingIn,
  savingIds,
  deletingIds,
  confirmDeleteItems,
  mayRename,
  createFolder,
  renameFolder,
} = useFolderActions()

/** Load state of what the table lists: a top-level page or this folder's subfolders. */
const listing = computed(() =>
  atRoot.value ? listingState(undefined, rootRef.value) : listingState(folderId.value),
)
/** Either request answered "no such folder" (or the id is malformed). */
const notFound = computed(() => {
  if (atRoot.value || folder.value) return false
  if (folderId.value === undefined) return true
  return [folderState(folderId.value), listing.value].some((state) => state.errorStatus === 404)
})
/** The folder itself is still unknown (direct link): the path shows a placeholder. */
const pathPending = computed(() => !atRoot.value && !folder.value && !notFound.value)

watch(atRoot, () => {
  sort.value = defaultSort()
})

// New folders land first on page 1, so their placeholders only show there.
const pendingHere = computed(() =>
  atRoot.value && pager.page.value > 1 ? [] : pendingIn(folderId.value ?? null),
)

/** Files on their way into the folder on screen, shown above its rows. */
const uploadsHere = computed(() =>
  folderId.value === undefined ? [] : uploads.uploadsIn(folderId.value),
)
/** Why a drop was (partly) refused; cleared by the next drop or navigation. */
const dropRefusal = ref<string | null>(null)

/**
 * An empty workflow folder takes no uploads: it is for the workflow's outputs,
 * and files put there before it runs would pass for them.
 */
const uploadBlocked = computed(() =>
  folder.value?.workflowId !== undefined && !childrenOf(folder.value.id).length
    ? 'Uploads are off until the workflow has produced its outputs'
    : null,
)

/** Queues files for this folder; at the root there is no folder to put them in. */
function uploadFiles(files: File[]) {
  if (folderId.value === undefined) {
    dropRefusal.value = 'Files are uploaded into a case folder — open one first.'
    return
  }
  if (uploadBlocked.value) {
    dropRefusal.value = `${uploadBlocked.value}.`
    return
  }
  uploads.enqueue(folderId.value, files)
}

/** The Upload button and `u`: a fresh pick clears what the last drop said. */
function pickedFiles(files: File[]) {
  dropRefusal.value = null
  uploadFiles(files)
}

/**
 * Dropped folders are recreated here and their files uploaded into them, so a
 * case folder can be dropped whole — at the top level too, where only loose
 * files have nowhere to go.
 */
const { isOver: isDropTarget, handlers: dropHandlers } = useDropZone(({ entries, files }) => {
  dropRefusal.value = null
  if (uploadBlocked.value) {
    dropRefusal.value = `${uploadBlocked.value}.`
    return
  }
  if (entries.length) {
    uploads.enqueueDrop(folderId.value ?? null, entries)
    return
  }
  // A browser that hands out no entries: plain files only.
  if (files.length) uploadFiles(files)
})

/** Loads what is on screen: a top-level page, or a folder and its subfolders. */
function loadHere(force = false) {
  if (atRoot.value) load(undefined, { ...rootRef.value, force })
  else if (folderId.value !== undefined) load(folderId.value, { force })
}

// Load whatever the route points at. Recently seen locations cost no request.
watch(
  () => (atRoot.value ? pager.key.value : `folder:${props.id}`),
  () => {
    clearError()
    dropRefusal.value = null
    loadHere()
    // After load(): a prefetch of the folder being opened is already joined by
    // the load, so cancelling only drops the ones for folders left behind.
    prefetch.cancel()
  },
  { immediate: true },
)

/** Refetch what is on screen, fresh or not (Shift+R, Retry). */
function refresh() {
  loadHere(true)
  loadWorkflow(true)
}

// Coming back to the tab or the network: refresh what is stale or failed.
useAutoRefresh(({ force }) => loadHere(force))

// Rows: the current top-level page in the server's order (newest created
// first; it cannot be re-sorted across pages), or a folder's contents sorted here.
const rows = computed(() => {
  if (!atRoot.value && !folder.value) return []
  const needle = filter.value.trim().toLowerCase()
  if (atRoot.value) {
    return rootPageItems(pager.key.value).filter(
      (item) => !needle || item.name.toLowerCase().includes(needle),
    )
  }
  const { key, dir } = sort.value
  const by: Record<SortKey, (a: Item, b: Item) => number> = {
    name: (a, b) => a.name.localeCompare(b.name),
    size: (a, b) =>
      a.kind === 'file' && b.kind === 'file'
        ? bytesOf(a) - bytesOf(b)
        : a.name.localeCompare(b.name),
    type: (a, b) => typeOf(a).localeCompare(typeOf(b)),
    owner: (a, b) => a.owner.localeCompare(b.owner) || a.name.localeCompare(b.name),
    modified: (a, b) => a.modified.localeCompare(b.modified),
  }
  return childrenOf(folder.value!.id)
    .filter((item) => !needle || item.name.toLowerCase().includes(needle))
    .sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'folder' ? -1 : 1) || by[key](a, b) * dir)
})

// In-row "creating…"/"saving…" wait a moment, so fast saves never flash one.
// Loading and refreshing are shown by LoadState and the app-wide status bar.
const showPending = useDelayedFlag(
  () =>
    pendingHere.value.length > 0 ||
    savingIds.size > 0 ||
    deletingIds.size > 0 ||
    uploadsHere.value.length > 0,
)

const maxBytes = computed(() => Math.max(1, ...rows.value.map(bytesOf)))
const totals = computed(() => ({
  dirs: rows.value.filter((row) => row.kind === 'folder').length,
  files: rows.value.filter((row) => row.kind === 'file').length,
  bytes: rows.value.reduce((sum, row) => sum + bytesOf(row), 0),
}))

function sortBy(key: SortKey) {
  sort.value =
    sort.value.key === key ? { key, dir: sort.value.dir === 1 ? -1 : 1 } : { key, dir: 1 }
}

// --- selection & cursor ---
const {
  cursor,
  selected,
  selectedBytes,
  allSelected,
  pick: rawPick,
  toggle,
  toggleAll,
  extendTo,
  dropAnchor,
  clearSelection,
} = useRowSelection(rows, bytesOf)

const selectedItems = computed(() => rows.value.filter((row) => selected.value.has(row.id)))

const selectedFiles = computed(() =>
  rows.value.filter((row) => row.kind === 'file' && selected.value.has(row.id)),
)

const focused = computed(() => {
  if (selectedItems.value.length === 1) {
    return selectedItems.value[0]!
  }
  return rows.value[cursor.value] ?? folder.value
})

/**
 * What Delete would act on: the selection when several items are selected,
 * otherwise the item in the inspector.
 */
const deleteTargets = computed<Item[]>(() => {
  const items = selectedItems.value.length > 1 ? selectedItems.value : [focused.value]
  return items.filter((item): item is Item => !!item)
})
/** A folder is judged by its own role, a file by the folder it is in. */
const deleteRoleIds = computed(() => [
  ...new Set(
    deleteTargets.value
      .map((item) => (item.kind === 'folder' ? item.id : item.parent))
      .filter((id): id is number => id !== null),
  ),
])
// Keeps those roles loaded; Delete stays hidden until they are known.
useFolderPermissions(() => deleteRoleIds.value)
const viewerName = computed(() => {
  const viewer = useAuthStore().user
  return viewer?.display_name || viewer?.username
})
const canDeleteAll = computed(
  () =>
    deleteTargets.value.length > 0 &&
    deleteTargets.value.every((item) => canDeleteItem(item, viewerName.value)),
)
// Rename acts on the folder in the inspector; it shows for owners and editors.
const { canRenameAll: canRenameFocused } = useFolderPermissions(() =>
  focused.value?.kind === 'folder' ? [focused.value.id] : [],
)

// --- workflow & tasks ---
// The folder's workflow loads alongside its listing, and polls while it runs.
const { workflow, state: workflowState, load: loadWorkflow } = useWorkflowLoader(() => folder.value)
/** By id: polling replaces the tasks, and the inspector follows the new ones. */
const taskId = ref<string | null>(null)
const task = computed(() =>
  workflow.value && taskId.value ? (findTask(workflow.value, taskId.value) ?? null) : null,
)
watch(cursor, () => (taskId.value = null))

/**
 * A workflow folder holds what its tasks produce, so an empty one does not
 * invite uploads: it says where the outputs will come from.
 */
const emptyNote = computed(() => {
  if (folder.value?.workflowId === undefined) return undefined
  return workflow.value?.draft === false
    ? 'No outputs yet.'
    : 'Outputs land here once the workflow runs.'
})

/** A folder row under the cursor or mouse is likely opened next: load its subfolders ahead. */
function prefetchRow(item: Item | null | undefined) {
  prefetch.schedule(item?.kind === 'folder' ? item.id : null)
}
watch(() => rows.value[cursor.value], prefetchRow)

const produced = computed(() => new Set(task.value?.outputs ?? []))
const tracing = computed(() => produced.value.size > 0)

const producer = computed(() => {
  const row = rows.value[cursor.value]
  if (task.value || !workflow.value || row?.kind !== 'file') return undefined
  return everyTask(workflow.value).find((t) => t.outputs.includes(row.id))
})

function pick(index: number) {
  rawPick(index)
  taskId.value = null
}

function onRowClick(event: MouseEvent, index: number) {
  if (event.shiftKey) extendTo(index)
  else pick(index)
}

// A new location — another folder, or another top-level page: selection,
// filter and task belong to the old one. Coming back up, the cursor lands on
// the folder just left.
watch([() => props.id, () => (atRoot.value ? pager.page.value : 0)], (_, [previous]) => {
  clearSelection()
  filter.value = ''
  taskId.value = null
  const from = rows.value.findIndex((row) => String(row.id) === previous)
  cursor.value = Math.max(0, from)
})

const focus = rows.value.findIndex((row) => String(row.id) === route.query.focus)
if (focus >= 0) cursor.value = focus

// --- runs ---
const runFiles = () => {
  const chosen = rows.value.filter((row) => row.kind === 'file' && selected.value.has(row.id))
  const here = rows.value[cursor.value]
  return chosen.length ? chosen : here?.kind === 'file' ? [here] : []
}

function runPicker() {
  if (folder.value) openRun(runFiles(), folder.value.id)
}

/** The inspector's add buttons: the picker, for this folder's draft. */
function openAdd(at: AddAt) {
  if (workflow.value) openAddToWorkflow(workflow.value, at)
}

const runNotice = computed(() =>
  lastRun.value && lastRun.value.parentId === folder.value?.id ? lastRun.value : null,
)

// --- navigation ---
const UP = -1
const parentPath = computed(() => {
  const parent = folder.value?.parent
  if (parent !== null && parent !== undefined) return `/folder/${parent}`
  // Up from a top-level folder: back to the page that lists it.
  const page = folder.value ? rootPageOf(folder.value.id, pager.size.value) : undefined
  return page && page > 1 ? `/?page=${page}` : '/'
})
const parentName = computed(() => {
  const parent = folder.value?.parent
  return parent === null || parent === undefined ? '/' : (findItem(parent)?.name ?? '')
})

function goUp() {
  if (!atRoot.value) router.push(parentPath.value)
}

function open(item: Item | undefined) {
  if (!item) return
  router.push(
    item.kind === 'folder' ? `/folder/${item.id}` : `/folder/${item.parent}/file/${item.id}`,
  )
}

async function startCreateFolder() {
  // A new top-level folder is the newest: create it on page 1, where it will stay.
  if (atRoot.value && pager.page.value > 1) {
    await pager.goTo(1)
    await nextTick()
  }
  filter.value = ''
  table.value?.startCreateFolder()
}

async function handleCreateFolder(name: string) {
  const parentId = atRoot.value ? null : (folder.value?.id ?? null)
  const created = await createFolder(parentId, name)
  if (!created) return
  await nextTick()
  const idx = rows.value.findIndex((r) => r.id === created.id)
  if (idx >= 0) cursor.value = idx
}

function startRenameCurrent() {
  const item = rows.value[cursor.value]
  if (item) table.value?.startRename(item)
}

/**
 * Asks for confirmation, then deletes folders with everything in them. Rows
 * stay dimmed until the server confirms. If the folder on screen is deleted,
 * the view moves up to its parent. Stale selections are dropped.
 */
async function deleteItems(items: Item[]) {
  const current = folder.value
  const upTo = parentPath.value
  const deleted = await confirmDeleteItems(items)
  if (!deleted.length) return

  selected.value = new Set([...selected.value].filter((id) => !deleted.includes(id)))
  if (current && deleted.includes(current.id)) router.push(upTo)
}

/** Discards the draft workflow this folder holds, with the folder, and moves up. */
async function discard() {
  const current = folder.value
  const upTo = parentPath.value
  if (current && (await discardWorkflow(current.id))) router.push(upTo)
}

/** Delete / ⌘⌫: the selection, or the highlighted row. */
function deleteCurrent() {
  const row = rows.value[cursor.value]
  deleteItems(selectedItems.value.length ? selectedItems.value : row ? [row] : [])
}

function startRenameItem(id: number) {
  const item = findItem(id)
  if (item) {
    const idx = rows.value.findIndex((r) => r.id === id)
    if (idx >= 0) cursor.value = idx
    table.value?.startRename(item)
  }
}

function handleRename({ id, name }: { id: number; name: string }) {
  // Files are not loaded from the server yet, so they are still renamed locally.
  if (findItem(id)?.kind === 'folder') renameFolder(id, name)
  else renameItem(id, name)
}

// --- keyboard navigation ---
const KEYS: Record<string, () => void> = {
  ArrowDown: () => (cursor.value = Math.min(rows.value.length - 1, cursor.value + 1)),
  ArrowUp: () => (cursor.value = Math.max(atRoot.value ? 0 : UP, cursor.value - 1)),
  Home: () => (cursor.value = 0),
  End: () => (cursor.value = Math.max(0, rows.value.length - 1)),
  Enter: () => (cursor.value === UP ? goUp() : open(rows.value[cursor.value])),
  ArrowRight: () => (cursor.value === UP ? goUp() : open(rows.value[cursor.value])),
  ' ': () => {
    const row = rows.value[cursor.value]
    if (row) toggle(row.id)
  },
  '/': () => toolbar.value?.focusFilter(),
  n: startCreateFolder,
  r: runPicker,
  s: () => {
    const row = rows.value[cursor.value]
    if (row?.kind === 'folder') {
      openShareDialog(row)
    } else if (folder.value) {
      openShareDialog(folder.value)
    }
  },
  w: () => {
    const files = runFiles()
    if (folder.value && files.length) openWorkflowDialog(files, folder.value.id)
  },
  F2: startRenameCurrent,
  e: startRenameCurrent,
  u: () => toolbar?.value?.pickFiles(),
  PageDown: () => atRoot.value && pager.next(),
  PageUp: () => atRoot.value && pager.prev(),
  Delete: deleteCurrent,
  // Backspace deletes too: no browser navigates back on it any more, and the
  // confirmation catches a stray press.
  Backspace: deleteCurrent,
  R: refresh,
  Escape: () => {
    if (table.value?.renamingId) {
      table.value.cancelRename()
      return
    }
    if (taskId.value) {
      taskId.value = null
    } else {
      clearSelection()
    }
  },
}
KEYS.j = KEYS.ArrowDown!
KEYS.k = KEYS.ArrowUp!
KEYS.l = KEYS.Enter!

/** Blurs the path prompt if it still has the caret (it is focused on arrival). */
function leavePrompt() {
  const focused = document.activeElement
  if (focused instanceof HTMLElement && 'prompt' in focused.dataset) focused.blur()
}

function onKey(event: KeyboardEvent) {
  // If a modal dialog is currently open, let it handle its own input
  if (modalStore.hasActiveModal) return

  if (isTyping(event)) {
    if (event.target === toolbar.value?.filterInput) {
      if (['Escape', 'Enter', 'ArrowDown'].includes(event.key)) {
        if (event.key === 'Escape') filter.value = ''
        toolbar.value?.filterInput?.blur()
        event.preventDefault()
      }
    }
    return
  }

  if (event.altKey) return

  const control =
    event.target instanceof HTMLButtonElement || event.target instanceof HTMLAnchorElement
  if (control && (event.key === 'Enter' || event.key === ' ')) return

  if (event.metaKey || event.ctrlKey) {
    if (event.key === 'a') {
      toggleAll()
      event.preventDefault()
    } else if (event.key === 'Backspace') {
      // ⌘⌫, the Finder shortcut: Mac keyboards have no Delete key.
      deleteCurrent()
      event.preventDefault()
    } else if (event.key === 'Enter') {
      runPicker()
      event.preventDefault()
    }
    return
  }

  if (event.shiftKey) {
    const last = rows.value.length - 1
    const target: Record<string, number> = {
      ArrowDown: cursor.value + 1,
      J: cursor.value + 1,
      ArrowUp: cursor.value - 1,
      K: cursor.value - 1,
      Home: 0,
      End: last,
    }
    if (event.key in target) {
      // Selecting belongs to the listing: the prompt steps aside, so what is
      // typed next is a shortcut rather than text in a prompt nobody is using.
      leavePrompt()
      extendTo(target[event.key]!)
      event.preventDefault()
      return
    }
  }

  const action = KEYS[event.key]
  if (!action) return
  dropAnchor()
  action()
  event.preventDefault()
}

onMounted(() => {
  window.addEventListener('keydown', onKey)
})
onUnmounted(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <div v-if="notFound" class="h-full bg-surface px-4 py-6 text-ink-muted">
    No folder {{ id }}. <RouterLink to="/" class="text-brand hover:underline">Back home</RouterLink>
  </div>

  <section
    v-else
    class="explorer flex h-full min-h-[28rem] flex-col overflow-hidden bg-surface text-[12px]"
  >
    <!-- toolbar -->
    <FolderToolbar
      ref="toolbar"
      v-model:filter="filter"
      :crumbs="crumbs"
      :path-pending="pathPending"
      :at-root="atRoot"
      :selected-files="selectedFiles"
      :upload-blocked="uploadBlocked"
      @new-folder="startCreateFolder"
      @upload-files="pickedFiles"
    />

    <!-- panes -->
    <div class="flex min-h-0 flex-1">
      <!-- The list, with the page controls under it at the paginated top level. -->
      <div class="flex min-h-0 min-w-0 flex-1 flex-col">
        <FolderTable
          ref="table"
          class="min-h-0"
          :rows="rows"
          :sort="sort"
          :sortable="!atRoot"
          :cursor="cursor"
          :selected="selected"
          :all-selected="allSelected"
          :at-root="atRoot"
          :has-task="!!task"
          :produced="produced"
          :tracing="tracing"
          :parent-path="parentPath"
          :parent-name="parentName"
          :max-bytes="maxBytes"
          :filter="filter"
          :listing="listing"
          :pending-folders="pendingHere"
          :saving-ids="savingIds"
          :deleting-ids="deletingIds"
          :may-rename="mayRename"
          :show-pending="showPending"
          :action-error="actionError ?? runError ?? uploads.error.value ?? dropRefusal"
          :empty-note="emptyNote"
          :uploads="uploadsHere"
          :is-drop-target="isDropTarget"
          v-on="dropHandlers"
          @sort="sortBy"
          @toggle-all="toggleAll"
          @toggle="toggle"
          @row-click="onRowClick"
          @open="open"
          @pick="pick"
          @go-up="goUp"
          @create-folder="handleCreateFolder"
          @rename="handleRename"
          @retry="refresh"
          @hover="prefetchRow"
          @show-queue="uploadPanel.open()"
          @cancel-upload="uploads.cancel"
          @retry-upload="uploads.retry"
          @dismiss-upload="uploads.dismiss"
        >
          <template #workflow>
            <WorkflowPanel
              v-if="workflow"
              :workflow="workflow"
              :selected-id="taskId"
              :producer-id="producer?.id ?? null"
              @select="taskId = $event?.id ?? null"
              @discard="discard"
            />
            <LoadState
              v-else-if="folder?.workflowId !== undefined"
              class="border-b border-border"
              :state="workflowState"
              noun="workflow"
              :has-content="false"
              @retry="loadWorkflow(true)"
            />
          </template>
        </FolderTable>
        <FolderPager
          v-if="atRoot"
          :page="pager.page.value"
          :last-page="pager.lastPage.value"
          :from="pager.from.value"
          :to="pager.to.value"
          :total="pager.total.value"
          :has-prev="pager.hasPrev.value"
          :has-next="pager.hasNext.value"
          @prev="pager.prev"
          @next="pager.next"
        />
      </div>

      <TaskInspector
        v-if="task && workflow"
        :task="task"
        :folder-id="workflow.folderId"
        :editable="workflow.draft"
        class="w-64 shrink-0 border-l border-border max-xl:hidden"
        @close="taskId = null"
        @add="openAdd"
      />
      <ItemInspector
        v-else-if="focused"
        :item="focused"
        :producer="producer?.name"
        :selected-files="selectedFiles"
        :selected-items="selectedItems"
        :can-delete="canDeleteAll"
        :can-rename="canRenameFocused"
        class="w-64 shrink-0 border-l border-border max-xl:hidden"
        @open="open(findItem($event))"
        @run-more="runPicker"
        @clear-selection="clearSelection"
        @toggle-item="toggle"
        @rename="startRenameItem"
        @delete="deleteItems"
      />
    </div>

    <!-- status bar -->
    <FolderStatusBar
      :rows-count="rows.length"
      :dirs-count="totals.dirs"
      :files-count="totals.files"
      :bytes-count="totals.bytes"
      :run-notice="runNotice"
      :producer="producer"
      :highlighted-row-name="rows[cursor]?.name"
      :task="task"
      :tracing="tracing"
      :produced-count="produced.size"
      :selected-count="selected.size"
      :selected-bytes="selectedBytes"
    />
  </section>
</template>
