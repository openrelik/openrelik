<!--
Copyright 2026 Google LLC

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    https://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
-->
<script setup lang="ts">
import {
  ArrowDown,
  ArrowUp,
  CornerLeftUp,
  Ellipsis,
  File,
  Folder,
  FolderPlus,
  Upload as UploadIcon,
  Workflow as WorkflowIcon,
} from '@/components/icons'
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { RouterLink } from 'vue-router'

import Button from '@/components/base/Button.vue'
import LoadState from '@/components/base/LoadState.vue'
import UserAvatar from '@/components/base/UserAvatar.vue'
import UploadRow from '@/components/folders/UploadRow.vue'
import type { PendingFolder } from '@/composables/useFolderActions'
import type { Upload } from '@/composables/useUploadQueue'
import type { QueryState } from '@/composables/useQueryCache'
import { bytesOf, isEmptyFile, itemKey, typeOf } from '@/utils/item'
import { getUniqueFolderName } from '@/utils/item'
import type { Item } from '@/types/item'
import { runStats } from '@/utils/workflow'
import { useWorkflowsStore } from '@/stores/workflows'
import { count, formatSize, stamp } from '@/utils/format'

/** `created` has no column: it is a folder's default order, newest first. */
export type SortKey = 'name' | 'size' | 'type' | 'owner' | 'modified' | 'created'

const props = defineProps<{
  rows: Item[]
  sort: { key: SortKey; dir: 1 | -1 }
  /** False for the paginated top level: rows keep the server's order (newest created first). */
  sortable?: boolean
  cursor: number
  /** The selected rows, by `itemKey`. */
  selected: Set<string>
  allSelected: boolean
  atRoot: boolean
  hasTask: boolean
  produced: Set<number>
  tracing: boolean
  parentPath: string
  parentName: string
  /** Load state of this listing: drives loading, failure and empty messages. */
  listing: QueryState
  /** Folders being created here; shown as placeholder rows until confirmed. */
  pendingFolders?: PendingFolder[]
  /** Files on their way into this folder; shown above the rows with progress. */
  uploads?: Upload[]
  /** A file drag is over the listing. */
  isDropTarget?: boolean
  /** Folders whose rename is being saved. */
  savingIds?: ReadonlySet<number>
  /** Asked before a rename starts (any way it starts); false keeps the name as it is. */
  mayRename?: (item: Item) => Promise<boolean>
  /** Items (`itemKey`) whose deletion is in flight: dimmed until the server confirms. */
  deletingKeys?: ReadonlySet<string>
  /** Pending work held for a moment, so fast saves never flash an indicator. */
  showPending?: boolean
  /** Why the last create or rename failed. */
  actionError?: string | null
  /** What an empty folder says instead of inviting uploads (a workflow folder). */
  emptyNote?: string
  /** The row (`itemKey`) whose menu is open, if any: its button stays visible. */
  menuRowKey?: string | null
  /** Empty files folded away; a last row says how many and shows them. */
  hiddenEmpty?: number
  /** Empty files are listed by choice: the last row offers to fold them again. */
  emptyShown?: boolean
}>()

const emit = defineEmits<{
  sort: [key: SortKey]
  toggleAll: []
  toggle: [key: string]
  rowClick: [event: MouseEvent, index: number]
  open: [item: Item]
  /** A row's menu, asked for at a point on screen (its button, or a right-click). */
  menu: [item: Item, at: { x: number; y: number }]
  pick: [index: number]
  goUp: []
  createFolder: [name: string]
  rename: [item: Item, name: string]
  retry: []
  /** The row under the mouse (null when it leaves), for prefetching. */
  hover: [item: Item | null]
  showQueue: []
  cancelUpload: [key: string]
  retryUpload: [key: string]
  dismissUpload: [key: string]
  /** Show or fold the empty files. */
  toggleEmpty: []
  /** The empty listing's own buttons, the same as the toolbar's. */
  newFolder: []
  upload: []
}>()

const workflowsStore = useWorkflowsStore()

/** These sets hold folder ids (saving) and file ids (produced): the other kind is never in them. */
const isSaving = (item: Item) => item.kind === 'folder' && !!props.savingIds?.has(item.id)
const isProduced = (item: Item) => item.kind === 'file' && props.produced.has(item.id)
const isDeleting = (item: Item) => !!props.deletingKeys?.has(itemKey(item))

