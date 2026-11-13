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
import { Copy } from '@/components/icons'

import StreamStatusBar from '@/components/viewers/StreamStatusBar.vue'
import TextRow from '@/components/viewers/TextRow.vue'
import TextSearchBar from '@/components/viewers/TextSearchBar.vue'
import { useDelayedFlag } from '@/composables/useDelayedFlag'
import { useMarkedRange } from '@/composables/useMarkedRange'
import { useRowScroller } from '@/composables/useRowScroller'
import { useTextSearch } from '@/composables/useTextSearch'
import { useTextStream } from '@/composables/useTextStream'
import { useModalStore } from '@/stores/modals'
import { parseLineRange, ROW_CHARS, shownOffset, sourceOffset } from '@/utils/lines'
import { hasColumns, sameSpan, type Span } from '@/utils/marks'

/**
 * A text file, line by line: read in the browser as it arrives (see
 * `useTextStream`), so the first lines show at once and a file of any size
 * opens. Only the rows on screen exist; the scrollbar is the viewer's own
 * (see `useRowScroller`), with a tick where search has hits.
 *
 * - Line numbers: click one to mark the line, ⇧-click or drag to mark a
 *   range. The range is the page's `#L12-L40`, so a link opens on it.
 * - Go to a line or a range (`:`), reading on when it is past what is read.
 * - Find (⌘F, `/`): text or a regular expression, every hit marked; Enter and
 *   ⌘G step through them.
 *
 * The text is only ever text: nothing in the file becomes markup.
 */
const props = defineProps<{
  fileId: number
  size: number
  /** On screen: ⌘F belongs to this viewer rather than the browser. */
  active: boolean
}>()
const range = defineModel<Span | null>('mark', { default: null })

const ROW_H = 20

const text = useTextStream(() => ({ id: props.fileId, size: props.size }))
const showReading = useDelayedFlag(() => text.reading.value)

const body = ref<HTMLElement | null>(null)
const track = ref<HTMLElement | null>(null)
const {
  topRow,
  visibleRows,
  bodyHeight,
  scrollTo,
  onWheel,
  thumbHeight,
  thumbTop,
  onThumbDown,
  onThumbMove,
  onThumbUp,
  onTrackDown,
} = useRowScroller(body, track, () => text.rowCount.value, ROW_H)

const topLine = computed(() => {
  void text.version.value
  return text.index().lineOf(topRow.value)
})

// --- find ---

const searchBar = ref<InstanceType<typeof TextSearchBar> | null>(null)
const query = ref('')
const caseSensitive = ref(false)
const regex = ref(false)
const search = useTextSearch(
  text,
  () => query.value,
  () => ({ caseSensitive: caseSensitive.value, regex: regex.value }),
  () => topLine.value,
)

/** The row a hit starts on. */
function rowOf(line: number, offset = 0) {
  return text.index().firstRow(line) + Math.floor(offset / ROW_CHARS)
}

watch(search.current, (at) => {
  const hit = search.hits.value[at]
  if (!hit) return
  const row = rowOf(hit.line, hit.start)
  if (row < topRow.value || row >= topRow.value + visibleRows.value) {
    scrollTo(row - Math.floor(visibleRows.value / 3))
  }
  revealSideways(() => body.value?.querySelector('[data-hit="current"]'))
})

/** Scrolls sideways, once drawn, to bring what `target` finds clear of the line numbers. */
async function revealSideways(
  target: () => { getBoundingClientRect(): DOMRect } | null | undefined,
) {
  await nextTick()
  const el = body.value
  const found = target()
  const gutter = el?.querySelector<HTMLElement>('[data-gutter]')
  if (!el || !found) return
  const box = el.getBoundingClientRect()
  const at = found.getBoundingClientRect()
  const left = box.left + (gutter?.offsetWidth ?? 0)
  if (at.left < left) el.scrollLeft -= left - at.left + 24
  else if (at.right > box.right)
    el.scrollLeft += Math.min(at.left - left, at.right - box.right + 24)
}

