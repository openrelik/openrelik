<script setup lang="ts">
import {
  ArrowDown,
  ArrowUp,
  CornerLeftUp,
  File,
  Folder,
  Workflow as WorkflowIcon,
} from '@/components/icons'
import { computed, nextTick, onMounted, onUnmounted, ref } from 'vue'
import { RouterLink } from 'vue-router'

import LoadState from '@/components/base/LoadState.vue'
import UserAvatar from '@/components/base/UserAvatar.vue'
import UploadRow from '@/components/folders/UploadRow.vue'
import type { PendingFolder } from '@/composables/useFolderActions'
import type { Upload } from '@/composables/useUploadQueue'
import type { QueryState } from '@/composables/useQueryCache'
import { bytesOf, typeOf } from '@/data/files'
import { getUniqueFolderName, type Item } from '@/data/folders'
import { runStats, workflowOf } from '@/data/workflows'
import { count, formatSize, stamp } from '@/utils/format'

export type SortKey = 'name' | 'size' | 'type' | 'owner' | 'modified'

const props = defineProps<{
  rows: Item[]
  sort: { key: SortKey; dir: 1 | -1 }
  /** False for the paginated top level: rows keep the server's order (newest created first). */
  sortable?: boolean
  cursor: number
  selected: Set<number>
  allSelected: boolean
  atRoot: boolean
  hasTask: boolean
  produced: Set<number>
  tracing: boolean
  parentPath: string
  parentName: string
  maxBytes: number
  filter: string
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
  /** Folders whose deletion is in flight: dimmed until the server confirms. */
  deletingIds?: ReadonlySet<number>
  /** Pending work held for a moment, so fast saves never flash an indicator. */
  showPending?: boolean
  /** Why the last create or rename failed. */
  actionError?: string | null
  /** What an empty folder says instead of inviting uploads (a workflow folder). */
  emptyNote?: string
}>()

const emit = defineEmits<{
  sort: [key: SortKey]
  toggleAll: []
  toggle: [id: number]
  rowClick: [event: MouseEvent, index: number]
  open: [item: Item]
  pick: [index: number]
  goUp: []
  createFolder: [name: string]
  rename: [item: { id: number; name: string }]
  retry: []
  /** The row under the mouse (null when it leaves), for prefetching. */
  hover: [item: Item | null]
  showQueue: []
  cancelUpload: [key: string]
  retryUpload: [key: string]
  dismissUpload: [key: string]
}>()

/** A drop can be thousands of files; the listing stays a listing. */
const MAX_UPLOAD_ROWS = 50
const shownUploads = computed(() => (props.uploads ?? []).slice(0, MAX_UPLOAD_ROWS))
const hiddenUploads = computed(() => Math.max(0, (props.uploads?.length ?? 0) - MAX_UPLOAD_ROWS))

// --- Inline New Folder Creation (Finder style) ---
const isCreating = ref(false)
const newFolderName = ref('')
const newFolderInput = ref<HTMLInputElement | null>(null)
let cancelling = false

const defaultBaseName = computed(() => (props.atRoot ? 'Untitled case' : 'Untitled folder'))