/** A drop can be thousands of files; the listing stays a listing. */
const MAX_UPLOAD_ROWS = 50
const shownUploads = computed(() => (props.uploads ?? []).slice(0, MAX_UPLOAD_ROWS))
const hiddenUploads = computed(() => Math.max(0, (props.uploads?.length ?? 0) - MAX_UPLOAD_ROWS))
/** Empty files listed by choice, counted for the row that folds them again. */
const shownEmpty = computed(() => {
  if (!props.emptyShown) return 0
  const empty = props.rows.filter((row) => isEmptyFile(row)).length
  // A folder of nothing but empty files lists them either way: nothing to fold.
  return empty < props.rows.length ? empty : 0
})

/** The row menu's width (`ItemMenu`, w-64): it opens leftwards from its button. */
const MENU_WIDTH = 256

// --- Inline New Folder Creation (Finder style) ---
const isCreating = ref(false)
const newFolderName = ref('')
const newFolderInput = ref<HTMLInputElement | null>(null)
let cancelling = false

const DEFAULT_FOLDER_NAME = 'Untitled folder'

async function startCreateFolder() {
  cancelRename()
  isCreating.value = true
  cancelling = false
  const existingNames = props.rows.map((r) => r.name)
  newFolderName.value = getUniqueFolderName(DEFAULT_FOLDER_NAME, existingNames)
  await nextTick()
  newFolderInput.value?.focus()
  newFolderInput.value?.select()
}

function commitNewFolder() {
  if (cancelling) {
    cancelling = false
    return
  }
  if (!isCreating.value) return
  const name = newFolderName.value.trim() || DEFAULT_FOLDER_NAME
  isCreating.value = false
  emit('createFolder', name)
}

function cancelNewFolder() {
  cancelling = true
  isCreating.value = false
}

function onNewFolderKeydown(event: KeyboardEvent) {
  event.stopPropagation()
  if (event.key === 'Enter') {
    event.preventDefault()
    commitNewFolder()
  } else if (event.key === 'Escape') {
    event.preventDefault()
    cancelNewFolder()
  }
}

// --- Inline Renaming (Finder style) ---
const renamingKey = ref<string | null>(null)
const renamingName = ref('')
const renameInput = ref<HTMLInputElement | null>(null)
let cancellingRename = false
let renameAttempt = 0

function setRenameInput(el: unknown) {
  renameInput.value = el as HTMLInputElement | null
}

async function startRename(item: Item) {
  // One rename at a time per folder: the previous name is still being saved.
  if (isSaving(item)) return
  cancelNewFolder()
  const attempt = ++renameAttempt
  // No rights, no input: nobody should type a name the server would refuse.
  if (props.mayRename && !(await props.mayRename(item))) return
  if (attempt !== renameAttempt || !props.rows.some((r) => itemKey(r) === itemKey(item))) return
  renamingKey.value = itemKey(item)
  renamingName.value = item.name
  cancellingRename = false
  revealRow(props.rows.findIndex((r) => itemKey(r) === itemKey(item)))
  await nextTick()
  const input = renameInput.value
  if (!input) return
  input.focus()
  // Smart extension selection: for files, select only base name before extension
  if (item.kind === 'file' && item.name.includes('.')) {
    const lastDot = item.name.lastIndexOf('.')
    if (lastDot > 0) {
      input.setSelectionRange(0, lastDot)
      return
    }
  }
  input.select()
}

function commitRename() {
  if (cancellingRename) {
    cancellingRename = false
    return
  }
  if (renamingKey.value === null) return
  const key = renamingKey.value
  const targetItem = props.rows.find((r) => itemKey(r) === key)
  const trimmed = renamingName.value.trim()
  renamingKey.value = null
  if (trimmed && targetItem && trimmed !== targetItem.name) {
    emit('rename', targetItem, trimmed)
  }
}

function cancelRename() {
  renameAttempt++
  cancellingRename = true
  renameInput.value?.blur()
  renamingKey.value = null
  renamingName.value = ''
}

function onRenameKeydown(event: KeyboardEvent) {
  event.stopPropagation()
  if (event.key === 'Enter') {
    event.preventDefault()
    commitRename()
  } else if (event.key === 'Escape') {
    event.preventDefault()
    cancelRename()
  }
}

