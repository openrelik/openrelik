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
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'

import Button from '@/components/base/Button.vue'
import LoadState from '@/components/base/LoadState.vue'
import MarkdownView from '@/components/markdown/MarkdownView.vue'
import { Copy } from '@/components/icons'
import { useMarkedRange } from '@/composables/useMarkedRange'
import { useTextStream } from '@/composables/useTextStream'
import type { QueryState } from '@/composables/useQueryCache'
import { formatSize } from '@/utils/format'
import type { LineIndex } from '@/utils/lines'
import { parseMarkdown, type Block } from '@/utils/markdown'
import type { Span } from '@/utils/marks'

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
 * Marks are the source's lines (`#L12-L40`), so one link works in both
 * views: selecting here marks the source lines of the blocks the selection
 * touches, whole blocks, as soon as it is let go of; a mark made in the
 * source tints the blocks over its lines. A plain click clears it, Esc
 * clears the selection and then the mark, `m` copies a link to it.
 *
 * Hovering a block offers its line in the source: one button, moved to the
 * block under the pointer.
 */
const props = defineProps<{ fileId: number; size: number }>()
const emit = defineEmits<{
  /** Show the source at a line (1-based). */
  source: [line: number]
}>()
/** Source lines marked: the page keeps them in its URL. */
const mark = defineModel<Span | null>('mark', { default: null })

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
  return { blocks: parsed.blocks, lines, all, oversizedFirstLine: complete > 0 && lines === 0 }
})

const state = computed<QueryState>(() => ({
  status: text.error.value
    ? 'error'
    : text.done.value || rendered.value.lines || rendered.value.oversizedFirstLine
      ? 'success'
      : 'loading',
  isFetching: text.reading.value,
  error: text.error.value,
  errorStatus: null,
  fetchedAt: 0,
}))

const page = ref<HTMLElement | null>(null)

// --- marks: source lines, by the blocks over them ---

/** A line to bring on screen once its block is rendered (set by `land`, below). */
const landing = ref<number | null>(null)
let landRun = 0
let unmounted = false
const marks = useMarkedRange(mark, 'line', {
  land: (span) => land(span.from),
  focus: () => page.value?.focus({ preventScroll: true }),
})

function land(line: number) {
  landing.value = line
  void tryLand()
}
async function tryLand() {
  const line = landing.value
  if (line === null || !page.value) return
  // Still arriving: wait for it. Past what is rendered: the last block will do.
  if (line > rendered.value.lines && text.reading.value) return
  landing.value = null
  const run = ++landRun
  await nextTick()
  if (unmounted || run !== landRun) return
  // Blocks off screen are laid out at a guessed height: a pass or two settles the place.
  for (let pass = 0; pass < 3; pass++) {
    const el = page.value
    const blocks = el?.querySelectorAll<HTMLElement>('[data-end]') ?? []
    const block =
      [...blocks].find((b) => Number(b.dataset.end) >= line) ?? blocks[blocks.length - 1]
    if (!el || !block) return
    const at = block.getBoundingClientRect().top - el.getBoundingClientRect().top
    el.scrollTop += at - el.clientHeight / 3
    await new Promise((done) => requestAnimationFrame(done))
    if (unmounted || run !== landRun) return
  }
}
watch([() => rendered.value.lines, () => text.reading.value], tryLand)

/** The block a point of the selection is in; between blocks, the next one (or the last). */
function blockAt(node: Node, offset: number): HTMLElement | null {
  let el = node instanceof Element ? node : node.parentElement
  if (el && !el.closest('[data-line]') && node instanceof Element) {
    const kids = [...node.childNodes].filter((kid): kid is Element => kid instanceof Element)
    const blockIn = (kid: Element) =>
      kid.matches('[data-line]') ? kid : kid.querySelector('[data-line]')
    el =
      kids
        .slice(offset)
        .map(blockIn)
        .find((b) => b) ??
      kids
        .slice(0, offset)
        .map(blockIn)
        .reverse()
        .find((b) => b) ??
      null
  }
  const block = el?.closest<HTMLElement>('[data-line]')
  return block && page.value?.contains(block) ? block : null
}

/** The source lines of the blocks the selection touches; null when nothing is selected here. */
function selectedLines(): Span | null {
  const selection = window.getSelection()
  if (!selection || selection.isCollapsed || !selection.anchorNode || !selection.focusNode) {
    return null
  }
  const a = blockAt(selection.anchorNode, selection.anchorOffset)
  const b = blockAt(selection.focusNode, selection.focusOffset)
  if (!a || !b) return null
  const lines = [a, b].flatMap((el) => [Number(el.dataset.line), Number(el.dataset.end)])
  return { from: Math.min(...lines), to: Math.max(...lines) }
}

/** A press in the page, not on a control: what it selects becomes the mark when let go of. */
let pressing = false
const onControl = (target: EventTarget | null) =>
  !!(target as Element | null)?.closest('button, [role="button"]')