function closeSearch() {
  query.value = ''
  body.value?.focus({ preventScroll: true })
}

/** Ticks on the scrollbar where hits are: one per pixel at most. */
const hitMarks = computed(() => {
  const rows = text.rowCount.value
  const room = bodyHeight.value
  if (!thumbHeight.value || !rows || !search.active.value) return []
  const at = new Set<number>()
  for (const hit of search.hits.value) at.add(Math.floor((rowOf(hit.line) / rows) * room))
  return [...at]
})

// --- the rows on screen ---

const rows = computed(() => {
  void text.version.value
  const index = text.index()
  const hits = search.hits.value
  const current = search.current.value
  const out: {
    row: number
    line: number
    start: number
    text: string
    hits: { start: number; end: number; current: boolean }[]
  }[] = []
  // One more than fit: the last, cut off by the bottom edge.
  const end = Math.min(text.rowCount.value, topRow.value + visibleRows.value + 1)
  for (let row = topRow.value; row < end; row++) {
    const line = index.lineOf(row)
    const [first, last] = search.active.value ? search.hitsOn(line) : [0, 0]
    const rowHits = []
    for (let i = first; i < last; i++) {
      rowHits.push({ start: hits[i]!.start, end: hits[i]!.end, current: i === current })
    }
    out.push({
      row,
      line,
      start: index.startOf(row),
      text: index.rowText(row),
      hits: rowHits,
    })
  }
  return out
})

const gutterChars = computed(() => Math.max(4, text.lineCount.value.toLocaleString('en-US').length))
// --- marked lines: from the gutter, go-to, or a link ---

/** A line to land on once it has been read (1-based), and where in it. */
const landing = ref<{ line: number; offset: number } | null>(null)
function land(line: number, offset = 0) {
  landing.value = { line, offset }
  text.readUntil(line)
  tryLand()
}
function tryLand() {
  const at = landing.value
  // Not until measured: the landing leaves a third of the screen above it.
  if (at === null || !bodyHeight.value) return
  const index = text.index()
  if (index.lines.length < at.line && !text.done.value) return
  landing.value = null
  const to = Math.min(at.line, index.lines.length) - 1
  if (to < 0) return
  scrollTo(rowOf(to, at.offset) - Math.floor(visibleRows.value / 3))
  if (at.offset) revealSideways(() => painted.ranges[0])
}
watch([text.version, text.done, bodyHeight], tryLand)

const marks = useMarkedRange(range, 'line', {
  land: (span) => land(span.from, hasColumns(span) ? span.fromCol - 1 : 0),
  focus: () => body.value?.focus({ preventScroll: true }),
  // The gutter press keeps the browser from clearing the selection itself.
  deselect: () => window.getSelection()?.removeAllRanges(),
})
const inRange = (line: number) => marks.marked(line + 1)
/** Whole lines are marked (not exact text): their rows take the tint. */
const wholeLines = computed(() => !!range.value && !hasColumns(range.value))

/**
 * Marked text is painted over the rows on screen (`::highlight(text-mark)`),
 * not cut into elements of its own: a selection made across it keeps the
 * nodes it lies in. Without the Highlight API only the line numbers show it.
 */
