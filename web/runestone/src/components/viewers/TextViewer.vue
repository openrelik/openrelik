<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { Copy } from '@/components/icons'

import Button from '@/components/base/Button.vue'
import TextRow from '@/components/viewers/TextRow.vue'
import TextSearchBar from '@/components/viewers/TextSearchBar.vue'
import { confirmAction } from '@/composables/useConfirm'
import { useDelayedFlag } from '@/composables/useDelayedFlag'
import { MORE_BYTES } from '@/composables/useRangeText'
import { useRowScroller } from '@/composables/useRowScroller'
import { useTextSearch } from '@/composables/useTextSearch'
import { useTextStream } from '@/composables/useTextStream'
import { useModalStore } from '@/stores/modals'
import { formatSize } from '@/utils/format'
import {
  formatLineHash,
  lineRangeLabel,
  parseLineRange,
  ROW_CHARS,
  type LineRange,
} from '@/utils/lines'

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
const range = defineModel<LineRange | null>('lines', { default: null })

const ROW_H = 20
/** Past this, reading the rest asks first: the lines are held in this page's memory. */
const LOAD_ALL_ASK = 256 * 1024 * 1024

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

watch(search.current, async (at) => {
  const hit = search.hits.value[at]
  if (!hit) return
  const row = rowOf(hit.line, hit.start)
  if (row < topRow.value || row >= topRow.value + visibleRows.value) {
    scrollTo(row - Math.floor(visibleRows.value / 3))
  }
  // Sideways too, clear of the line numbers.
  await nextTick()
  const el = body.value
  const mark = el?.querySelector<HTMLElement>('[data-hit="current"]')
  const gutter = el?.querySelector<HTMLElement>('[data-gutter]')
  if (!el || !mark) return
  const box = el.getBoundingClientRect()
  const hit2 = mark.getBoundingClientRect()
  const left = box.left + (gutter?.offsetWidth ?? 0)
  if (hit2.left < left) el.scrollLeft -= left - hit2.left + 24
  else if (hit2.right > box.right) el.scrollLeft += hit2.right - box.right + 24
})

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
    const marks = []
    for (let i = first; i < last; i++) {
      marks.push({ start: hits[i]!.start, end: hits[i]!.end, current: i === current })
    }
    out.push({ row, line, start: index.startOf(row), text: index.rowText(row), hits: marks })
  }
  return out
})

const gutterChars = computed(() => Math.max(4, text.lineCount.value.toLocaleString('en-US').length))
const inRange = (line: number) =>
  !!range.value && line + 1 >= range.value.from && line + 1 <= range.value.to

// --- line ranges: marked in the gutter, landed on from a link or go-to ---

/** Where a ⇧-click or drag extends from (1-based). */
const anchor = ref<number | null>(null)
/** The range this viewer set itself: already on screen, nothing to land on. */
let ownHash: string | null = null

function mark(next: LineRange | null) {
  ownHash = next && formatLineHash(next)
  range.value = next
}

/** A line to land on once it has been read (1-based). */
const landing = ref<number | null>(null)
function land(line: number) {
  landing.value = line
  text.readUntil(line)
  tryLand()
}
function tryLand() {
  const line = landing.value
  if (line === null) return
  const index = text.index()
  if (index.lines.length < line && !text.done.value) return
  landing.value = null
  const to = Math.min(line, index.lines.length) - 1
  if (to >= 0) scrollTo(index.firstRow(to) - Math.floor(visibleRows.value / 3))
}
watch([text.version, text.done, visibleRows], tryLand)

watch(
  () => range.value && formatLineHash(range.value),
  (hash) => {
    if (hash === ownHash || !range.value) return
    anchor.value = range.value.from
    land(range.value.from)
  },
  { immediate: true },
)

let dragging = false
function onGutterDown(event: PointerEvent, line: number) {
  if (event.button !== 0) return
  event.preventDefault()
  body.value?.focus({ preventScroll: true })
  // The one marked line, clicked again: unmarked.
  if (!event.shiftKey && range.value?.from === line && range.value.to === line) {
    anchor.value = null
    mark(null)
    return
  }
  dragging = true
  const from = event.shiftKey && range.value ? (anchor.value ?? range.value.from) : line
  anchor.value = from
  mark({ from: Math.min(from, line), to: Math.max(from, line) })
}
function onGutterEnter(line: number) {
  if (!dragging || anchor.value === null) return
  mark({ from: Math.min(anchor.value, line), to: Math.max(anchor.value, line) })
}
const endDrag = () => (dragging = false)

/**
 * A plain click in the text, away from the line numbers, unmarks the lines.
 * A drag that selected text, or a click that ends one, leaves them: copying
 * from inside marked lines must not lose them.
 */