/** A row's own page: its name links there, so it opens in a click or a new tab. */
function rowPath(row: Item): string {
  return row.kind === 'folder' ? `/folder/${row.id}` : `/folder/${row.parent}/file/${row.id}`
}

function onWindowPointerDown(event: PointerEvent) {
  if (renamingKey.value === null) return
  const input = renameInput.value
  if (input && !input.contains(event.target as Node)) {
    commitRename()
  }
}

// --- Row menus & virtualization ---
const root = ref<HTMLElement | null>(null)
const tableEl = ref<HTMLElement | null>(null)

const ROW_H = 28
const OVERSCAN = 10
/** Fallback row window before layout measurement (e.g. headless DOM tests). */
const UNMEASURED_ROWS = 40

const scrollTop = ref(0)
const viewHeight = ref(0)

const prefixCount = computed(
  () =>
    (props.atRoot ? 0 : 1) +
    (isCreating.value ? 1 : 0) +
    shownUploads.value.length +
    (hiddenUploads.value ? 1 : 0) +
    (props.pendingFolders?.length ?? 0),
)

function rowsOrigin(): number {
  return (tableEl.value?.offsetTop ?? 0) + ROW_H + prefixCount.value * ROW_H
}

function effectiveWindowHeight(): number {
  return viewHeight.value > ROW_H ? viewHeight.value - ROW_H : UNMEASURED_ROWS * ROW_H
}

const rowWindow = computed(() => {
  void props.hasTask
  const total = props.rows.length
  if (!total) return { start: 0, end: 0, topPad: 0, bottomPad: 0 }
  const bodyTop = Math.max(0, scrollTop.value + ROW_H - rowsOrigin())
  const height = effectiveWindowHeight()
  const visibleStart = Math.min(total, Math.floor(bodyTop / ROW_H))
  const visibleEnd = Math.min(total, Math.ceil((bodyTop + height) / ROW_H))
  const start = Math.max(0, visibleStart - OVERSCAN)
  const end = Math.min(total, visibleEnd + OVERSCAN)
  return {
    start,
    end,
    topPad: start * ROW_H,
    bottomPad: (total - end) * ROW_H,
  }
})

const visibleRows = computed(() => {
  const { start, end } = rowWindow.value
  const out: { row: Item; index: number }[] = []
  for (let index = start; index < end; index++) {
    out.push({ row: props.rows[index]!, index })
  }
  return out
})

function onScroll(event: Event) {
  const el = event.target as HTMLElement
  if (el.clientHeight) scrollTop.value = el.scrollTop
}

function revealRow(index: number) {
  const el = root.value
  if (!el || index < UP || index >= props.rows.length) return
  const origin = rowsOrigin()
  const rowTop = origin + index * ROW_H
  const viewportH = el.clientHeight > ROW_H ? el.clientHeight : UNMEASURED_ROWS * ROW_H + ROW_H
  const currentTop = el.clientHeight > 0 ? el.scrollTop : scrollTop.value
  let nextTop = currentTop
  if (rowTop < currentTop + ROW_H) nextTop = Math.max(0, rowTop - ROW_H)
  else if (rowTop + ROW_H > currentTop + viewportH) nextTop = rowTop + ROW_H - viewportH
  if (nextTop !== currentTop) {
    scrollTop.value = nextTop
    el.scrollTop = nextTop
  }
}

let resizeObserver: ResizeObserver | undefined
onMounted(() => {
  window.addEventListener('pointerdown', onWindowPointerDown)
  if (!root.value) return
  viewHeight.value = root.value.clientHeight
  if (typeof ResizeObserver !== 'undefined') {
    resizeObserver = new ResizeObserver(([entry]) => {
      viewHeight.value = entry!.contentRect.height
      if (root.value?.clientHeight) scrollTop.value = root.value.scrollTop
    })
    resizeObserver.observe(root.value)
  }
})

onUnmounted(() => {
  window.removeEventListener('pointerdown', onWindowPointerDown)
  resizeObserver?.disconnect()
})

/** A row's `⋯` button, for anchoring its menu or flashing what it did. */
function menuButton(item: Item): HTMLElement | null {
  return root.value?.querySelector<HTMLElement>(`[data-row-menu="${itemKey(item)}"]`) ?? null
}