const painted: { ranges: Range[]; highlight: Highlight | null } = {
  ranges: [],
  highlight:
    typeof Highlight !== 'undefined' && typeof CSS !== 'undefined' && 'highlights' in CSS
      ? new Highlight()
      : null,
}
/** The text node and offset at a position in a row's shown text. */
/** Line numbers show the mark only for whole lines: exact text is shown by its own tint. */
const gutterMarked = computed(() => wholeLines.value || !painted.highlight)
function nodeAt(row: HTMLElement, shown: number): [Node, number] {
  const walker = document.createTreeWalker(row, NodeFilter.SHOW_TEXT)
  let last: Text | null = null
  for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
    if (shown <= node.length) return [node, shown]
    shown -= node.length
    last = node
  }
  return last ? [last, last.length] : [row, 0]
}
function paintMark() {
  const highlight = painted.highlight
  painted.ranges = []
  highlight?.clear()
  const exact = range.value
  if (!exact || !hasColumns(exact) || !body.value) return
  const index = text.index()
  for (const el of body.value.querySelectorAll<HTMLElement>('[data-row]')) {
    const row = Number(el.dataset.row)
    const n = index.lineOf(row) + 1
    if (n < exact.from || n > exact.to) continue
    const rowText = index.rowText(row)
    const start = index.startOf(row)
    const from = Math.max(0, (n === exact.from ? exact.fromCol - 1 : 0) - start)
    const to = Math.min(rowText.length, n === exact.to ? exact.toCol - 1 - start : Infinity)
    if (from >= to) continue
    const stretch = document.createRange()
    stretch.setStart(...nodeAt(el, shownOffset(rowText, from)))
    stretch.setEnd(...nodeAt(el, shownOffset(rowText, to)))
    painted.ranges.push(stretch)
    highlight?.add(stretch)
  }
}
watch([rows, range], paintMark, { immediate: true, flush: 'post' })
onMounted(() => painted.highlight && CSS.highlights.set('text-mark', painted.highlight))
onUnmounted(() => {
  painted.highlight?.clear()
  painted.ranges = []
  if (painted.highlight && CSS.highlights?.get('text-mark') === painted.highlight) {
    CSS.highlights.delete('text-mark')
  }
})

// --- exact text: the selection on screen, marked and linked ---

/** Where a point of the selection is in the file: line (1-based) and caret column (1-based). */
function pointOf(node: Node, offset: number): { line: number; col: number } | null {
  const el = (node instanceof Element ? node : node.parentElement)?.closest<HTMLElement>(
    '[data-row]',
  )
  if (!el || !body.value?.contains(el)) return null
  const row = Number(el.dataset.row)
  const before = document.createRange()
  before.setStart(el, 0)
  before.setEnd(node, offset)
  const index = text.index()
  const at = index.startOf(row) + sourceOffset(index.rowText(row), before.toString().length)
  return { line: index.lineOf(row) + 1, col: at + 1 }
}

/** The text selected on screen, as a place in the file: the mark, once let go of. */
const selected = ref<Required<Span> | null>(null)
function readSelection() {
  const selection = window.getSelection()
  const a = selection?.anchorNode && pointOf(selection.anchorNode, selection.anchorOffset)
  const b = selection?.focusNode && pointOf(selection.focusNode, selection.focusOffset)
  if (!selection || selection.isCollapsed || !a || !b) {
    selected.value = null
    return
  }
  const [start, end] = a.line < b.line || (a.line === b.line && a.col <= b.col) ? [a, b] : [b, a]
  // A selection ending at the very start of a line ends with the line before.
  if (end.col === 1 && end.line > start.line) {
    end.line -= 1
    end.col = (text.index().lines[end.line - 1]?.length ?? 0) + 1
  }
  selected.value =
    start.line === end.line && start.col === end.col
      ? null
      : { from: start.line, fromCol: start.col, to: end.line, toCol: end.col }
}
onMounted(() => document.addEventListener('selectionchange', readSelection))
onUnmounted(() => document.removeEventListener('selectionchange', readSelection))

/** A press in the text, not yet let go of: the selection it makes is still moving. */
let pressing = false
/**
 * Selected text becomes the mark when the press ends, as clicked line
 * numbers do: the URL always links to what is selected.
 */
function onTextRelease() {
  if (!pressing) return
  pressing = false
  // Read now: `selectionchange` comes late.
  readSelection()
  const span = selected.value
  if (!span || sameSpan(span, range.value)) return
  marks.set(span)
  marks.anchor.value = span
}
function cancelPress() {
  pressing = false
}
onMounted(() => {
  document.addEventListener('pointerup', onTextRelease)
  document.addEventListener('pointercancel', cancelPress)
})
onUnmounted(() => {
  document.removeEventListener('pointerup', onTextRelease)
  document.removeEventListener('pointercancel', cancelPress)
})