function onPress(event: PointerEvent) {
  pressing = event.button === 0 && !onControl(event.target)
}
function onRelease() {
  if (!pressing) return
  pressing = false
  const span = selectedLines()
  if (!span || (mark.value?.from === span.from && mark.value?.to === span.to)) return
  marks.set(span)
  marks.anchor.value = span
}
onMounted(() => document.addEventListener('pointerup', onRelease))
onUnmounted(() => document.removeEventListener('pointerup', onRelease))

/** A plain click in the page clears the mark, as in every viewer; a selection keeps it. */
function onClick(event: MouseEvent) {
  if (!mark.value || event.detail > 1 || onControl(event.target)) return
  if (!(window.getSelection()?.isCollapsed ?? true)) return
  marks.set(null)
}

const notice = ref<string | null>(null)
let noticeTimer: ReturnType<typeof setTimeout> | undefined
function say(message: string) {
  notice.value = message
  clearTimeout(noticeTimer)
  noticeTimer = setTimeout(() => (notice.value = null), 2500)
}
onUnmounted(() => {
  unmounted = true
  clearTimeout(noticeTimer)
})

async function copyLink() {
  say(await marks.copyLink())
}
const linkLabel = computed(() => `Copy a link to ${marks.label()}`)

function onKey(event: KeyboardEvent) {
  if (event.metaKey || event.ctrlKey || event.altKey) return
  if (event.key === 'm' && mark.value) void copyLink()
  else if (event.key === 'Escape' && !(window.getSelection()?.isCollapsed ?? true)) {
    // The selection goes first: what stays is its mark.
    window.getSelection()?.removeAllRanges()
  } else if (event.key === 'Escape' && mark.value) marks.set(null)
  else return
  // The file page's keys (esc goes back) wait while the page has focus.
  event.preventDefault()
  event.stopPropagation()
}

// --- the block under the pointer, and its line in the source ---

const hovered = ref<{ line: number; top: number } | null>(null)
watch(
  () => props.fileId,
  () => {
    hovered.value = null
    landing.value = null
    landRun++
  },
)
function onHover(event: PointerEvent) {
  const block = (event.target as Element | null)?.closest?.<HTMLElement>('[data-line]')
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
    <div class="flex h-7 shrink-0 items-center gap-3 border-b border-border px-3 text-ink-muted">
      <span class="tabular shrink-0">
        <template v-if="rendered.lines">{{ rendered.lines.toLocaleString('en-US') }} lines</template
        ><template v-if="mark"> · {{ marks.label() }}</template>
      </span>
      <span v-if="notice" class="truncate text-ink-secondary" aria-live="polite">{{ notice }}</span>
      <span
        v-else-if="
          (rendered.lines || rendered.oversizedFirstLine) && !rendered.all && !text.reading.value
        "
        class="flex min-w-0 items-center gap-2"
        role="status"
      >
        <span class="truncate">
          <template v-if="rendered.oversizedFirstLine">
            line 1 exceeds <span class="tabular">{{ formatSize(RENDER_MAX) }}</span
            >; view it in the source
          </template>
          <template v-else>
            rendered up to line
            <span class="tabular">{{ rendered.lines.toLocaleString('en-US') }}</span> (the first
            <span class="tabular">{{ formatSize(RENDER_MAX) }}</span
            >); the rest is in the source
          </template>
        </span>
        <Button
          size="row"
          variant="ghost"
          class="shrink-0"
          @click="emit('source', rendered.oversizedFirstLine ? 1 : rendered.lines)"
        >
          Show source
        </Button>
      </span>

      <div class="ml-auto flex shrink-0 items-center">
        <!-- mousedown kept from the page: pressing it must not clear the selection it links to -->
        <button
          v-if="mark"
          type="button"
          class="flex size-5 cursor-pointer items-center justify-center rounded-(--radius-control) hover:bg-sunken hover:text-ink"
          :aria-label="linkLabel"
          v-tooltip="linkLabel"
          @mousedown.prevent
          @click="copyLink"
        >
          <Copy :size="13" :stroke-width="1.5" />
        </button>
      </div>
    </div>

    <div
      ref="page"
      tabindex="0"
      class="relative min-h-0 flex-1 overflow-auto py-4 pr-24 pl-6 outline-none focus-visible:ring-1 focus-visible:ring-brand/40 focus-visible:ring-inset"
      role="document"
      aria-label="Rendered Markdown"
      @pointerover="onHover"
      @pointerleave="hovered = null"
      @pointerdown="onPress"
      @click="onClick"
      @keydown="onKey"
    >
      <LoadState
        :state="state"
        noun="text"
        :has-content="rendered.blocks.length > 0 || rendered.oversizedFirstLine"
        @retry="text.loadMore()"
      >
        <template #empty>Nothing to render: the file is empty.</template>
      </LoadState>

      <MarkdownView
        v-if="rendered.blocks.length"
        :source="rendered.blocks"
        variant="document"
        :marked="mark"
      />

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