/** The menu acts on its row, so the cursor moves there first: you see which. */
function openMenu(row: Item, index: number, x: number, y: number) {
  emit('pick', index)
  emit('menu', row, { x, y })
}

function openMenuAtButton(row: Item, index: number, button: HTMLElement) {
  const rect = button.getBoundingClientRect()
  openMenu(row, index, rect.right - MENU_WIDTH, rect.bottom + 4)
}

/** From the keyboard: the cursor row's menu, at its button. */
function openMenuFor(index: number) {
  const row = props.rows[index]
  const button = row && menuButton(row)
  if (row && button) openMenuAtButton(row, index, button)
}

/** Narrows the rows by name; it sits in the name column's header. */
const filter = defineModel<string>('filter', { default: '' })
const filterInput = ref<HTMLInputElement | null>(null)

watch(
  () => [props.cursor, props.hasTask] as const,
  ([cursor, hasTask]) => {
    if (!hasTask) revealRow(cursor)
  },
  { immediate: true },
)

watch(filter, () => {
  scrollTop.value = 0
  if (root.value) root.value.scrollTop = 0
})

watch(
  () => props.rows.length,
  (total) => {
    const maxTop = Math.max(0, rowsOrigin() + total * ROW_H - ROW_H)
    if (scrollTop.value > maxTop) scrollTop.value = maxTop
  },
)

function focusFilter() {
  filterInput.value?.focus()
}

defineExpose({
  focusFilter,
  filterInput,
  startCreateFolder,
  cancelCreateFolder: cancelNewFolder,
  isCreating,
  startRename,
  cancelRename,
  commitRename,
  renamingKey,
  menuButton,
  openMenuFor,
})

const UP = -1

type WorkflowState = ReturnType<typeof runStats>['state']
/** A workflow folder's state, or undefined until its workflow is loaded. */
const workflowState = (folderId: number): WorkflowState | undefined => {
  const workflow = workflowsStore.workflowOf(folderId)
  return workflow && runStats(workflow).state
}
/**
 * A workflow folder's icon says how its workflow is doing, instead of a badge:
 * grey a draft, blue while it runs (queued too; pulsing once a task runs),
 * green done, red failed.
 */
const WORKFLOW_TONE: Record<WorkflowState | 'unknown', string> = {
  // A stroke colour alone is too thin to tell apart at this size: a state that
  // ran also fills the icon's two boxes solid (not the connector, an open
  // path); a draft stays an outline.
  unknown: 'text-ink-muted/60',
  draft: 'text-ink-muted/60',
  pending: '[&_rect]:fill-current text-brand-icon',
  running: '[&_rect]:fill-current text-brand-icon motion-safe:animate-pulse',
  success: '[&_rect]:fill-current text-success-icon',
  failed: '[&_rect]:fill-current text-danger-icon',
}
const WORKFLOW_SAYS: Record<WorkflowState, string> = {
  draft: 'draft',
  pending: 'queued',
  running: 'running',
  success: 'done',
  failed: 'failed',
}

type Column = { key: SortKey | 'case'; label: string; align?: 'right' }

const COLUMNS: Column[] = [
  { key: 'name', label: 'name' },
  { key: 'size', label: 'size', align: 'right' },
  { key: 'type', label: 'type' },
  { key: 'owner', label: 'owner' },
  { key: 'modified', label: 'modified (utc)' },
]
/**
 * The top level holds only folders, which have no size and one type: those
 * columns would say the same on every row. A top-level folder can be a case's,
 * so its reference takes their place.
 */
const ROOT_COLUMNS: Column[] = [
  { key: 'name', label: 'name' },
  { key: 'case', label: 'case' },
  { key: 'owner', label: 'owner' },
  { key: 'modified', label: 'modified (utc)' },
]
const columns = computed(() => (props.atRoot ? ROOT_COLUMNS : COLUMNS))
</script>