/** Marks the selected text, shows the mark in place of the selection, and copies a link to it. */
async function markSelection() {
  // Read now: \`selectionchange\` comes late, and \`m\` can come right after a drag.
  readSelection()
  const span = selected.value
  if (!span) return
  marks.set(span)
  marks.anchor.value = span
  // The mark shows once the selection's own highlight is gone.
  window.getSelection()?.removeAllRanges()
  selected.value = null
  say(await marks.copyLink(span))
}

/** Where in the file a point on screen is, for ⇧-click. */
function pointAt(x: number, y: number): { line: number; col: number } | null {
  const caret = document.caretPositionFromPoint?.(x, y)
  if (caret) return pointOf(caret.offsetNode, caret.offset)
  const range = document.caretRangeFromPoint?.(x, y)
  return range ? pointOf(range.startContainer, range.startOffset) : null
}

/**
 * ⇧-click in the text extends a mark of exact text to the click, from the
 * mark's start: a selection longer than the screen can be marked, as the
 * rows it began in are gone once scrolled away.
 */
function onTextShiftDown(event: PointerEvent) {
  const now = range.value
  if (!event.shiftKey || event.button !== 0 || !now || !hasColumns(now)) return
  // A selection on screen extends itself.
  if (selected.value) return
  if ((event.target as HTMLElement).closest('[data-gutter]')) return
  const point = pointAt(event.clientX, event.clientY)
  if (!point) return
  event.preventDefault()
  const start = { line: now.from, col: now.fromCol }
  const [a, b] =
    point.line < start.line || (point.line === start.line && point.col < start.col)
      ? [point, start]
      : [start, point]
  if (a.line === b.line && a.col === b.col) return
  marks.set({ from: a.line, fromCol: a.col, to: b.line, toCol: b.col })
}
const lineSpan = (line: number) => ({ from: line + 1, to: line + 1 })

/**
 * A plain click in the text, away from the line numbers, unmarks the lines.
 * A drag that selected text, or a click that ends one, leaves them: copying
 * from inside marked lines must not lose them.
 */
let pressedInGutter = false
function onTextPress(event: PointerEvent) {
  pressedInGutter = !!(event.target as HTMLElement).closest('[data-gutter]')
  pressing = !pressedInGutter && event.button === 0
  onTextShiftDown(event)
}
function onTextClick(event: MouseEvent) {
  // Where the press began, not where the click lands: a drag across line
  // numbers ends with a click on the row they share.
  if (!range.value || pressedInGutter || event.shiftKey || event.detail > 1) return
  if (!(window.getSelection()?.isCollapsed ?? true)) return
  marks.set(null)
}

watch(
  () => props.fileId,
  () => {
    scrollTo(0)
    if (body.value) body.value.scrollLeft = 0
    marks.anchor.value = null
    landing.value = null
    selected.value = null
    pressing = false
    gotoText.value = ''
    gotoError.value = false
  },
)

// --- go to a line ---

const gotoInput = ref<HTMLInputElement | null>(null)
const gotoText = ref('')
const gotoError = ref(false)
function goTo() {
  const next = parseLineRange(gotoText.value)
  if (!next || (text.done.value && next.from > text.lineCount.value)) {
    gotoError.value = true
    return
  }
  gotoError.value = false
  gotoText.value = ''
  marks.set(next)
  marks.anchor.value = next
  land(next.from)
  body.value?.focus({ preventScroll: true })
}

// --- copy a link to the range ---

const notice = ref<string | null>(null)
let noticeTimer: ReturnType<typeof setTimeout> | undefined
function say(message: string) {
  notice.value = message
  clearTimeout(noticeTimer)
  noticeTimer = setTimeout(() => (notice.value = null), 2500)
}
onUnmounted(() => clearTimeout(noticeTimer))

