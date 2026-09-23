<script setup lang="ts">
import {
  Download,
  File,
  Files,
  FolderOpen,
  Pencil,
  Play,
  Trash2,
  UserPlus,
  Workflow,
  X,
} from '@/components/icons'
import { computed } from 'vue'

import Button from '@/components/base/Button.vue'
import KeyValueRow from '@/components/base/KeyValueRow.vue'
import { openShareDialog } from '@/composables/useShareDialog'
import { openWorkflowDialog } from '@/composables/useWorkflowDialog'
import type { Item } from '@/data/folders'
import { count, formatSize, stamp } from '@/utils/format'

/**
 * Everything known about one item, or an aggregated view of multiple selected items.
 */
const props = defineProps<{
  item: Item
  /** The workflow task that produced this file, when it is an output. */
  producer?: string
  selectedFiles?: Item[]
  selectedItems?: Item[]
  /** The operator may delete what Delete would act on (owner of every folder in it). */
  canDelete?: boolean
  /** The operator may rename the item shown (owner or editor of the folder). */
  canRename?: boolean
}>()

const emit = defineEmits<{
  open: [id: number]
  runMore: []
  clearSelection: []
  toggleItem: [id: number]
  rename: [id: number]
  /** Delete these items (the view asks for confirmation first). */
  delete: [items: Item[]]
}>()

const isMulti = computed(() => {
  const itemsCount = props.selectedItems?.length ?? 0
  const filesCount = props.selectedFiles?.length ?? 0
  return itemsCount > 1 || filesCount > 1
})

const multiItems = computed(() => props.selectedItems ?? props.selectedFiles ?? [])
const multiFiles = computed(
  () => props.selectedFiles ?? multiItems.value.filter((i) => i.kind === 'file'),
)
const multiFolders = computed(() => multiItems.value.filter((i) => i.kind === 'folder'))

const multiTotalBytes = computed(() => multiFiles.value.reduce((sum, f) => sum + (f.size ?? 0), 0))

const multiHeaderTitle = computed(() => {
  if (multiFiles.value.length > 0 && multiFolders.value.length === 0) {
    return `${count(multiFiles.value.length, 'file')} selected`
  }
  if (multiFolders.value.length > 0 && multiFiles.value.length === 0) {
    return `${count(multiFolders.value.length, 'folder')} selected`
  }
  return `${count(multiItems.value.length, 'item')} selected`
})

const multiSubTitle = computed(() => {
  if (multiFolders.value.length > 0 && multiFiles.value.length > 0) {
    return `${count(multiFiles.value.length, 'file')} (${formatSize(multiTotalBytes.value)}), ${count(multiFolders.value.length, 'folder')}`
  }
  if (multiFiles.value.length > 0) {
    return `${formatSize(multiTotalBytes.value)} total`
  }
  return undefined
})

const typeSummary = computed(() => {
  if (!multiFiles.value.length) return undefined
  const map = new Map<string, number>()
  for (const f of multiFiles.value) {
    const t = f.mime ?? 'unknown'
    map.set(t, (map.get(t) ?? 0) + 1)
  }
  const entries = Array.from(map.entries())
  if (entries.length === 1) {
    return `${entries[0]![0]} (${entries[0]![1]})`
  }
  if (entries.length <= 2) {
    return entries.map(([t, c]) => `${t} (${c})`).join(', ')
  }
  return `${entries.length} distinct types`
})

const bytes = computed(() => props.item.size ?? 0)

function openWorkflow() {
  const targetFiles = isMulti.value
    ? multiFiles.value
    : props.item.kind === 'file'
      ? [props.item]
      : []
  if (!targetFiles.length) return
  const parentFolderId = targetFiles[0]?.parent ?? props.item.parent ?? 0
  openWorkflowDialog(targetFiles, parentFolderId)
}
</script>

