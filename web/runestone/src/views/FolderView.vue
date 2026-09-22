<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'

import FolderStatusBar from '@/components/folders/FolderStatusBar.vue'
import FolderTable, { type SortKey } from '@/components/folders/FolderTable.vue'
import FolderToolbar from '@/components/folders/FolderToolbar.vue'
import ItemInspector from '@/components/folders/ItemInspector.vue'
import TaskInspector from '@/components/workflow/TaskInspector.vue'
import WorkflowPanel from '@/components/workflow/WorkflowPanel.vue'
import { useRowSelection } from '@/composables/useRowSelection'
import { lastRun, openRun, startRun, undoRun } from '@/composables/useRun'
import { childrenOf, findItem, FOLDERS, pathTo, renameItem, type Item } from '@/data/folders'
import type { Worker } from '@/data/workers'
import { openShareDialog } from '@/composables/useShareDialog'
import { openWorkflowDialog } from '@/composables/useWorkflowDialog'
import { useAutoRefresh } from '@/composables/useAutoRefresh'
import { useDelayedFlag } from '@/composables/useDelayedFlag'
import { useFolderActions } from '@/composables/useFolderActions'
import { useFolderLoader } from '@/composables/useFolderLoader'
import { allTasks, workflowOf, type Task } from '@/data/workflows'
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
const {
  error: actionError,
  clearError,
  pendingIn,
  savingIds,
  createFolder,
  renameFolder,
} = useFolderActions()

/** Load state of what the table lists: the root folders or this folder's subfolders. */
const listing = computed(() => listingState(folderId.value))
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

const pendingHere = computed(() => pendingIn(folderId.value ?? null))

// Load whatever the route points at. Recently seen locations cost no request.
watch(
  () => props.id,
  () => {
    clearError()
    if (atRoot.value || folderId.value !== undefined) load(folderId.value)
  },
  { immediate: true },
)

/** Refetch what is on screen, fresh or not (Shift+R, Retry). */
function refresh() {
  if (atRoot.value || folderId.value !== undefined) load(folderId.value, { force: true })
}

// Coming back to the tab or the network: refresh what is stale or failed.
useAutoRefresh(({ force }) => {
  if (atRoot.value || folderId.value !== undefined) load(folderId.value, { force })
})

const bytesOf = (item: Item) => (item.kind === 'file' ? (item.size ?? 0) : 0)
const typeOf = (item: Item) =>
  item.mime ?? (workflowOf(item.id) ? 'openrelik/workflow' : 'inode/directory')

// Derived rows, using reactive FOLDERS.value at root
const rows = computed(() => {
  if (!atRoot.value && !folder.value) return []
  const needle = filter.value.trim().toLowerCase()
  const { key, dir } = sort.value
  const by: Record<SortKey, (a: Item, b: Item) => number> = {
    name: (a, b) => a.name.localeCompare(b.name),
    size: (a, b) =>
      a.kind === 'file' && b.kind === 'file'
        ? bytesOf(a) - bytesOf(b)
        : a.name.localeCompare(b.name),
    type: (a, b) => typeOf(a).localeCompare(typeOf(b)),
    modified: (a, b) => a.modified.localeCompare(b.modified),
  }
  return (atRoot.value ? FOLDERS.value : childrenOf(folder.value!.id))
    .filter((item) => !needle || item.name.toLowerCase().includes(needle))
    .sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'folder' ? -1 : 1) || by[key](a, b) * dir)
})

// In-row "creating…"/"saving…" wait a moment, so fast saves never flash one.
// Loading and refreshing are shown by LoadState and the app-wide status bar.
const showPending = useDelayedFlag(() => pendingHere.value.length > 0 || savingIds.size > 0)

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

// --- workflow & tasks ---
const workflow = computed(() => (folder.value ? workflowOf(folder.value.id) : undefined))
const task = ref<Task | null>(null)
watch(cursor, () => (task.value = null))

const produced = computed(() => new Set(task.value?.outputs ?? []))
const tracing = computed(() => produced.value.size > 0)

const producer = computed(() => {
  const row = rows.value[cursor.value]
  if (task.value || !workflow.value || row?.kind !== 'file') return undefined
  return allTasks(workflow.value.tasks).find((t) => t.outputs.includes(row.id))
})

function pick(index: number) {
  rawPick(index)
  task.value = null
}

function onRowClick(event: MouseEvent, index: number) {
  if (event.shiftKey) extendTo(index)
  else pick(index)
}

watch(
  () => props.id,
  (_, previous) => {
    clearSelection()
    filter.value = ''
    task.value = null
    const from = rows.value.findIndex((row) => String(row.id) === previous)
    cursor.value = Math.max(0, from)
  },
)

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

function runQuick(worker: Worker) {
  const files = runFiles()
  if (folder.value && files.length) {
    startRun(
      worker,
      { files, folderId: folder.value.id },
      Object.fromEntries(worker.options.map((o) => [o.key, o.default])),
    )
  }
}

const runNotice = computed(() =>
  lastRun.value && lastRun.value.parentId === folder.value?.id ? lastRun.value : null,
)

// --- navigation ---
const UP = -1
const parentPath = computed(() => {
  const parent = folder.value?.parent
  return parent === null || parent === undefined ? '/' : `/folder/${parent}`
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

function startCreateFolder() {
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
  R: refresh,
  Escape: () => {
    if (table.value?.renamingId) {
      table.value.cancelRename()
      return
    }
    if (task.value) {
      task.value = null
    } else {
      clearSelection()
    }
  },
}
KEYS.j = KEYS.ArrowDown!
KEYS.k = KEYS.ArrowUp!
KEYS.l = KEYS.Enter!

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
      @new-folder="startCreateFolder"
    />

    <!-- panes -->
    <div class="flex min-h-0 flex-1">
      <FolderTable
        ref="table"
        :rows="rows"
        :sort="sort"
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
        :show-pending="showPending"
        :action-error="actionError"
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
      >
        <template #workflow>
          <WorkflowPanel
            v-if="workflow"
            :workflow="workflow"
            :selected-id="task?.id ?? null"
            :producer-id="producer?.id ?? null"
            @select="task = $event"
          />
        </template>
      </FolderTable>

      <TaskInspector
        v-if="task"
        :task="task"
        class="w-64 shrink-0 border-l border-border max-xl:hidden"
        @close="task = null"
      />
      <ItemInspector
        v-else-if="focused"
        :item="focused"
        :producer="producer?.name"
        :selected-files="selectedFiles"
        :selected-items="selectedItems"
        class="w-64 shrink-0 border-l border-border max-xl:hidden"
        @open="open(findItem($event))"
        @run="runQuick"
        @run-more="runPicker"
        @clear-selection="clearSelection"
        @toggle-item="toggle"
        @rename="startRenameItem"
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
      :at-root="atRoot"
      @undo="undoRun"
    />
  </section>
</template>
