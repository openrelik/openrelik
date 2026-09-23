<script setup lang="ts">
import { ChevronLeft, ChevronRight, Download, Workflow } from '@/components/icons'
import { computed, onMounted, onUnmounted, watch } from 'vue'
import { RouterLink, useRouter } from 'vue-router'

import FileDetails from '@/components/viewers/FileDetails.vue'
import PathBar from '@/components/layout/PathBar.vue'
import FileContent from '@/components/viewers/FileContent.vue'
import Button from '@/components/base/Button.vue'
import { downloadFile } from '@/composables/useDownload'
import { useFileDetails } from '@/composables/useFileDetails'
import { useFolderLoader } from '@/composables/useFolderLoader'
import { openWorkflowDialog } from '@/composables/useWorkflowDialog'
import StatusBar from '@/components/layout/StatusBar.vue'
import KeyHint from '@/components/base/KeyHint.vue'
import { exactSize } from '@/data/files'
import { childrenOf, findItem, pathTo } from '@/data/folders'
import { formatSize } from '@/utils/format'
import { isTyping } from '@/utils/keyboard'
import { useModalStore } from '@/stores/modals'

/**
 * One file: its content in the middle, everything known about it on the right.
 *
 * The live page splits these into Content and Details tabs. Here both are on
 * screen at once — the hashes are what an examiner copies most, and a tab is
 * one more click between them and the file they describe.
 */
const props = defineProps<{ folderId: string; fileId: string }>()
const router = useRouter()

const file = computed(() => {
  const item = findItem(Number(props.fileId))
  return item?.kind === 'file' ? item : undefined
})
// Opened by link or reload, the file is not in the store yet: its folder's
// listing brings it, with the files beside it and the path. Known, it costs nothing.
const { load, listingState } = useFolderLoader()
watch(
  () => props.folderId,
  (id) => {
    if (/^\d+$/.test(id)) load(Number(id))
  },
  { immediate: true },
)
const loading = computed(() => {
  if (file.value || !/^\d+$/.test(props.folderId)) return false
  const { status } = listingState(Number(props.folderId))
  return status === 'idle' || status === 'loading'
})

// Hashes and magic are not in the listing: loaded for the file on screen.
useFileDetails(() => file.value?.id)

/** The file's real parent, whatever the URL claims. */
const folderId = computed(() => file.value?.parent ?? Number(props.folderId))

/** Files beside this one, in name order: what j and k step through. */
const siblings = computed(() =>
  childrenOf(folderId.value)
    .filter((item) => item.kind === 'file')
    .sort((a, b) => a.name.localeCompare(b.name)),
)
const position = computed(() => siblings.value.findIndex((item) => item.id === file.value?.id))
const previous = computed(() => siblings.value[position.value - 1])
const next = computed(() => siblings.value[position.value + 1])

const bytes = computed(() => (file.value ? exactSize(file.value) : 0))

const fileUrl = (id: number) => `/folder/${folderId.value}/file/${id}`

function go(item: { id: number } | undefined) {
  if (item) router.push(fileUrl(item.id))
}
/** Back to the listing, with this file under the cursor. */
function back() {
  router.push({ path: `/folder/${folderId.value}`, query: { focus: String(file.value?.id) } })
}

function openWorkflow() {
  if (!file.value || file.value.parent === null) return
  openWorkflowDialog([file.value], file.value.parent)
}

const modalStore = useModalStore()

const KEYS: Record<string, () => void> = {
  j: () => go(next.value),
  k: () => go(previous.value),
  ArrowRight: () => go(next.value),
  ArrowLeft: () => go(previous.value),
  w: openWorkflow,
  d: () => file.value && downloadFile(file.value.id, file.value.name),
  Escape: back,
}

function onKey(event: KeyboardEvent) {
  if (modalStore.hasActiveModal) return
  if (isTyping(event) || event.altKey || event.metaKey || event.ctrlKey) return
  const action = KEYS[event.key]
  if (!action) return
  action()
  event.preventDefault()
}
onMounted(() => window.addEventListener('keydown', onKey))
onUnmounted(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <div v-if="!file && loading" class="h-full bg-surface px-4 py-6 text-ink-muted">
    Loading file…
  </div>
  <div v-else-if="!file" class="h-full bg-surface px-4 py-6 text-ink-muted">
    No file {{ fileId }}.
    <RouterLink to="/" class="text-brand hover:underline">Back home</RouterLink>
  </div>

  <section
    v-else
    class="explorer flex h-full min-h-[28rem] flex-col overflow-hidden bg-surface text-[12px]"
  >
    <!-- toolbar: path · prev/next · actions -->
    <div class="flex h-10 shrink-0 items-center gap-2 border-b border-border pr-2 pl-3">
      <PathBar :path="pathTo(file.id)" />

      <div class="flex shrink-0 items-center">
        <button
          type="button"
          class="flex size-7 cursor-pointer items-center justify-center rounded-(--radius-control) text-ink-secondary hover:bg-sunken hover:text-ink disabled:cursor-default disabled:opacity-40"
          :disabled="!previous"
          aria-label="Previous file"
          v-tooltip="previous ? `${previous.name} (k)` : undefined"
          @click="go(previous)"
        >
          <ChevronLeft :size="14" :stroke-width="1.5" />
        </button>
        <span class="tabular px-1 text-ink-muted">{{ position + 1 }}/{{ siblings.length }}</span>
        <button
          type="button"
          class="flex size-7 cursor-pointer items-center justify-center rounded-(--radius-control) text-ink-secondary hover:bg-sunken hover:text-ink disabled:cursor-default disabled:opacity-40"
          :disabled="!next"
          aria-label="Next file"
          v-tooltip="next ? `${next.name} (j)` : undefined"
          @click="go(next)"
        >
          <ChevronRight :size="14" :stroke-width="1.5" />
        </button>
      </div>

      <span class="h-5 w-px shrink-0 bg-border" aria-hidden="true" />

      <div class="flex shrink-0 items-center gap-1.5">
        <Button
          variant="secondary"
          size="row"
          :tooltip="`Create workflow for ${file.name} (w)`"
          @click="openWorkflow"
        >
          <template #icon><Workflow :size="13" :stroke-width="1.5" /></template>
          Create workflow
        </Button>
        <Button
          variant="primary"
          size="row"
          :tooltip="`Download ${file.name} (d)`"
          @click="downloadFile(file.id, file.name)"
        >
          <template #icon><Download :size="13" :stroke-width="1.5" /></template>
          Download
        </Button>
      </div>
    </div>

    <!-- panes -->
    <div class="flex min-h-0 flex-1">
      <FileContent :file="file" />

      <FileDetails :file="file" />
    </div>

    <!-- status bar -->
    <StatusBar>
      <span class="tabular">{{ file.mime }} · {{ formatSize(bytes) }}</span>
      <template #hints>
        <KeyHint keys="w" label="workflow" />
        <KeyHint keys="d" label="download" />
        <KeyHint keys="j k" label="next / prev file" />
        <KeyHint keys="esc" label="back to folder" />
      </template>
    </StatusBar>
  </section>
</template>