<template>
  <aside class="flex min-h-0 flex-col" aria-label="Inspector">
    <p class="micro-label flex h-7 shrink-0 items-center border-b border-border px-3">inspector</p>

    <!-- Multi-selection mode -->
    <div v-if="isMulti" class="min-h-0 flex-1 overflow-y-auto px-3 py-2.5">
      <div class="flex items-start gap-2">
        <Files
          :size="16"
          :stroke-width="1.5"
          class="mt-px shrink-0 text-brand"
          aria-hidden="true"
        />
        <div class="min-w-0 flex-1">
          <p class="font-semibold text-ink leading-tight">{{ multiHeaderTitle }}</p>
          <p v-if="multiSubTitle" class="mt-0.5 text-[11px] text-ink-muted">
            {{ multiSubTitle }}
          </p>
        </div>
      </div>

      <dl class="mt-2 divide-y divide-border">
        <KeyValueRow label="count" :value="`${multiItems.length} items`" />
        <KeyValueRow v-if="multiFiles.length > 0" label="total size">
          <span class="tabular">{{ formatSize(multiTotalBytes) }}</span>
          <span class="tabular block text-[11px] text-ink-muted"
            >{{ multiTotalBytes.toLocaleString('en-US') }} B</span
          >
        </KeyValueRow>
        <KeyValueRow v-if="typeSummary" label="types" :value="typeSummary" />
      </dl>

      <!-- Selected items list -->
      <div class="mt-3">
        <div class="flex items-center justify-between pb-1">
          <span class="micro-label">
            {{
              multiFiles.length > 0 && multiFolders.length === 0
                ? 'selected files'
                : 'selected items'
            }}
            ({{ multiItems.length }})
          </span>
          <button
            type="button"
            class="cursor-pointer text-[11px] text-ink-muted hover:text-ink"
            v-tooltip="'Clear selection (Esc)'"
            @click="emit('clearSelection')"
          >
            clear
          </button>
        </div>
        <div
          class="max-h-36 overflow-y-auto rounded-(--radius-control) border border-border bg-sunken/30 divide-y divide-border/50"
        >
          <div
            v-for="i in multiItems"
            :key="i.id"
            class="group flex items-center justify-between gap-1.5 px-2 py-1 text-[11px]"
          >
            <div class="flex min-w-0 items-center gap-1.5">
              <component
                :is="i.kind === 'folder' ? FolderOpen : File"
                :size="12"
                :stroke-width="1.5"
                class="shrink-0"
                :class="i.kind === 'folder' ? 'text-brand' : 'text-ink-muted'"
                aria-hidden="true"
              />
              <span class="truncate text-ink" :title="i.name">{{ i.name }}</span>
            </div>
            <div class="flex shrink-0 items-center gap-1">
              <span v-if="i.kind === 'file'" class="tabular text-[10px] text-ink-muted">
                {{ formatSize(i.size ?? 0) }}
              </span>
              <button
                type="button"
                class="cursor-pointer rounded p-0.5 text-ink-muted opacity-0 transition-opacity hover:text-ink group-hover:opacity-100"
                :aria-label="`Deselect ${i.name}`"
                v-tooltip="`Deselect ${i.name}`"
                @click="emit('toggleItem', i.id)"
              >
                <X :size="11" :stroke-width="1.5" />
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- Quick Workers for multi-selection -->
      <template v-if="multiFiles.length > 0">
        <p class="micro-label mt-3 pb-1">run worker ({{ multiFiles.length }} files)</p>
        <div class="flex flex-col gap-1">
          <button
            type="button"
            class="flex h-6 cursor-pointer items-center gap-2 rounded-(--radius-control) border border-border-strong px-2 text-left text-ink hover:bg-sunken"
            v-tooltip="`Pick a worker to run on ${multiFiles.length} files (⌘⏎)`"
            @click="emit('runMore')"
          >
            <Play :size="11" :stroke-width="1.5" class="shrink-0 text-brand" aria-hidden="true" />
            pick a worker…
            <kbd
              class="ml-auto rounded-(--radius-check) border border-border-strong px-1 text-[10px] leading-4"
              >⌘⏎</kbd
            >
          </button>
        </div>
      </template>

      <!-- Multi-selection actions -->
      <div class="mt-3 flex flex-col gap-1.5">
        <Button
          v-if="multiFiles.length > 0"
          variant="secondary"
          size="row"
          class="justify-center"
          :tooltip="`Create workflow for ${multiFiles.length} selected files (w)`"
          @click="openWorkflow"
        >
          <template #icon><Workflow :size="13" :stroke-width="1.5" /></template>
          {{ multiFiles.length > 1 ? `Create workflow (${multiFiles.length})` : 'Create workflow' }}
        </Button>
        <Button
          v-if="multiFiles.length > 0"
          size="row"
          class="justify-center"
          :tooltip="`Download ${multiFiles.length} selected files`"
        >
          <template #icon><Download :size="13" :stroke-width="1.5" /></template>
          {{ multiFiles.length > 1 ? `Download (${multiFiles.length})` : 'Download' }}
        </Button>
        <Button
          size="row"
          class="justify-center"
          tooltip="Clear selection (Esc)"
          @click="emit('clearSelection')"
        >
          <template #icon><X :size="13" :stroke-width="1.5" /></template>
          Clear selection
        </Button>
        <Button
          v-if="canDelete"
          variant="danger"
          size="row"
          class="justify-center"
          :tooltip="`Delete ${count(multiItems.length, 'item')} (del)`"
          @click="emit('delete', multiItems)"
        >
          <template #icon><Trash2 :size="13" :stroke-width="1.5" /></template>
          {{ multiItems.length > 1 ? `Delete (${multiItems.length})` : 'Delete' }}
        </Button>
      </div>
    </div>

    <!-- Single item mode -->
    <div v-else class="min-h-0 flex-1 overflow-y-auto px-3 py-2.5">
      <div class="flex items-start gap-2">
        <component
          :is="item.kind === 'folder' ? FolderOpen : File"
          :size="16"
          :stroke-width="1.5"
          class="mt-px shrink-0"
          :class="item.kind === 'folder' ? 'text-brand' : 'text-ink-muted'"
          aria-hidden="true"
        />
        <p class="min-w-0 flex-1 font-semibold break-all text-ink">{{ item.name }}</p>
        <button
          v-if="canRename"
          type="button"
          class="shrink-0 cursor-pointer rounded p-1 text-ink-muted transition-colors hover:bg-sunken hover:text-ink"
          :aria-label="`Rename ${item.name}`"
          v-tooltip="'Rename (F2)'"
          @click="emit('rename', item.id)"
        >
          <Pencil :size="12" :stroke-width="1.5" />
        </button>
      </div>

      <dl class="mt-2 divide-y divide-border">
        <KeyValueRow label="id" :value="item.id" copyable />
        <KeyValueRow label="kind" :value="item.kind" />
        <KeyValueRow
          label="type"
          :value="
            item.mime ?? (item.workflowId !== undefined ? 'openrelik/workflow' : 'inode/directory')
          "
        />
        <KeyValueRow v-if="item.kind === 'file'" label="size">
          <span class="tabular">{{ formatSize(bytes) }}</span>
          <span class="tabular block text-[11px] text-ink-muted"
            >{{ bytes.toLocaleString('en-US') }} B</span
          >
        </KeyValueRow>
        <KeyValueRow v-if="producer" label="produced by">
          <span class="text-brand">{{ producer }}</span>
        </KeyValueRow>
        <KeyValueRow label="owner" :value="item.owner" />
        <KeyValueRow label="created">
          <span class="tabular">{{ stamp(item.created ?? item.modified) }}</span>
        </KeyValueRow>
        <KeyValueRow label="modified">
          <span class="tabular">{{ stamp(item.modified) }}</span>
        </KeyValueRow>
      </dl>

      <template v-if="item.kind === 'file'">
        <p class="micro-label mt-3 pb-1">run worker</p>
        <div class="flex flex-col gap-1">
          <button
            type="button"
            class="flex h-6 cursor-pointer items-center gap-2 rounded-(--radius-control) border border-border-strong px-2 text-left text-ink hover:bg-sunken"
            v-tooltip="`Pick a worker to run on ${item.name} (⌘⏎)`"
            @click="emit('runMore')"
          >
            <Play :size="11" :stroke-width="1.5" class="shrink-0 text-brand" aria-hidden="true" />
            pick a worker…
            <kbd
              class="ml-auto rounded-(--radius-check) border border-border-strong px-1 text-[10px] leading-4"
              >⌘⏎</kbd
            >
          </button>
        </div>
      </template>

      <div class="mt-3 flex flex-col gap-1.5">
        <Button
          size="row"
          class="justify-center"
          :tooltip="
            item.kind === 'folder' ? `Open folder ${item.name} (⏎)` : `View file ${item.name} (⏎)`
          "
          @click="emit('open', item.id)"
        >
          <template #icon><FolderOpen :size="13" :stroke-width="1.5" /></template>
          Open
        </Button>
        <Button
          v-if="item.kind === 'folder'"
          size="row"
          class="justify-center"
          :tooltip="`Share folder ${item.name} (s)`"
          @click="openShareDialog(item)"
        >
          <template #icon><UserPlus :size="13" :stroke-width="1.5" /></template>
          Share
        </Button>
        <Button
          v-if="item.kind === 'file'"
          size="row"
          class="justify-center"
          :tooltip="`Create workflow on ${item.name} (w)`"
          @click="openWorkflow"
        >
          <template #icon><Workflow :size="13" :stroke-width="1.5" /></template>
          Create workflow
        </Button>
        <Button
          v-if="item.kind === 'file'"
          size="row"
          class="justify-center"
          :tooltip="`Download ${item.name}`"
        >
          <template #icon><Download :size="13" :stroke-width="1.5" /></template>
          Download
        </Button>
        <Button
          v-if="canRename"
          size="row"
          class="justify-center"
          :tooltip="`Rename ${item.name} (F2)`"
          @click="emit('rename', item.id)"
        >
          <template #icon><Pencil :size="13" :stroke-width="1.5" /></template>
          Rename
        </Button>
        <Button
          v-if="canDelete"
          variant="danger"
          size="row"
          class="justify-center"
          :tooltip="`Delete ${item.name} (del)`"
          @click="emit('delete', [item])"
        >
          <template #icon><Trash2 :size="13" :stroke-width="1.5" /></template>
          Delete
        </Button>
      </div>
    </div>
  </aside>
</template>