/** The link button: to the selected text when there is some, else to the mark. */
async function copyLink() {
  if (selected.value) await markSelection()
  else say(await marks.copyLink())
}
const linkLabel = computed(() =>
  selected.value ? 'Copy a link to the selected text' : `Copy a link to ${marks.label()}`,
)

// --- keys ---

function onKey(event: KeyboardEvent) {
  const mod = event.metaKey || event.ctrlKey
  const page = Math.max(1, visibleRows.value - 1)
  const end = text.rowCount.value
  const moves: Record<string, () => number> = {
    ArrowUp: () => (mod ? 0 : topRow.value - 1),
    ArrowDown: () => (mod ? end : topRow.value + 1),
    PageUp: () => topRow.value - page,
    PageDown: () => topRow.value + page,
    Home: () => 0,
    End: () => end,
  }
  const move = moves[event.key]
  if (move && !event.altKey) scrollTo(move())
  else if (!mod && event.key === ':') gotoInput.value?.focus()
  else if (!mod && event.key === '/') searchBar.value?.focus()
  else if (!mod && event.key === 'm' && !window.getSelection()?.isCollapsed) void markSelection()
  else if (event.key === 'Escape' && selected.value) {
    // The selection goes first: what stays is its mark.
    window.getSelection()?.removeAllRanges()
    selected.value = null
  } else if (event.key === 'Escape' && range.value) {
    marks.set(null)
  } else return
  // The file page's keys (esc goes back) wait while the text has focus.
  event.preventDefault()
  event.stopPropagation()
}

/**
 * ⌘F and ⌘G while the text is on screen, wherever the focus is: only the
 * rows in view exist, so the browser's own find would miss the rest.
 */
const modalStore = useModalStore()
function onFindKey(event: KeyboardEvent) {
  if (!props.active || modalStore.hasActiveModal || event.altKey) return
  const mod = event.metaKey || event.ctrlKey
  const key = event.key.toLowerCase()
  if (mod && key === 'f' && !event.shiftKey) searchBar.value?.focus()
  else if ((mod && key === 'g') || event.key === 'F3') {
    if (event.shiftKey) search.prev()
    else search.next()
  } else return
  event.preventDefault()
  event.stopPropagation()
}
onMounted(() => window.addEventListener('keydown', onFindKey, { capture: true }))
onUnmounted(() => window.removeEventListener('keydown', onFindKey, { capture: true }))

// --- reading ---

const linesLabel = computed(() => {
  const count = text.lineCount.value
  return `${count.toLocaleString('en-US')} ${count === 1 ? 'line' : 'lines'}`
})
</script>

