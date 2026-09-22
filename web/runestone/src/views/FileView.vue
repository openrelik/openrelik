<script setup lang="ts">
import { ChevronLeft, ChevronRight, Download, Workflow } from '@/components/icons'
import { computed, onMounted, onUnmounted } from 'vue'
import { RouterLink, useRouter } from 'vue-router'

import HexViewer from '@/components/viewers/HexViewer.vue'
import FileDetails from '@/components/viewers/FileDetails.vue'
import PathBar from '@/components/layout/PathBar.vue'
import TextViewer from '@/components/viewers/TextViewer.vue'
import Button from '@/components/base/Button.vue'
import { openWorkflowDialog } from '@/composables/useWorkflowDialog'
import StatusBar from '@/components/layout/StatusBar.vue'
import KeyHint from '@/components/base/KeyHint.vue'
import { exactSize, headOf, textOf } from '@/data/files'
import { childrenOf, findItem, pathTo } from '@/data/folders'
import { count, formatSize } from '@/utils/format'
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

const text = computed(() => (file.value ? textOf(file.value) : undefined))
const head = computed(() => (file.value && text.value === undefined ? headOf(file.value) : []))
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
  <div v-if="!file" class="h-full bg-surface px-4 py-6 text-ink-muted">
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
        <Button variant="primary" size="row" :tooltip="`Download ${file.name}`">
          <template #icon><Download :size="13" :stroke-width="1.5" /></template>
          Download
        </Button>
      </div>
    </div>

    <!-- panes -->
    <div class="flex min-h-0 flex-1">
      <div class="flex min-w-0 flex-1 flex-col">
        <div
          class="flex h-7 shrink-0 items-center gap-3 border-b border-border px-3 text-ink-muted"
        >
          <span class="micro-label">{{ text !== undefined ? 'text' : 'hex' }}</span>
          <span v-if="text !== undefined" class="tabular">{{
            count(text.split('\n').length, 'line')
          }}</span>
          <span v-else class="truncate">
            No preview for {{ file.mime }} — first {{ head.length }} bytes of
            {{ bytes.toLocaleString('en-US') }}.
          </span>
        </div>
        <div class="min-h-0 flex-1 overflow-auto">
          <TextViewer v-if="text !== undefined" :text="text" />
          <HexViewer v-else :bytes="head" />
        </div>
      </div>

      <FileDetails :file="file" />
    </div>

    <!-- status bar -->
    <StatusBar>
      <span class="tabular">{{ file.mime }} · {{ formatSize(bytes) }}</span>
      <template #hints>
        <KeyHint keys="w" label="workflow" />
        <KeyHint keys="j k" label="next / prev file" />
        <KeyHint keys="esc" label="back to folder" />
      </template>
    </StatusBar>
  </section>
</template>