let pressedInGutter = false
function onTextPress(event: PointerEvent) {
  pressedInGutter = !!(event.target as HTMLElement).closest('[data-gutter]')
}
function onTextClick(event: MouseEvent) {
  // Where the press began, not where the click lands: a drag across line
  // numbers ends with a click on the row they share.
  if (!range.value || pressedInGutter || event.shiftKey || event.detail > 1) return
  if (!(window.getSelection()?.isCollapsed ?? true)) return
  anchor.value = null
  mark(null)
}
onMounted(() => window.addEventListener('pointerup', endDrag))
onUnmounted(() => window.removeEventListener('pointerup', endDrag))

watch(
  () => props.fileId,
  () => {
    scrollTo(0)
    if (body.value) body.value.scrollLeft = 0
    anchor.value = null
    landing.value = null
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
  anchor.value = next.from
  mark(next)
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

async function copyLink() {
  if (!range.value) return
  const url = new URL(window.location.href)
  url.hash = formatLineHash(range.value)
  try {
    await navigator.clipboard.writeText(url.toString())
    say(`Copied a link to ${lineRangeLabel(range.value)}`)
  } catch {
    say('Could not copy the link')
  }
}

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
  else if (event.key === 'Escape' && range.value) {
    anchor.value = null
    mark(null)
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
const remaining = computed(() => Math.max(0, props.size - text.bytesRead.value))
const moreLabel = computed(() =>
  remaining.value > MORE_BYTES ? `${MORE_BYTES / 1_000_000} MB` : formatSize(remaining.value),
)
async function loadAll() {
  if (
    remaining.value > LOAD_ALL_ASK &&
    !(await confirmAction({
      title: 'Load the full file?',
      message: `That reads ${formatSize(remaining.value)} more into this page. The browser may slow down or run out of memory; loading 10 MB at a time is lighter.`,
      confirmLabel: 'Load full file',
    }))
  ) {
    return
  }
  text.loadAll()
}
</script>

<template>
  <div class="flex min-h-0 min-w-0 flex-1 flex-col">
    <!-- status, go to, find -->
    <div class="flex h-7 shrink-0 items-center gap-3 border-b border-border px-3 text-ink-muted">
      <span class="tabular shrink-0">
        {{ linesLabel }}<template v-if="range"> · {{ lineRangeLabel(range) }}</template>
      </span>
      <span v-if="notice" class="truncate text-ink-secondary" aria-live="polite">{{ notice }}</span>
      <span v-else-if="text.error.value" class="flex min-w-0 items-center gap-2">
        <span class="truncate text-danger" role="alert">{{ text.error.value }}</span>
        <Button size="row" class="shrink-0" @click="text.loadMore()">Retry</Button>
      </span>
      <span v-else-if="showReading" class="flex min-w-0 items-center gap-2">
        <span class="tabular truncate"
          >reading… {{ formatSize(text.bytesRead.value) }} of {{ formatSize(size) }}</span
        >
        <button
          type="button"
          class="cursor-pointer text-brand hover:underline"
          v-tooltip="'Stop reading; the lines read so far stay'"
          @click="text.stop()"
        >
          stop
        </button>
      </span>
      <span v-else-if="text.capped.value" class="flex min-w-0 items-center gap-2">
        <span class="tabular truncate"
          >{{ formatSize(text.bytesRead.value) }} of {{ formatSize(size) }} read</span
        >
        <Button size="row" class="shrink-0" @click="text.loadMore()">
          Load {{ moreLabel }} more
        </Button>
        <Button
          size="row"
          :tooltip="{
            text: `Read the remaining ${formatSize(remaining)}`,
            detail: 'Kept in this page',
          }"
          class="shrink-0"
          @click="loadAll"
        >
          Load full file
        </Button>
      </span>

      <div class="ml-auto flex shrink-0 items-center gap-3">
        <button
          v-if="range"
          type="button"
          class="flex size-5 cursor-pointer items-center justify-center rounded-(--radius-control) hover:bg-sunken hover:text-ink"
          :aria-label="`Copy a link to ${lineRangeLabel(range)}`"
          v-tooltip="`Copy a link to ${lineRangeLabel(range)}`"
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
            class="field tabular h-5 w-28 text-[11px]"
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
        class="min-w-0 flex-1 overflow-x-auto overflow-y-hidden outline-none focus-visible:ring-1 focus-visible:ring-brand/40 focus-visible:ring-inset"
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
            :class="{ 'bg-warning-tint': inRange(row.line) }"
          >
            <span
              data-gutter
              class="tabular sticky left-0 shrink-0 cursor-pointer px-3 text-right select-none"
              :class="
                inRange(row.line)
                  ? 'bg-warning-tint text-warning shadow-[inset_2px_0_0_var(--color-warning)]'
                  : 'bg-surface text-ink-muted hover:text-ink-secondary'
              "
              :style="{ width: `calc(${gutterChars}ch + 1.5rem)` }"
              @pointerdown="onGutterDown($event, row.line + 1)"
              @pointerenter="onGutterEnter(row.line + 1)"
              >{{ row.start === 0 ? (row.line + 1).toLocaleString('en-US') : '' }}</span
            >
            <TextRow class="pr-6 text-ink" :text="row.text" :start="row.start" :hits="row.hits" />
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
        />
      </div>
    </div>
  </div>
</template>
