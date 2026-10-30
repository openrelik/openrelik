<script setup lang="ts">
import { computed, ref } from 'vue'

import Button from '@/components/base/Button.vue'
import LoadState from '@/components/base/LoadState.vue'
import MarkdownView from '@/components/markdown/MarkdownView.vue'
import { useTextStream } from '@/composables/useTextStream'
import type { QueryState } from '@/composables/useQueryCache'
import { formatSize } from '@/utils/format'
import type { LineIndex } from '@/utils/lines'
import { parseMarkdown, type Block } from '@/utils/markdown'

/**
 * A Markdown file, rendered in the app (`MarkdownView`): headings, lists,
 * tables, code. Nothing in the file can run, load or restyle anything — it
 * never becomes HTML, and links and images are shown as text, not followed
 * or fetched, so opening a file tells no one it was opened.
 *
 * The text comes from the same reader as the source view (`useTextStream`),
 * so switching between them costs no request. Only the start is rendered
 * (`RENDER_MAX`); the rest is in the source.
 *
 * Hovering a block offers its line in the source: one button, moved to the
 * block under the pointer.
 */
const props = defineProps<{ fileId: number; size: number }>()
const emit = defineEmits<{
  /** Show the source at a line (1-based). */
  source: [line: number]
}>()

/** Characters of source rendered, at most. */
const RENDER_MAX = 2_000_000

const text = useTextStream(() => ({ id: props.fileId, size: props.size }))

/** The source rendered: whole lines, up to `RENDER_MAX`; and whether that is all of it. */
let parsed: { index: LineIndex | null; lines: number; blocks: Block[] } = {
  index: null,
  lines: -1,
  blocks: [],
}
const rendered = computed(() => {
  void text.version.value
  const index = text.index()
  // The last line is not complete until the file ends.
  const complete = index.open ? index.lines.length - 1 : index.lines.length
  let chars = 0
  let lines = 0
  while (lines < complete && chars + index.lines[lines]!.length < RENDER_MAX) {
    chars += index.lines[lines]!.length + 1
    lines++
  }
  // Text arriving past what is rendered changes nothing.
  if (index !== parsed.index || lines !== parsed.lines) {
    parsed = { index, lines, blocks: parseMarkdown(index.lines.slice(0, lines).join('\n')) }
  }
  const all = text.done.value && lines === index.lines.length
  return { blocks: parsed.blocks, lines, all }
})

const state = computed<QueryState>(() => ({
  status: text.error.value
    ? 'error'
    : text.done.value || rendered.value.lines
      ? 'success'
      : 'loading',
  isFetching: text.reading.value,
  error: text.error.value,
  errorStatus: null,
  fetchedAt: 0,
}))

// --- the block under the pointer, and its line in the source ---

const page = ref<HTMLElement | null>(null)
const hovered = ref<{ line: number; top: number } | null>(null)
function onHover(event: PointerEvent) {
  const block = (event.target as HTMLElement).closest<HTMLElement>('[data-line]')
  if (!block || !page.value) return
  const box = page.value.getBoundingClientRect()
  hovered.value = {
    line: Number(block.dataset.line),
    top: block.getBoundingClientRect().top - box.top + page.value.scrollTop,
  }
}
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col bg-surface">
    <div
      v-if="rendered.lines && !rendered.all && !text.reading.value"
      class="flex h-7 shrink-0 items-center gap-2 border-b border-border px-3 text-ink-muted"
      role="status"
    >
      <span class="min-w-0 truncate">
        Rendered up to line
        <span class="tabular">{{ rendered.lines.toLocaleString('en-US') }}</span> (the first
        <span class="tabular">{{ formatSize(RENDER_MAX) }}</span
        >); the rest is in the source.
      </span>
      <Button size="row" variant="ghost" class="shrink-0" @click="emit('source', rendered.lines)">
        Show source
      </Button>
    </div>

    <div
      ref="page"
      tabindex="0"
      class="relative min-h-0 flex-1 overflow-auto px-6 py-4 outline-none focus-visible:ring-1 focus-visible:ring-brand/40 focus-visible:ring-inset"
      role="document"
      aria-label="Rendered Markdown"
      @pointerover="onHover"
      @pointerleave="hovered = null"
    >
      <LoadState
        :state="state"
        noun="text"
        :has-content="rendered.blocks.length > 0"
        @retry="text.loadMore()"
      >
        <template #empty>Nothing to render: the file is empty.</template>
      </LoadState>

      <MarkdownView v-if="rendered.blocks.length" :source="rendered.blocks" variant="document" />

      <Button
        v-if="hovered"
        variant="ghost"
        size="row"
        class="tabular absolute right-2"
        :style="{ top: `${hovered.top}px` }"
        v-tooltip="'Show in the source'"
        @click="emit('source', hovered.line)"
      >
        line {{ hovered.line.toLocaleString('en-US') }}
      </Button>
    </div>
  </div>
</template>