async function startCreateFolder() {
  isCreating.value = true
  cancelling = false
  const existingNames = props.rows.map((r) => r.name)
  newFolderName.value = getUniqueFolderName(defaultBaseName.value, existingNames)
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
  const name = newFolderName.value.trim() || defaultBaseName.value
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
const renamingId = ref<number | null>(null)
const renamingName = ref('')
const renameInput = ref<HTMLInputElement | null>(null)
let cancellingRename = false

function setRenameInput(el: unknown) {
  if (el) renameInput.value = el as HTMLInputElement
}

async function startRename(item: Item) {
  // One rename at a time per folder: the previous name is still being saved.
  if (props.savingIds?.has(item.id)) return
  // No rights, no input: nobody should type a name the server would refuse.
  if (props.mayRename && !(await props.mayRename(item))) return
  renamingId.value = item.id
  renamingName.value = item.name
  cancellingRename = false
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
  if (renamingId.value === null) return
  const id = renamingId.value
  const targetItem = props.rows.find((r) => r.id === id)
  const trimmed = renamingName.value.trim()
  renamingId.value = null
  if (trimmed && targetItem && trimmed !== targetItem.name) {
    emit('rename', { id, name: trimmed })
  }
}

function cancelRename() {
  cancellingRename = true
  renameInput.value?.blur()
  renamingId.value = null
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

// --- Long-Press on Release Detection (Finder style) ---
const LONG_PRESS_THRESHOLD_MS = 400
let pointerDownTime = 0
let pointerDownPos = { x: 0, y: 0 }
let wasDragged = false

function onLabelPointerDown(event: PointerEvent, row: Item, index: number) {
  pointerDownTime = 0
  wasDragged = false

  // Only consider long-press if this row is already selected
  const isAlreadySelected =
    props.cursor === index || (props.selected.has(row.id) && props.selected.size === 1)
  if (!isAlreadySelected) return

  pointerDownTime = Date.now()
  pointerDownPos = { x: event.clientX, y: event.clientY }
}

function onLabelPointerMove(event: PointerEvent) {
  if (!pointerDownTime) return
  const dx = Math.abs(event.clientX - pointerDownPos.x)
  const dy = Math.abs(event.clientY - pointerDownPos.y)
  if (dx > 4 || dy > 4) {
    wasDragged = true
    pointerDownTime = 0
  }
}

function onLabelPointerUp(event: PointerEvent, row: Item) {
  if (pointerDownTime > 0 && !wasDragged) {
    const elapsed = Date.now() - pointerDownTime
    pointerDownTime = 0

    // User held down and now released: activate rename if held >= 500ms
    if (elapsed >= LONG_PRESS_THRESHOLD_MS) {
      event.preventDefault()
      event.stopPropagation()
      startRename(row)
      return
    }
  }
  pointerDownTime = 0
  wasDragged = false
}

function onLabelPointerCancel() {
  pointerDownTime = 0
  wasDragged = false
}

function onRowDblClick(row: Item) {
  pointerDownTime = 0
  wasDragged = false
  emit('open', row)
}

function onWindowPointerDown(event: PointerEvent) {
  if (renamingId.value === null) return
  const input = renameInput.value
  if (input && !input.contains(event.target as Node)) {
    commitRename()
  }
}

onMounted(() => {
  window.addEventListener('pointerdown', onWindowPointerDown)
})

onUnmounted(() => {
  window.removeEventListener('pointerdown', onWindowPointerDown)
})

defineExpose({
  startCreateFolder,
  isCreating,
  startRename,
  cancelRename,
  commitRename,
  renamingId,
})

const UP = -1

type WorkflowState = ReturnType<typeof runStats>['state']
/** A workflow folder's state, or undefined until its workflow is loaded. */
const workflowState = (folderId: number): WorkflowState | undefined => {
  const workflow = workflowOf(folderId)
  return workflow && runStats(workflow).state
}
/**
 * A workflow folder's icon says how its workflow is doing, instead of a badge:
 * grey a draft, blue while it runs (queued too; pulsing once a task runs),
 * green done, red failed.
 */
const WORKFLOW_TONE: Record<WorkflowState | 'unknown', string> = {
  // A stroke colour alone is too thin to tell apart at this size: a state that
  // ran also fills the icon with its tint; a draft stays an outline.
  unknown: 'text-ink-muted/60',
  draft: 'text-ink-muted/60',
  pending: 'fill-brand/25 text-brand',
  running: 'fill-brand/25 text-brand motion-safe:animate-pulse',
  success: 'fill-success/25 text-success',
  failed: 'fill-danger/25 text-danger',
}
const WORKFLOW_SAYS: Record<WorkflowState, string> = {
  draft: 'draft',
  pending: 'queued',
  running: 'running',
  success: 'done',
  failed: 'failed',
}

const COLUMNS: { key: SortKey; label: string; align?: 'right' }[] = [
  { key: 'name', label: 'name' },
  { key: 'size', label: 'size', align: 'right' },
  { key: 'type', label: 'type' },
  { key: 'owner', label: 'owner' },
  { key: 'modified', label: 'modified (utc)' },
]
</script>

<template>
  <!-- The inset ring marks a file drag without changing the layout. -->
  <div
    class="min-w-0 flex-1 overflow-auto"
    :class="{ 'ring-1 ring-brand ring-inset': isDropTarget }"
  >
    <slot name="workflow" />

    <table class="w-full min-w-3xl table-fixed border-collapse text-left">
      <colgroup>
        <col class="w-8" />
        <col />
        <col class="w-44" />
        <col class="w-44" />
        <col class="w-20" />
        <col class="w-40" />
      </colgroup>
      <thead class="sticky top-0 z-[1] bg-surface">
        <tr class="h-7 shadow-[inset_0_-1px_0_var(--color-border)]">
          <th class="pl-3">
            <input
              type="checkbox"
              class="accent-brand align-middle"
              aria-label="Select all"
              v-tooltip="allSelected ? 'Deselect all rows (x)' : 'Select all rows (x)'"
              :checked="allSelected"
              :disabled="!rows.length"
              @change="emit('toggleAll')"
            />
          </th>
          <th
            v-for="column in COLUMNS"
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
            <button
              v-else
              type="button"
              class="micro-label inline-flex cursor-pointer items-center gap-1 hover:text-ink"
              :class="{ 'text-ink-secondary': sort.key === column.key }"
              v-tooltip="
                sort.key === column.key
                  ? sort.dir === 1
                    ? `Sorted by ${column.label} ascending (click to invert)`
                    : `Sorted by ${column.label} descending (click to invert)`
                  : `Sort by ${column.label}`
              "
              @click="emit('sort', column.key)"
            >
              {{ column.label }}
              <component
                :is="sort.dir === 1 ? ArrowUp : ArrowDown"
                v-if="sort.key === column.key"
                :size="10"
                :stroke-width="2"
              />
            </button>
          </th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-if="!atRoot"
          :data-row="UP"
          v-scroll-into-view="cursor === UP && !hasTask"
          class="h-7 cursor-default border-b border-border/60 select-none"
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
                v-tooltip="`Navigate up to ${parentName}`"
                @click.stop
                >..</RouterLink
              >
              <span class="truncate text-[11px] text-ink-muted" v-overflow-tooltip>{{
                parentName
              }}</span>
            </div>
          </td>
          <td colspan="4" />
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
                class="shrink-0 fill-brand-tint text-brand"
                aria-hidden="true"
              />
              <input
                ref="newFolderInput"
                v-model="newFolderName"
                type="text"
                spellcheck="false"
                class="h-6 w-full min-w-0 flex-1 rounded-(--radius-check) border border-brand bg-surface px-2 text-[12px] font-medium text-ink shadow-sm outline-none"
                aria-label="New folder name"
                @keydown="onNewFolderKeydown"
                @blur="commitNewFolder"
              />
            </div>
          </td>
          <td class="px-2 text-right">
            <span class="select-none text-ink-muted">—</span>
          </td>
          <td class="truncate px-2 text-ink-muted">inode/directory</td>
          <td class="px-2" />
          <td class="tabular truncate px-2 text-ink-secondary">just now</td>
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
          <td class="px-2 text-ink-muted" colspan="5">
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
                class="shrink-0 fill-brand-tint text-brand"
                aria-hidden="true"
              />
              <span class="truncate text-ink-secondary">{{ pending.name }}/</span>
            </div>
          </td>
          <td class="px-2 text-right">
            <span class="select-none text-ink-muted">—</span>
          </td>
          <td class="truncate px-2 text-ink-muted">
            <span v-if="showPending" class="inline-flex items-center gap-1.5 text-brand">
              <span class="size-1.5 animate-pulse rounded-full bg-brand" aria-hidden="true" />
              creating…
            </span>
            <template v-else>inode/directory</template>
          </td>
          <td class="px-2" />
          <td class="tabular truncate px-2 text-ink-secondary">just now</td>
        </tr>

        <tr
          v-for="(row, index) in rows"
          :key="row.id"
          :data-row="index"
          v-scroll-into-view="index === cursor && !hasTask"
          class="h-7 cursor-default border-b border-border/60 select-none"
          :class="[
            selected.has(row.id) ? 'bg-brand-selected' : 'hover:bg-sunken',
            tracing
              ? produced.has(row.id)
                ? 'bg-brand-tint/50 shadow-[inset_2px_0_0_var(--color-brand)]'
                : 'opacity-40'
              : '',
            index === cursor && !hasTask ? 'shadow-[inset_2px_0_0_var(--color-brand)]' : '',
            index === cursor && !hasTask && !selected.has(row.id) ? 'bg-sunken' : '',
            deletingIds?.has(row.id) ? 'pointer-events-none opacity-50' : '',
          ]"
          :aria-busy="deletingIds?.has(row.id) || undefined"
          :data-output="produced.has(row.id) || undefined"
          :aria-selected="selected.has(row.id)"
          @click="emit('rowClick', $event, index)"
          @dblclick="onRowDblClick(row)"
          @pointerenter="emit('hover', row)"
          @pointerleave="emit('hover', null)"
        >
          <td class="pl-3">
            <input
              type="checkbox"
              class="accent-brand align-middle"
              :aria-label="`Select ${row.name}`"
              v-tooltip="selected.has(row.id) ? `Deselect ${row.name}` : `Select ${row.name}`"
              :checked="selected.has(row.id)"
              @change="emit('toggle', row.id)"
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
                      ? 'fill-brand-tint text-brand'
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
                v-if="renamingId === row.id"
                :ref="setRenameInput"
                v-model="renamingName"
                type="text"
                spellcheck="false"
                class="h-6 w-full min-w-0 flex-1 rounded-(--radius-check) border border-brand bg-surface px-2 text-[12px] font-medium text-ink shadow-sm outline-none"
                :aria-label="`Rename ${row.name}`"
                @click.stop
                @dblclick.stop
                @keydown="onRenameKeydown"
                @blur="commitRename"
              />
              <span
                v-else
                class="truncate text-ink select-none"
                v-overflow-tooltip
                @pointerdown="onLabelPointerDown($event, row, index)"
                @pointermove="onLabelPointerMove"
                @pointerup="onLabelPointerUp($event, row)"
                @pointercancel="onLabelPointerCancel"
              >
                {{ row.name }}{{ row.kind === 'folder' ? '/' : '' }}
              </span>
              <span
                v-if="renamingId !== row.id && produced.has(row.id)"
                class="badge shrink-0 border-brand/40 bg-brand-tint text-brand"
                v-tooltip="'Produced by workflow task'"
                >output</span
              >
            </div>
          </td>
          <td class="px-2">
            <div class="flex items-center justify-end gap-2">
              <template v-if="row.kind === 'file'">
                <span class="tabular text-ink-secondary">{{ formatSize(bytesOf(row)) }}</span>
                <span class="h-1 w-12 shrink-0 bg-border" aria-hidden="true">
                  <span
                    class="block h-full bg-ink-muted/60"
                    :style="{ width: `${Math.max(2, (bytesOf(row) / maxBytes) * 100)}%` }"
                  />
                </span>
              </template>
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
              v-if="showPending && (savingIds?.has(row.id) || deletingIds?.has(row.id))"
              class="inline-flex items-center gap-1.5 text-brand"
            >
              <span class="size-1.5 animate-pulse rounded-full bg-brand" aria-hidden="true" />
              {{ deletingIds?.has(row.id) ? 'deleting…' : 'saving…' }}
            </span>
            <template v-else>{{ typeOf(row) }}</template>
          </td>
          <td class="px-2">
            <UserAvatar :name="row.owner" :username="row.ownerUsername" :src="row.ownerAvatar" />
          </td>
          <td class="tabular truncate px-2 text-ink-secondary">{{ stamp(row.modified) }}</td>
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
        <template v-else-if="atRoot">No folders yet. Create one with New folder.</template>
        <template v-else-if="emptyNote">{{ emptyNote }}</template>
        <template v-else>Empty folder. Drop files here or use Upload.</template>
      </template>
    </LoadState>
  </div>
</template>