<template>
  <div class="flex min-h-0 min-w-0 flex-1 flex-col">
    <!-- status, go to, find -->
    <div class="flex h-7 shrink-0 items-center gap-3 border-b border-border px-3 text-ink-muted">
      <span class="tabular shrink-0">
        {{ linesLabel }}<template v-if="range"> · {{ marks.label() }}</template>
      </span>
      <StreamStatusBar
        :file-id="fileId"
        :size="size"
        :bytes-read="text.bytesRead.value"
        :reading="text.reading.value"
        :capped="text.capped.value"
        :error="text.error.value"
        :notice="notice"
        stop-tooltip="Stop reading; the lines read so far stay"
        @stop="text.stop()"
        @load-more="text.loadMore()"
        @load-all="text.loadAll()"
      />

      <div class="ml-auto flex shrink-0 items-center gap-3">
        <!-- mousedown kept from the page: pressing it must not clear the selection it links to -->
        <button
          v-if="range || selected"
          type="button"
          class="flex size-5 cursor-pointer items-center justify-center rounded-(--radius-control) hover:bg-sunken hover:text-ink"
          :aria-label="linkLabel"
          v-tooltip="linkLabel"
          @mousedown.prevent
          @click="copyLink"
        >
          <Copy :size="13" :stroke-width="1.5" />
        </button>
        <form @submit.prevent="goTo">
          <input
            ref="gotoInput"
            v-model="gotoText"
            type="text"
            spellcheck="false"
            autocomplete="off"
            placeholder="go to line"
            aria-label="Go to a line, or a range as 12-40"
            class="field tabular h-5 w-28 font-mono text-[11px]"
            :class="{ 'border-danger': gotoError }"
            v-tooltip="
              gotoError
                ? `Not a line in this file (1 to ${text.lineCount.value.toLocaleString('en-US')})`
                : 'A line, or a range as 12-40'
            "
            @input="gotoError = false"
            @keydown.esc.stop="((gotoText = ''), body?.focus())"
          />
        </form>
        <TextSearchBar
          ref="searchBar"
          v-model:query="query"
          v-model:case-sensitive="caseSensitive"
          v-model:regex="regex"
          :count="search.hits.value.length"
          :current="search.current.value"
          :overflow="search.overflow.value"
          :searching="search.searching.value"
          :error="search.error.value"
          @next="search.next()"
          @prev="search.prev()"
          @close="closeSearch"
        />
      </div>
    </div>

    <div class="relative flex min-h-0 flex-1">
      <!-- the lines: only the rows on screen exist -->
      <div
        ref="body"
        tabindex="0"
        class="min-w-0 flex-1 overflow-x-auto overflow-y-hidden font-mono outline-none focus-visible:ring-1 focus-visible:ring-brand/40 focus-visible:ring-inset"
        role="region"
        aria-label="File text"
        @keydown="onKey"
        @wheel="onWheel"
        @pointerdown.capture="onTextPress"
        @click="onTextClick"
      >
        <div class="w-max min-w-full">
          <div
            v-for="row in rows"
            :key="row.row"
            class="flex h-5 items-center"
            :class="{ 'bg-warning-tint': wholeLines && inRange(row.line) }"
          >
            <span
              data-gutter
              class="tabular sticky left-0 shrink-0 cursor-pointer px-3 text-right select-none"
              :class="
                gutterMarked && inRange(row.line)
                  ? 'bg-warning-tint text-warning shadow-[inset_2px_0_0_var(--color-warning)]'
                  : 'bg-surface text-ink-muted hover:text-ink-secondary'
              "
              :style="{ width: `calc(${gutterChars}ch + 1.5rem)` }"
              @pointerdown="marks.onGutterDown($event, lineSpan(row.line))"
              :data-mark-from="lineSpan(row.line).from"
              :data-mark-to="lineSpan(row.line).to"
              >{{ row.start === 0 ? (row.line + 1).toLocaleString('en-US') : '' }}</span
            >
            <TextRow
              class="pr-6 text-ink"
              :row="row.row"
              :text="row.text"
              :start="row.start"
              :hits="row.hits"
            />
          </div>
        </div>
        <p v-if="!rows.length && text.done.value" class="px-3 py-3 text-ink-muted">Empty file.</p>
        <p v-else-if="!rows.length && text.reading.value" class="px-3 py-3 text-ink-muted">
          <span :class="{ invisible: !showReading }">Reading the file…</span>
        </p>
      </div>

      <!-- a scrollbar over the whole file, ticked where search has hits -->
      <div
        v-if="thumbHeight"
        ref="track"
        class="relative w-2.5 shrink-0 border-l border-border bg-sunken"
        @pointerdown="onTrackDown"
      >
        <div
          v-for="y in hitMarks"
          :key="y"
          class="pointer-events-none absolute inset-x-0 h-0.5 bg-warning/70"
          :style="{ top: `${y}px` }"
          aria-hidden="true"
        />
        <div
          class="absolute inset-x-0.5 cursor-grab rounded-(--radius-check) bg-ink-muted/40 hover:bg-ink-muted/60 active:cursor-grabbing"
          :style="{ top: `${thumbTop}px`, height: `${thumbHeight}px` }"
          aria-hidden="true"
          @pointerdown.stop="onThumbDown"
          @pointermove="onThumbMove"
          @pointerup="onThumbUp"
          @pointercancel="onThumbUp"
        />
      </div>
    </div>
  </div>
</template>
