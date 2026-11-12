<script setup lang="ts">
import { computed, onUnmounted } from 'vue'

import Button from '@/components/base/Button.vue'
import { confirmAction } from '@/composables/useConfirm'
import { useDelayedFlag } from '@/composables/useDelayedFlag'
import { MORE_BYTES } from '@/composables/useRangeText'
import { formatSize } from '@/utils/format'

/**
 * Progress, error/retry, and "load more / load full file" controls shared by
 * the streaming file viewers (`TextViewer` and `TableViewer`).
 */
const props = defineProps<{
  fileId: number
  size: number
  bytesRead: number
  reading: boolean
  capped: boolean
  error: string | null
  notice: string | null
  stopTooltip: string
}>()

const emit = defineEmits<{
  stop: []
  loadMore: []
  loadAll: []
}>()

/** Past this, reading the rest asks first: the data is held in this page's memory. */
const LOAD_ALL_ASK = 256 * 1024 * 1024

const showReading = useDelayedFlag(() => props.reading)
const remaining = computed(() => Math.max(0, props.size - props.bytesRead))
const moreLabel = computed(() =>
  remaining.value > MORE_BYTES ? `${MORE_BYTES / 1_000_000} MB` : formatSize(remaining.value),
)

let alive = true
onUnmounted(() => (alive = false))

async function requestLoadAll() {
  const id = props.fileId
  if (
    remaining.value > LOAD_ALL_ASK &&
    !(await confirmAction({
      title: 'Load the full file?',
      message: `That reads ${formatSize(remaining.value)} more into this page. The browser may slow down or run out of memory; loading 10 MB at a time, or filtering what is loaded, is lighter.`,
      confirmLabel: 'Load full file',
    }))
  ) {
    return
  }
  if (!alive || props.fileId !== id) return
  emit('loadAll')
}
</script>

<template>
  <span v-if="notice" class="truncate text-ink-secondary" aria-live="polite">{{ notice }}</span>
  <span v-else-if="error" class="flex min-w-0 items-center gap-2">
    <span class="truncate text-danger" role="alert">{{ error }}</span>
    <Button size="row" class="shrink-0" @click="emit('loadMore')">Retry</Button>
  </span>
  <span v-else-if="showReading" class="flex min-w-0 items-center gap-2">
    <span class="tabular truncate"
      >reading… {{ formatSize(bytesRead) }} of {{ formatSize(size) }}</span
    >
    <button
      type="button"
      class="cursor-pointer text-brand hover:underline"
      v-tooltip="stopTooltip"
      @click="emit('stop')"
    >
      stop
    </button>
  </span>
  <span v-else-if="capped" class="flex min-w-0 items-center gap-2">
    <span class="tabular truncate">{{ formatSize(bytesRead) }} of {{ formatSize(size) }} read</span>
    <Button size="row" class="shrink-0" @click="emit('loadMore')">
      Load {{ moreLabel }} more
    </Button>
    <Button
      size="row"
      :tooltip="{
        text: `Read the remaining ${formatSize(remaining)}`,
        detail: 'Kept in this page',
      }"
      class="shrink-0"
      @click="requestLoadAll"
    >
      Load full file
    </Button>
  </span>
</template>