<template>
  <!-- The inset ring marks a file drag without changing the layout. -->
  <div
    ref="root"
    class="min-w-0 flex-1 overflow-auto"
    :class="{ 'ring-1 ring-brand ring-inset': isDropTarget }"
    @scroll="onScroll"
  >
    <slot name="workflow" />

    <table ref="tableEl" class="w-full min-w-3xl table-fixed border-collapse text-left">
      <colgroup>
        <col class="w-8" />
        <col />
        <template v-if="atRoot"><col class="w-44" /></template>
        <template v-else>
          <col class="w-44" />
          <col class="w-44" />
        </template>
        <col class="w-20" />
        <col class="w-40" />
        <!-- each row's menu -->
        <col class="w-8" />
      </colgroup>
      <thead class="sticky top-0 z-[1] bg-surface">
        <tr class="h-7 shadow-[inset_0_-1px_0_var(--color-border)]">
          <th class="pl-3">
            <input
              type="checkbox"
              class="accent-brand align-middle"
              aria-label="Select all"
              v-tooltip="allSelected ? 'Deselect all rows' : 'Select all rows'"
              :checked="allSelected"
              :disabled="!rows.length"
              @change="emit('toggleAll')"
            />
          </th>
          <th
            v-for="column in columns"
            :key="column.key"
            class="px-2 font-normal"
            :class="{ 'text-right': column.align === 'right' }"
            :aria-sort="
              sortable && sort.key === column.key
                ? sort.dir === 1
                  ? 'ascending'
                  : 'descending'
                : undefined
            "
          >
            <!-- Paginated by the server, which only orders by creation: plain labels. -->
            <span
              v-if="!sortable"
              class="micro-label"
              v-tooltip="
                column.key === 'modified' ? 'Newest created first, across pages' : undefined
              "
              >{{ column.label }}</span
            >
            <!-- The filter matches names, so it lives in their header. No filter at
                 the root: the top-level list is found through the prompt. -->
            <div
              v-else
              :class="
                column.key === 'name' && !atRoot ? 'flex min-w-0 items-center gap-2' : 'contents'
              "
            >
              <button
                type="button"
                class="micro-label inline-flex shrink-0 cursor-pointer items-center gap-1 hover:text-ink"
                :class="{ 'text-ink-secondary': sort.key === column.key }"
                v-tooltip="
                  sort.key === column.key
                    ? {
                        text: sort.dir === 1 ? 'Sorted ascending' : 'Sorted descending',
                        detail: 'Click to invert',
                      }
                    : 'Sort by this column'
                "
                @click="emit('sort', column.key as SortKey)"
              >
                {{ column.label }}
                <component
                  :is="sort.dir === 1 ? ArrowUp : ArrowDown"
                  v-if="sort.key === column.key"
                  :size="10"
                  :stroke-width="2"
                />
              </button>
              <input
                v-if="column.key === 'name' && !atRoot"
                :ref="(el) => (filterInput = el as HTMLInputElement | null)"
                v-model="filter"
                type="search"
                aria-label="Filter by name"
                placeholder="filter names"
                class="h-5 w-full max-w-52 min-w-0 rounded-(--radius-control) border border-border-strong bg-surface px-1.5 font-normal text-ink placeholder:text-ink-muted"
              />
            </div>
          </th>
          <th><span class="sr-only">actions</span></th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-if="!atRoot"
          :data-row="UP"
          v-scroll-into-view="cursor === UP && !hasTask"
          class="h-7 scroll-mt-7 cursor-default border-b border-border/60 select-none"
          :class="[
            cursor === UP && !hasTask
              ? 'bg-sunken shadow-[inset_2px_0_0_var(--color-brand)]'
              : 'hover:bg-sunken',
            tracing ? 'opacity-40' : '',
          ]"
          @click="emit('pick', UP)"
          @dblclick="emit('goUp')"
        >
          <td class="pl-3" />
          <td class="px-2">
            <div class="flex min-w-0 items-center gap-2">
              <CornerLeftUp
                :size="13"
                :stroke-width="1.5"
                class="shrink-0 text-ink-muted"
                aria-hidden="true"
              />
              <RouterLink
                :to="parentPath"
                class="text-brand hover:underline"
                :aria-label="`Up to ${parentName}`"
                v-tooltip="'Up to the parent folder'"
                @click.stop
                >..</RouterLink
              >
              <span class="truncate text-[11px] text-ink-muted" v-overflow-tooltip>{{
                parentName
              }}</span>
            </div>
          </td>
          <td colspan="5" />
        </tr>

        <!-- Inline New Folder Row (Finder style) -->
        <tr v-if="isCreating" class="h-7 border-b border-border/60 bg-brand-selected select-none">
          <td class="pl-3">
            <input
              type="checkbox"
              disabled
              tabindex="-1"
              class="accent-brand align-middle opacity-30"
            />
          </td>
          <td class="px-2">
            <div class="flex min-w-0 w-full items-center gap-2">
              <Folder
                :size="13"
                :stroke-width="1.5"
                class="shrink-0 fill-current text-brand-icon"
                aria-hidden="true"
              />
              <input
                ref="newFolderInput"
                v-model="newFolderName"
                type="text"
                spellcheck="false"
                class="h-6 w-full min-w-0 flex-1 rounded-(--radius-check) border border-brand bg-surface px-2 font-mono text-[12px] font-medium text-ink shadow-sm outline-none"
                aria-label="New folder name"
                @keydown="onNewFolderKeydown"
                @blur="commitNewFolder"
              />
            </div>
          </td>
          <td v-if="atRoot" class="px-2"><span class="select-none text-ink-muted">—</span></td>
          <template v-else>
            <td class="px-2 text-right">
              <span class="select-none text-ink-muted">—</span>
            </td>
            <td class="truncate px-2 text-ink-muted">directory</td>
          </template>
          <td class="px-2" />
          <td class="tabular truncate px-2 text-ink-secondary">just now</td>
          <td />
        </tr>

        <!-- Files on their way to the server. A large drop is thousands of
             rows, so the listing shows the first few and counts the rest. -->
        <UploadRow
          v-for="upload in shownUploads"
          :key="upload.key"
          :upload="upload"
          :show-pending="showPending"
          @cancel="emit('cancelUpload', upload.key)"
          @retry="emit('retryUpload', upload.key)"
          @dismiss="emit('dismissUpload', upload.key)"
        />

        <tr v-if="hiddenUploads" class="h-7 border-b border-border/60 select-none">
          <td class="pl-3" />
          <td class="px-2 text-ink-muted" :colspan="columns.length + 1">
            and {{ count(hiddenUploads, 'more file') }} uploading —
            <button
              type="button"
              class="cursor-pointer underline hover:text-ink"
              @click="emit('showQueue')"
            >
              show the queue
            </button>
          </td>
        </tr>

        <!-- Folders the server has not confirmed yet -->
        <tr
          v-for="pending in pendingFolders"
          :key="pending.key"
          class="h-7 border-b border-border/60 select-none"
          aria-busy="true"
        >
          <td class="pl-3">
            <input
              type="checkbox"
              disabled
              tabindex="-1"
              class="accent-brand align-middle opacity-30"
              :aria-label="`${pending.name} is being created`"
            />
          </td>
          <td class="px-2">
            <div class="flex min-w-0 items-center gap-2">
              <Folder
                :size="13"
                :stroke-width="1.5"
                class="shrink-0 fill-current text-brand-icon"
                aria-hidden="true"
              />
              <span class="truncate font-mono text-ink-secondary">{{ pending.name }}/</span>
            </div>
          </td>
          <td v-if="!atRoot" class="px-2 text-right">
            <span class="select-none text-ink-muted">—</span>
          </td>
          <td class="truncate px-2 text-ink-muted">
            <span v-if="showPending" class="inline-flex items-center gap-1.5 text-brand">
              <span class="size-1.5 animate-pulse rounded-full bg-brand" aria-hidden="true" />
              creating…
            </span>
            <template v-else>{{ atRoot ? '—' : 'directory' }}</template>
          </td>
          <td class="px-2" />
          <td class="tabular truncate px-2 text-ink-secondary">just now</td>
          <td />
        </tr>

        <tr v-if="rowWindow.topPad > 0" aria-hidden="true" data-spacer="top">
          <td
            :colspan="columns.length + 2"
            class="border-0 p-0 text-[0px] leading-none"
            :style="{ height: `${rowWindow.topPad}px` }"
          />
        </tr>

        <tr
          v-for="{ row, index } in visibleRows"
          :key="itemKey(row)"
          :data-row="index"
          v-scroll-into-view="index === cursor && !hasTask"
          class="group h-7 scroll-mt-7 cursor-default border-b border-border/60 select-none"
          :class="[
            selected.has(itemKey(row)) ? 'bg-brand-selected' : 'hover:bg-sunken',
            tracing
              ? isProduced(row)
                ? 'bg-brand-tint/50 shadow-[inset_2px_0_0_var(--color-brand)]'
                : 'opacity-40'
              : '',
            index === cursor && !hasTask ? 'shadow-[inset_2px_0_0_var(--color-brand)]' : '',
            index === cursor && !hasTask && !selected.has(itemKey(row)) ? 'bg-sunken' : '',
            isDeleting(row) ? 'pointer-events-none opacity-50' : '',
          ]"
          :aria-busy="isDeleting(row) || undefined"
          :data-output="isProduced(row) || undefined"
          :aria-selected="selected.has(itemKey(row))"
          @click="emit('rowClick', $event, index)"
          @dblclick="emit('open', row)"
          @contextmenu.prevent="openMenu(row, index, $event.clientX, $event.clientY)"
          @pointerenter="emit('hover', row)"
          @pointerleave="emit('hover', null)"
        >
          <td class="pl-3">
            <input
              type="checkbox"
              class="accent-brand align-middle"
              :aria-label="`Select ${row.name}`"
              :checked="selected.has(itemKey(row))"
              @change="emit('toggle', itemKey(row))"
            />
          </td>
          <td class="px-2">
            <div class="flex min-w-0 w-full items-center gap-2">
              <component
                :is="
                  row.kind === 'file' ? File : row.workflowId !== undefined ? WorkflowIcon : Folder
                "
                :size="13"
                :stroke-width="row.workflowId !== undefined ? 2 : 1.5"
                class="shrink-0"
                :class="
                  row.workflowId !== undefined
                    ? WORKFLOW_TONE[workflowState(row.id) ?? 'unknown']
                    : row.kind === 'folder'
                      ? 'fill-current text-brand-icon'
                      : 'text-ink-muted'
                "
                :aria-label="
                  row.workflowId !== undefined
                    ? `Workflow${workflowState(row.id) ? ', ' + WORKFLOW_SAYS[workflowState(row.id)!] : ''}`
                    : undefined
                "
                :aria-hidden="row.workflowId === undefined"
                v-tooltip="
                  row.workflowId !== undefined && workflowState(row.id)
                    ? `Workflow: ${WORKFLOW_SAYS[workflowState(row.id)!]}`
                    : ''
                "
              />
              <input
                v-if="renamingKey === itemKey(row)"
                :ref="setRenameInput"
                v-model="renamingName"
                type="text"
                spellcheck="false"
                class="h-6 w-full min-w-0 flex-1 rounded-(--radius-check) border border-brand bg-surface px-2 font-mono text-[12px] font-medium text-ink shadow-sm outline-none"
                :aria-label="`Rename ${row.name}`"
                @click.stop
                @dblclick.stop
                @keydown="onRenameKeydown"
                @blur="commitRename"
              />
              <RouterLink
                v-else
                :to="rowPath(row)"
                class="truncate font-mono select-none hover:underline"
                :class="isEmptyFile(row) ? 'text-ink-muted' : 'text-ink'"
                draggable="false"
                v-overflow-tooltip
                @click.stop
                @dblclick.stop
              >
                {{ row.name }}{{ row.kind === 'folder' ? '/' : '' }}
              </RouterLink>
            </div>
          </td>
          <td v-if="atRoot" class="truncate px-2">
            <span
              v-if="showPending && (isSaving(row) || isDeleting(row))"
              class="inline-flex items-center gap-1.5 text-brand"
            >
              <span class="size-1.5 animate-pulse rounded-full bg-brand" aria-hidden="true" />
              {{ isDeleting(row) ? 'deleting…' : 'saving…' }}
            </span>
            <span v-else-if="row.caseRef" class="tabular text-ink-secondary" v-overflow-tooltip>{{
              row.caseRef
            }}</span>
            <span v-else class="select-none text-ink-muted">—</span>
          </td>
          <template v-else>
            <td class="px-2">
              <div class="flex items-center justify-end gap-2">
                <span
                  v-if="isEmptyFile(row)"
                  class="select-none text-ink-muted"
                  v-tooltip="'Empty file: 0 bytes'"
                  >—</span
                >
                <span
                  v-else-if="row.kind === 'file'"
                  class="tabular text-ink-secondary"
                  v-tooltip="`${bytesOf(row).toLocaleString('en-US')} bytes`"
                  >{{ formatSize(bytesOf(row)) }}</span
                >
                <span
                  v-else
                  class="select-none text-ink-muted"
                  v-tooltip="'Folder size not calculated'"
                  >—</span
                >
              </div>
            </td>
            <td class="truncate px-2 text-ink-muted">
              <span
                v-if="showPending && (isSaving(row) || isDeleting(row))"
                class="inline-flex items-center gap-1.5 text-brand"
              >
                <span class="size-1.5 animate-pulse rounded-full bg-brand" aria-hidden="true" />
                {{ isDeleting(row) ? 'deleting…' : 'saving…' }}
              </span>
              <template v-else>{{ typeOf(row) }}</template>
            </td>
          </template>
          <td class="px-2">
            <UserAvatar :name="row.owner" :username="row.ownerUsername" :src="row.ownerAvatar" />
          </td>
          <td class="tabular truncate px-2 text-ink-secondary">{{ stamp(row.modified) }}</td>
          <td class="pr-1">
            <!-- On hover, on the cursor row, and while its menu is open; always reachable by Tab.
                 Not "outside" its menu: pressing it again closes the menu, not reopens it. -->
            <button
              type="button"
              :data-row-menu="itemKey(row)"
              data-click-outside-ignore
              class="flex size-6 cursor-pointer items-center justify-center rounded-(--radius-control) text-ink-muted group-hover:opacity-100 hover:bg-surface hover:text-ink focus-visible:opacity-100"
              :class="index === cursor || menuRowKey === itemKey(row) ? 'opacity-100' : 'opacity-0'"
              :aria-label="`Actions for ${row.name}`"
              aria-haspopup="menu"
              :aria-expanded="menuRowKey === itemKey(row)"
              v-tooltip="'Actions'"
              @click.stop="openMenuAtButton(row, index, $event.currentTarget as HTMLElement)"
              @dblclick.stop
            >
              <Ellipsis :size="14" :stroke-width="1.5" />
            </button>
          </td>
        </tr>

        <tr v-if="rowWindow.bottomPad > 0" aria-hidden="true" data-spacer="bottom">
          <td
            :colspan="columns.length + 2"
            class="border-0 p-0 text-[0px] leading-none"
            :style="{ height: `${rowWindow.bottomPad}px` }"
          />
        </tr>

        <tr v-if="hiddenEmpty || shownEmpty" class="h-7 select-none">
          <td class="pl-3" />
          <td class="px-2 text-ink-muted" :colspan="columns.length + 1">
            <button
              type="button"
              class="tabular cursor-pointer hover:text-ink hover:underline"
              :aria-pressed="!!emptyShown"
              @click="emit('toggleEmpty')"
            >
              {{
                hiddenEmpty
                  ? `${count(hiddenEmpty, 'empty file')} hidden · show`
                  : `hide ${count(shownEmpty, 'empty file')}`
              }}
            </button>
          </td>
        </tr>
      </tbody>
    </table>

    <p v-if="actionError" role="alert" class="px-3 py-2 text-danger">{{ actionError }}</p>

    <LoadState
      :state="listing"
      :noun="atRoot ? 'folders' : 'contents'"
      :has-content="rows.length > 0 || isCreating || !!pendingFolders?.length || !!uploads?.length"
      @retry="emit('retry')"
    >
      <template #empty>
        <template v-if="filter">Nothing here matches “{{ filter }}”.</template>
        <!-- Secondary: the toolbar holds the view's one primary. -->
        <template v-else-if="atRoot">
          <span>No folders yet.</span>
          <Button size="row" @click="emit('newFolder')">
            <template #icon><FolderPlus :size="13" :stroke-width="1.5" /></template>
            New folder
          </Button>
        </template>
        <template v-else-if="emptyNote">{{ emptyNote }}</template>
        <template v-else>
          <span>Empty folder. Drop files here, or</span>
          <Button size="row" @click="emit('upload')">
            <template #icon><UploadIcon :size="13" :stroke-width="1.5" /></template>
            Upload
          </Button>
          <Button size="row" @click="emit('newFolder')">
            <template #icon><FolderPlus :size="13" :stroke-width="1.5" /></template>
            New folder
          </Button>
        </template>
      </template>
    </LoadState>
  </div>
</template>
