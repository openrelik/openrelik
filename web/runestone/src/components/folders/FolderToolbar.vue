<script setup lang="ts">
import { FolderPlus, Upload, UserPlus, X } from '@/components/icons'
import { computed, ref } from 'vue'

import PathBar from '@/components/layout/PathBar.vue'
import Button from '@/components/base/Button.vue'
import type { ItemAction } from '@/composables/useItemActions'
import { openShareDialog } from '@/composables/useShareDialog'
import type { Item } from '@/types/item'

const props = defineProps<{
  crumbs: Item[]
  /** The current folder is not loaded yet: the path shows a placeholder. */
  pathPending?: boolean
  atRoot: boolean
  /** How many rows are selected; while any are, the folder's own buttons make way for theirs. */
  selectedCount?: number
  /** What can be done to the selection (`useItemActions`). */
  selectionActions?: ItemAction[]
  /** Why uploading is off here (an empty workflow folder), or nothing. */
  uploadBlocked?: string | null
}>()

const emit = defineEmits<{
  newFolder: []
  /** Files the operator picked for upload. */
  uploadFiles: [files: File[]]
  clearSelection: []
}>()

const currentFolder = computed(() => props.crumbs.at(-1))
/** The selection's actions that belong in a bar, in the order the menu has them. */
const barActions = computed(() => (props.selectionActions ?? []).filter((action) => action.inBar))
/**
 * Upload leads in a plain folder. Not in a workflow folder: outputs land
 * there, and running the workflow is what matters.
 */
const uploadLeads = computed(() => currentFolder.value?.workflowId === undefined)

const filter = defineModel<string>('filter', { default: '' })

const filterInput = ref<HTMLInputElement | null>(null)
const fileInput = ref<HTMLInputElement | null>(null)

function focusFilter() {
  filterInput.value?.focus()
}

/** Opens the operating system's file picker (the Upload button, and `u`). */
function pickFiles() {
  if (props.uploadBlocked) return
  fileInput.value?.click()
}

function onFilesPicked(event: Event) {
  const input = event.target as HTMLInputElement
  const files = [...(input.files ?? [])]
  // Cleared, so picking the same file again still counts as a change.
  input.value = ''
  if (files.length) emit('uploadFiles', files)
}

defineExpose({
  focusFilter,
  filterInput,
  pickFiles,
})
</script>

<template>
  <div class="flex h-10 shrink-0 items-center gap-2 border-b border-border pr-2 pl-3">
    <PathBar :path="crumbs" :pending="pathPending" />

    <!-- No filter at the root: the top-level list is found through the prompt. -->
    <div v-if="!atRoot" class="relative w-52 shrink-0">
      <input
        ref="filterInput"
        v-model="filter"
        type="search"
        aria-label="Filter this folder"
        placeholder="filter"
        v-tooltip="'Filter folder contents'"
        class="h-7 w-full rounded-(--radius-control) border border-border-strong bg-surface px-2 text-ink placeholder:text-ink-muted"
      />
    </div>

    <span v-if="!atRoot" class="h-5 w-px shrink-0 bg-border" aria-hidden="true" />

    <!-- A selection: what can be done to it, where the folder's own buttons were. -->
    <div v-if="selectedCount" class="flex shrink-0 items-center gap-1.5" aria-label="Selection">
      <span class="tabular px-1 text-ink-secondary">{{ selectedCount }} selected</span>
      <Button
        v-for="action in barActions"
        :key="action.key"
        :variant="action.primary ? 'primary' : action.danger ? 'danger' : 'secondary'"
        size="row"
        :tooltip="action.tooltip"
        @click="action.run()"
      >
        <template #icon><component :is="action.icon" :size="13" :stroke-width="1.5" /></template>
        {{ action.label }}
      </Button>
      <button
        type="button"
        class="flex size-6 cursor-pointer items-center justify-center rounded-(--radius-control) text-ink-muted hover:bg-sunken hover:text-ink"
        aria-label="Clear selection"
        v-tooltip="'Clear selection'"
        @click="emit('clearSelection')"
      >
        <X :size="13" :stroke-width="1.5" />
      </button>
    </div>

    <div v-else class="flex shrink-0 items-center gap-1.5">
      <Button
        :variant="atRoot ? 'primary' : 'secondary'"
        size="row"
        :tooltip="
          atRoot
            ? 'Create new folder at root'
            : `Create subfolder in ${currentFolder?.name ?? 'folder'}`
        "
        @click="emit('newFolder')"
      >
        <template #icon><FolderPlus :size="13" :stroke-width="1.5" /></template>
        {{ atRoot ? 'New folder' : 'New subfolder' }}
      </Button>
      <!-- Workflows, sharing and uploads all happen inside a folder. -->
      <template v-if="!atRoot">
        <Button
          size="row"
          :tooltip="`Share ${currentFolder?.name ?? 'folder'}`"
          @click="currentFolder && openShareDialog(currentFolder)"
        >
          <template #icon><UserPlus :size="13" :stroke-width="1.5" /></template>
          Share
        </Button>
        <Button
          :variant="uploadLeads ? 'primary' : 'secondary'"
          size="row"
          :disabled="!!uploadBlocked"
          :tooltip="uploadBlocked || `Upload files to ${currentFolder?.name ?? 'folder'}`"
          @click="pickFiles"
        >
          <template #icon><Upload :size="13" :stroke-width="1.5" /></template>
          Upload
        </Button>
      </template>
    </div>

    <!-- Outside both button groups, so `u` still picks files while rows are selected. -->
    <input
      v-if="!atRoot"
      ref="fileInput"
      type="file"
      multiple
      class="hidden"
      tabindex="-1"
      aria-hidden="true"
      @change="onFilesPicked"
    />
  </div>
</template>
