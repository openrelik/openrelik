<script setup lang="ts">
import { FolderPlus, Upload, UserPlus, Workflow } from '@/components/icons'
import { computed, ref } from 'vue'

import PathBar from '@/components/layout/PathBar.vue'
import Button from '@/components/base/Button.vue'
import { openShareDialog } from '@/composables/useShareDialog'
import { openWorkflowDialog } from '@/composables/useWorkflowDialog'
import type { Item } from '@/data/folders'

const props = defineProps<{
  crumbs: Item[]
  atRoot: boolean
  selectedFiles?: Item[]
}>()

const emit = defineEmits<{
  newFolder: []
}>()

const currentFolder = computed(() => props.crumbs.at(-1))

const filter = defineModel<string>('filter', { default: '' })

const filterInput = ref<HTMLInputElement | null>(null)

function focusFilter() {
  filterInput.value?.focus()
}

defineExpose({
  focusFilter,
  filterInput,
})
</script>

<template>
  <div class="flex h-10 shrink-0 items-center gap-2 border-b border-border pr-2 pl-3">
    <PathBar :path="crumbs" />

    <!-- No filter at the root: the case list is found through the prompt. -->
    <div v-if="!atRoot" class="relative w-52 shrink-0">
      <input
        ref="filterInput"
        v-model="filter"
        type="search"
        aria-label="Filter this folder"
        placeholder="filter"
        v-tooltip="'Filter folder contents (/)'"
        class="h-7 w-full rounded-(--radius-control) border border-border-strong bg-surface pr-8 pl-2 text-ink placeholder:text-ink-muted"
      />
      <kbd
        class="pointer-events-none absolute top-1/2 right-1.5 -translate-y-1/2 rounded-(--radius-check) border border-border-strong px-1 text-[10px] leading-4 text-ink-muted"
        >/</kbd
      >
    </div>

    <span v-if="!atRoot" class="h-5 w-px shrink-0 bg-border" aria-hidden="true" />

    <div class="flex shrink-0 items-center gap-1.5">
      <Button
        v-if="!atRoot && selectedFiles && selectedFiles.length > 0"
        variant="primary"
        size="row"
        :tooltip="`Create workflow for ${selectedFiles.length} selected files (w)`"
        @click="openWorkflowDialog(selectedFiles, currentFolder?.id ?? 0)"
      >
        <template #icon><Workflow :size="13" :stroke-width="1.5" /></template>
        {{
          selectedFiles.length > 1 ? `Create workflow (${selectedFiles.length})` : 'Create workflow'
        }}
      </Button>
      <Button
        :variant="atRoot ? 'primary' : 'secondary'"
        size="row"
        :tooltip="
          atRoot
            ? 'Create new folder at root (n)'
            : `Create subfolder in ${currentFolder?.name ?? 'folder'} (n)`
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
          :tooltip="`Share ${currentFolder?.name ?? 'folder'} (s)`"
          @click="currentFolder && openShareDialog(currentFolder)"
        >
          <template #icon><UserPlus :size="13" :stroke-width="1.5" /></template>
          Share
        </Button>
        <Button
          :variant="selectedFiles && selectedFiles.length > 0 ? 'secondary' : 'primary'"
          size="row"
          :tooltip="`Upload files to ${currentFolder?.name ?? 'folder'}`"
        >
          <template #icon><Upload :size="13" :stroke-width="1.5" /></template>
          Upload
        </Button>
      </template>
    </div>
  </div>
</template>
