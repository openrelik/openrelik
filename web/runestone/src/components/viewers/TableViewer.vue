<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { Copy, Maximize, Minimize } from '@/components/icons'

import TableDetail from '@/components/viewers/TableDetail.vue'
import Button from '@/components/base/Button.vue'
import { useDelayedFlag } from '@/composables/useDelayedFlag'
import { confirmAction } from '@/composables/useConfirm'
import { useMarkedRange } from '@/composables/useMarkedRange'
import { MORE_BYTES, useTableStream } from '@/composables/useTableStream'
import { useModalStore } from '@/stores/modals'
import { escapeControls } from '@/utils/bytes'
import { formatSize } from '@/utils/format'
import type { Span } from '@/utils/marks'
import type { TableKind } from '@/utils/preview'
import { compareKeys, sortKey } from '@/utils/table'

/**
 * A CSV, TSV or JSONL file as a table, read and parsed in the browser as it
 * arrives (see `useTableStream`), so the first rows show at once and files of
 * any size open.
 *
 * Only the rows in view are drawn; the header and row numbers stay in place.
 * Filtering (`/`; plain text across every cell, or `column:value`) and sorting
 * (click a column) cover the rows read so far. ↑↓ move through rows and the
 * detail panel shows the row in full; ⌘C copies it. Values are only ever
 * shown as text.
 *
 * Full screen (the button, or `f` in the table) moves the same table over
 * the whole window — nothing is read again or reset; Esc brings it back.
 */
const props = defineProps<{ fileId: number; size: number; kind: TableKind }>()
/** Marked rows (1-based, the row numbers): the page keeps them in its URL as `#R12-R40`. */
const mark = defineModel<Span | null>('mark', { default: null })
const emit = defineEmits<{
  /** A row was selected, or the selection cleared: the side panel follows. */
  rowSelected: [selected: boolean]
}>()

const ROW_H = 24
const OVERSCAN = 10
/** Characters a cell shows at most; the detail panel has the rest. */
const CELL_MAX = 10_000
const NUMBER_W = 7 // characters for the row number column
const CH = 7.3 // px per character of the monospace face at 12 px

const table = useTableStream(
  () => ({ id: props.fileId, size: props.size }),
  () => props.kind,
)
const { rows, columns, types } = table
const showReading = useDelayedFlag(() => table.reading.value)

// --- filter and sort: a view over the rows read so far ---

const filterInput = ref<HTMLInputElement | null>(null)
const filterText = ref('')
const filter = ref('')
let filterTimer: ReturnType<typeof setTimeout> | undefined
watch(filterText, (text) => {
  clearTimeout(filterTimer)
  filterTimer = setTimeout(() => (filter.value = text.trim()), 150)
})
onUnmounted(() => clearTimeout(filterTimer))

const sort = ref<{ column: number; dir: 1 | -1 } | null>(null)
function sortBy(column: number) {
  const now = sort.value
  sort.value =
    now?.column !== column ? { column, dir: 1 } : now.dir === 1 ? { column, dir: -1 } : null
}

/** Row indexes in view order: filtered, then sorted. */
const view = computed<number[]>(() => {
  const all = rows.value
  void all.length
  let indexes = all.map((_, i) => i)
  const text = filter.value.toLowerCase()
  if (text) {
    // `column:value` narrows to one column when the name matches one.
    const split = /^([^:]+):(.*)$/.exec(text)
    const column = split
      ? columns.value.findIndex((name) => name.toLowerCase() === split[1]!.trim())
      : -1
    const needle = column >= 0 ? split![2]!.trim() : text
    indexes = indexes.filter((i) => {
      const cells = table.cellsOf(all[i]!)
      return column >= 0
        ? (cells[column] ?? '').toLowerCase().includes(needle)
        : cells.some((cell) => cell.toLowerCase().includes(needle)) ||
            (!!all[i]!.error && (all[i]!.raw ?? '').toLowerCase().includes(needle))
    })
  }
  const order = sort.value
  if (order) {
    // Keys are worked out once per row, not per comparison (a sort makes
    // millions), and read from plain values, not reactive ones.
    const { column, dir } = order
    const type = types.value[column] ?? 'text'
    const keys: (number | string | null)[] = new Array(all.length)
    for (const i of indexes) {
      const row = all[i]!
      keys[i] = row.error ? null : sortKey(table.cellsOf(row)[column] ?? '', type)
    }
    // Lines that did not parse, and empty cells, go last in either direction.
    indexes = [...indexes].sort((a, b) => {
      const ka = keys[a] ?? null
      const kb = keys[b] ?? null
      if (ka === null || kb === null) return ka === kb ? a - b : ka === null ? 1 : -1
      return compareKeys(ka, kb) * dir || a - b
    })
  }
  return indexes
})

// --- columns: widths from the header and the first rows; draggable ---

const widths = ref<number[]>([])
const resizedCols = new Set<number>()
let measuredWithRows = false
watch(
  () => [columns.value.length, rows.value.length > 0] as const,
  () => {
    const sample = rows.value.slice(0, 200)
    widths.value = columns.value.map((name, index) => {
      if (
        widths.value[index] !== undefined &&
        (resizedCols.has(index) || measuredWithRows || !sample.length)
      ) {
        return widths.value[index]!
      }
      const lengths = sample
        .map((row) => (table.cellsOf(row)[index] ?? '').length)
        .sort((a, b) => a - b)
      const typical = lengths[Math.floor(lengths.length * 0.9)] ?? 0
      return Math.round(Math.min(40, Math.max(6, name.length + 2, typical + 1)) * CH + 16)
    })
    if (sample.length) measuredWithRows = true
  },
  { immediate: true },
)
const totalWidth = computed(
  () => NUMBER_W * CH + 16 + widths.value.reduce((sum, width) => sum + width, 0),
)

let resizing: { index: number; x: number; width: number } | null = null
function startResize(event: PointerEvent, index: number) {
  ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
  resizedCols.add(index)
  resizing = { index, x: event.clientX, width: widths.value[index] ?? 100 }
}
const endResize = () => (resizing = null)
function onResize(event: PointerEvent) {
  if (!resizing) return
  const next = [...widths.value]
  next[resizing.index] = Math.max(40, resizing.width + event.clientX - resizing.x)
  widths.value = next
}

// --- rows in view ---

const scroller = ref<HTMLElement | null>(null)
const scrollTop = ref(0)
const viewHeight = ref(0)
let observer: ResizeObserver | undefined
onMounted(() => {
  if (!scroller.value) return
  viewHeight.value = scroller.value.clientHeight
  // Hidden (another view of the file is showing) and shown again, the table's
  // size changes and the browser restores its scroll without a scroll event:
  // read the position back here too.
  observer = new ResizeObserver(([entry]) => {
    viewHeight.value = entry!.contentRect.height
    if (scroller.value) scrollTop.value = scroller.value.scrollTop
  })
  observer.observe(scroller.value)
})
onUnmounted(() => observer?.disconnect())

/** A scroll while hidden reports 0: only a table on screen says where it is. */
function onScroll(event: Event) {
  const el = event.target as HTMLElement
  if (el.clientHeight) scrollTop.value = el.scrollTop
}

const firstVisible = computed(() => Math.max(0, Math.floor(scrollTop.value / ROW_H) - OVERSCAN))
const visible = computed(() => {
  const last = Math.min(
    view.value.length,
    Math.ceil((scrollTop.value + viewHeight.value) / ROW_H) + OVERSCAN,
  )
  const out: { position: number; index: number; cells: string[] }[] = []
  for (let position = firstVisible.value; position < last; position++) {
    const index = view.value[position]!
    out.push({ position, index, cells: table.cellsOf(rows.value[index]!) })
  }
  return out
})

const cellText = (value: string) =>
  escapeControls(value.length > CELL_MAX ? `${value.slice(0, CELL_MAX)}…` : value)

// --- the cursor: a position in the view ---

const cursor = ref<number | null>(null)
const selectedIndex = computed(() => (cursor.value === null ? undefined : view.value[cursor.value]))
watch([filter, sort], () => (cursor.value = null))
watch(
  () => selectedIndex.value !== undefined,
  (selected) => emit('rowSelected', selected),
)
watch([() => props.fileId, () => props.kind], () => {
  cursor.value = null
  filterText.value = filter.value = ''
  sort.value = null
  landing.value = null
  marks.anchor.value = null
  widths.value = []
  resizedCols.clear()
  measuredWithRows = false
  scrollTop.value = 0
  scroller.value?.scrollTo({ top: 0 })
})

function moveTo(position: number) {
  if (!view.value.length) return
  cursor.value = Math.min(view.value.length - 1, Math.max(0, position))
  const top = cursor.value * ROW_H
  const el = scroller.value
  if (!el) return
  const inner = el.clientHeight - ROW_H // the header row
  if (top < el.scrollTop) el.scrollTop = top
  else if (top + ROW_H > el.scrollTop + inner) el.scrollTop = top + ROW_H - inner
}

// --- marked rows: from the row numbers, or a link ---

/** A row to land on once it has been read (0-based). */
const landing = ref<number | null>(null)
function land(span: Span) {
  landing.value = span.from - 1
  table.readUntil(span.from)
  tryLand()
}
function tryLand() {
  const index = landing.value
  if (index === null || !viewHeight.value) return
  if (rows.value.length <= index && !table.done.value) return
  landing.value = null
  if (index >= rows.value.length) return
  // A row the filter hides is shown by clearing it.
  if (!view.value.includes(index)) {
    filterText.value = filter.value = ''
    sort.value = null
  }
  // After the filter's own reset of the cursor.
  void nextTick(() => {
    const position = view.value.indexOf(index)
    if (position < 0) return
    cursor.value = position
    scroller.value?.scrollTo({ top: position * ROW_H - Math.floor(viewHeight.value / 3) })
  })
}
watch([rows, table.done, viewHeight], tryLand)

const marks = useMarkedRange(mark, 'row', {
  land,
  focus: () => scroller.value?.focus({ preventScroll: true }),
})
const rowSpan = (index: number) => ({ from: index + 1, to: index + 1 })

/** The press began on a row number: a drag that ends on a cell must not unmark. */
let pressedInGutter = false
function onPress(event: PointerEvent) {
  pressedInGutter = !!(event.target as HTMLElement).closest('[data-gutter]')
}
/** A click on a row moves the cursor there, and unmarks the rows, as a click in the text view does. */
function onRowClick(position: number) {
  cursor.value = position
  if (mark.value && !pressedInGutter && (window.getSelection()?.isCollapsed ?? true)) {
    marks.set(null)
  }
  scroller.value?.focus({ preventScroll: true })
}

const notice = ref<string | null>(null)
let noticeTimer: ReturnType<typeof setTimeout> | undefined
function say(text: string) {
  notice.value = text
  clearTimeout(noticeTimer)
  noticeTimer = setTimeout(() => (notice.value = null), 2500)
}
onUnmounted(() => clearTimeout(noticeTimer))

async function copyLink() {
  say(await marks.copyLink())
}

async function copyRow() {
  if (selectedIndex.value === undefined) return
  const row = rows.value[selectedIndex.value]!
  const text = row.raw ?? table.cellsOf(row).join('\t')
  try {
    await navigator.clipboard.writeText(text)
    say('Copied the row')
  } catch {
    say('Could not copy the row')
  }
}

// --- full screen: the same table, moved over the window ---

const modalStore = useModalStore()
const fullscreen = ref(false)
function toggleFullscreen() {
  const savedTop = scroller.value?.scrollTop ?? scrollTop.value
  fullscreen.value = !fullscreen.value
  // Keep the keys working and preserve scroll position where the table now is.
  requestAnimationFrame(() => {
    if (!scroller.value) return
    scroller.value.scrollTop = savedTop
    scrollTop.value = savedTop
    scroller.value.focus({ preventScroll: true })
  })
}

/**
 * While full screen, Esc belongs to the table: it clears the row, then the
 * marked rows, then leaves full screen — never the file page behind it. Caught before the page
 * sees it; the filter's own Esc (clear the filter) is left alone.
 */
function onFullscreenKey(event: KeyboardEvent) {
  if (!fullscreen.value || event.key !== 'Escape' || modalStore.hasActiveModal) return
  if (event.target === filterInput.value) return
  if (cursor.value !== null) cursor.value = null
  else if (mark.value) marks.set(null)
  else fullscreen.value = false
  event.preventDefault()
  // Immediate: the file page listens on the window too, for Esc = back.
  event.stopImmediatePropagation()
}
onMounted(() => window.addEventListener('keydown', onFullscreenKey, { capture: true }))
onUnmounted(() => window.removeEventListener('keydown', onFullscreenKey, { capture: true }))

function onKey(event: KeyboardEvent) {
  const page = Math.max(1, Math.floor(viewHeight.value / ROW_H) - 1)
  const at = cursor.value ?? -1
  const moves: Record<string, () => number> = {
    ArrowDown: () => at + 1,
    ArrowUp: () => Math.max(0, at - 1),
    PageDown: () => at + page,
    PageUp: () => at - page,
    Home: () => 0,
    End: () => view.value.length - 1,
  }
  const mod = event.metaKey || event.ctrlKey
  if (moves[event.key] && !mod) moveTo(moves[event.key]!())
  else if (
    mod &&
    event.key.toLowerCase() === 'c' &&
    selectedIndex.value !== undefined &&
    (window.getSelection()?.isCollapsed ?? true)
  ) {
    copyRow()
  } else if (!mod && event.key === '/') filterInput.value?.focus()
  else if (!mod && event.key === 'f') toggleFullscreen()
  else if (event.key === 'Escape' && cursor.value !== null) cursor.value = null
  else if (event.key === 'Escape' && mark.value) marks.set(null)
  else return
  event.preventDefault()
  event.stopPropagation()
}

const rowsLabel = computed(() => {
  const total = rows.value.length.toLocaleString('en-US')
  return filter.value
    ? `${view.value.length.toLocaleString('en-US')} of ${total} rows`
    : `${total} rows`
})
const sortedPartly = computed(() => !!sort.value && !table.done.value)

/** Bytes of the file not read yet. */
const remaining = computed(() => Math.max(0, props.size - table.bytesRead.value))
/** What "load more" reads: a round "10 MB", or what is left when that is less. */
const moreLabel = computed(() =>
  remaining.value > MORE_BYTES ? `${MORE_BYTES / 1_000_000} MB` : formatSize(remaining.value),
)
/** Past this, reading the rest asks first: the rows are held in this page's memory. */
const LOAD_ALL_ASK = 256 * 1024 * 1024
let alive = true
onUnmounted(() => (alive = false))
async function loadAll() {
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
  table.loadAll()
}
</script>

<template>
  <!-- The place in the page; full screen moves what is inside to the body, state and all. -->
  <div class="flex min-h-0 min-w-0 flex-1">
    <Teleport to="body" :disabled="!fullscreen">
      <div
        :class="
          fullscreen
            ? 'fixed inset-0 z-40 flex bg-surface text-[12px]'
            : 'flex min-h-0 min-w-0 flex-1'
        "
        :role="fullscreen ? 'dialog' : undefined"
        :aria-label="fullscreen ? 'Table, full screen' : undefined"
      >
        <div class="flex min-h-0 min-w-0 flex-1 flex-col">
          <!-- status, filter -->
          <div
            class="flex h-7 shrink-0 items-center gap-3 border-b border-border px-3 text-ink-muted"
          >
            <span class="tabular truncate">
              {{ rowsLabel }}<template v-if="mark"> · {{ marks.label() }}</template> ·
              {{ columns.length }} columns
              <template v-if="kind !== 'jsonl'">
                ·
                {{
                  table.delimiter.value === '\t' ? 'tab' : `"${table.delimiter.value}"`
                }}-separated
              </template>
            </span>
            <span v-if="notice" class="truncate text-ink-secondary" aria-live="polite">{{
              notice
            }}</span>
            <span v-else-if="table.error.value" class="flex min-w-0 items-center gap-2">
              <span class="truncate text-danger" role="alert">{{ table.error.value }}</span>
              <Button size="row" class="shrink-0" @click="table.loadMore()">Retry</Button>
            </span>
            <span v-else-if="showReading" class="flex items-center gap-2 truncate">
              <span class="tabular"
                >reading… {{ formatSize(table.bytesRead.value) }} of {{ formatSize(size) }}</span
              >
              <button
                type="button"
                class="cursor-pointer text-brand hover:underline"
                v-tooltip="'Stop reading; the rows read so far stay'"
                @click="table.stop()"
              >
                stop
              </button>
            </span>
            <span v-else-if="table.capped.value" class="flex min-w-0 items-center gap-2">
              <span class="tabular truncate"
                >{{ formatSize(table.bytesRead.value) }} of {{ formatSize(size) }} read</span
              >
              <!-- two choices: a step, or the rest -->
              <Button size="row" class="shrink-0" @click="table.loadMore()">
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
            <span v-if="sortedPartly" class="shrink-0 text-warning">sorted: rows read so far</span>
            <button
              v-if="mark"
              type="button"
              class="ml-auto flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-(--radius-control) hover:bg-sunken hover:text-ink"
              :aria-label="`Copy a link to ${marks.label()}`"
              v-tooltip="`Copy a link to ${marks.label()}`"
              @click="copyLink"
            >
              <Copy :size="13" :stroke-width="1.5" />
            </button>
            <input
              ref="filterInput"
              v-model="filterText"
              type="text"
              spellcheck="false"
              autocomplete="off"
              placeholder="filter rows"
              aria-label="Filter rows: text, or column:value"
              class="field h-5 w-52 shrink-0 text-[11px]"
              :class="{ 'ml-auto': !mark }"
              v-tooltip="'Text in any cell, or column:value'"
              @keydown.esc.stop="((filterText = ''), scroller?.focus())"
              @keydown.enter.prevent="scroller?.focus()"
            />
            <button
              type="button"
              class="flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-(--radius-control) hover:bg-sunken hover:text-ink"
              :aria-label="fullscreen ? 'Exit full screen' : 'Full screen'"
              v-tooltip="fullscreen ? 'Exit full screen' : 'Full screen'"
              @click="toggleFullscreen"
            >
              <component :is="fullscreen ? Minimize : Maximize" :size="13" :stroke-width="1.5" />
            </button>
          </div>

          <!-- the table: only the rows in view exist -->
          <div
            ref="scroller"
            tabindex="0"
            class="tabular relative min-h-0 flex-1 overflow-auto font-mono outline-none focus-visible:ring-1 focus-visible:ring-brand/40 focus-visible:ring-inset"
            role="grid"
            :aria-rowcount="view.length"
            aria-label="File rows"
            @scroll="onScroll"
            @pointerdown.capture="onPress"
            @keydown="onKey"
          >
            <div :style="{ width: `${totalWidth}px` }">
              <!-- header -->
              <div class="sticky top-0 z-10 flex h-6 border-b border-border bg-sunken text-[11px]">
                <span
                  class="sticky left-0 z-10 shrink-0 border-r border-border bg-sunken px-2 text-right text-ink-muted"
                  :style="{ width: `${NUMBER_W * CH + 16}px` }"
                  >#</span
                >
                <span
                  v-for="(name, index) in columns"
                  :key="index"
                  class="relative flex shrink-0 cursor-pointer items-center gap-1 border-r border-border/60 px-2 font-medium text-ink-secondary select-none hover:text-ink"
                  :class="{ 'justify-end': types[index] === 'number' }"
                  :style="{ width: `${widths[index]}px` }"
                  role="columnheader"
                  :aria-sort="
                    sort?.column === index ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'
                  "
                  v-tooltip="{ text: 'Sort by this column', detail: types[index] }"
                  @click="sortBy(index)"
                >
                  <span class="truncate">{{ escapeControls(name) }}</span>
                  <span v-if="sort?.column === index" class="shrink-0 text-brand">{{
                    sort.dir === 1 ? '↑' : '↓'
                  }}</span>
                  <!-- drag to resize -->
                  <span
                    class="absolute inset-y-0 -right-1 z-10 w-2 cursor-col-resize"
                    aria-hidden="true"
                    @click.stop
                    @pointerdown.stop="startResize($event, index)"
                    @pointermove="onResize"
                    @pointerup="endResize"
                    @pointercancel="endResize"
                  />
                </span>
              </div>

              <!-- body: a spacer as tall as every row, the rows in view placed in it -->
              <div class="relative" :style="{ height: `${view.length * ROW_H}px` }">
                <div
                  v-for="line in visible"
                  :key="line.index"
                  class="absolute inset-x-0 flex cursor-default border-b border-border/40"
                  :class="
                    line.position === cursor
                      ? 'bg-brand-selected'
                      : marks.marked(line.index + 1)
                        ? 'bg-warning-tint'
                        : rows[line.index]?.error
                          ? 'bg-danger-tint/40 hover:bg-sunken'
                          : 'hover:bg-sunken'
                  "
                  :style="{ top: `${line.position * ROW_H}px`, height: `${ROW_H}px` }"
                  @click="onRowClick(line.position)"
                >
                  <!-- the row number: click, ⇧-click or drag to mark rows -->
                  <span
                    class="sticky left-0 shrink-0 cursor-pointer border-r border-border px-2 text-right leading-6 select-none"
                    :class="
                      marks.marked(line.index + 1)
                        ? 'bg-warning-tint text-warning shadow-[inset_2px_0_0_var(--color-warning)]'
                        : line.position === cursor
                          ? 'bg-brand-selected text-ink-muted hover:text-ink-secondary'
                          : 'bg-surface text-ink-muted hover:text-ink-secondary'
                    "
                    :style="{ width: `${NUMBER_W * CH + 16}px` }"
                    data-gutter
                    @click.stop
                    @pointerdown.stop="marks.onGutterDown($event, rowSpan(line.index))"
                    :data-mark-from="rowSpan(line.index).from"
                    :data-mark-to="rowSpan(line.index).to"
                    >{{ (line.index + 1).toLocaleString('en-US') }}</span
                  >
                  <span
                    v-for="(name, index) in columns"
                    :key="index"
                    class="shrink-0 truncate border-r border-border/40 px-2 leading-6"
                    :class="[
                      types[index] === 'number' || types[index] === 'date' ? 'text-right' : '',
                      rows[line.index]?.error && index === 0 ? 'text-danger' : 'text-ink',
                    ]"
                    :style="{ width: `${widths[index]}px` }"
                    >{{ cellText(line.cells[index] ?? '') }}</span
                  >
                </div>
              </div>
              <p
                v-if="!view.length && !table.reading.value && !table.error.value"
                class="px-3 py-6 text-ink-muted"
              >
                {{ filter ? 'No rows match the filter.' : 'No rows.' }}
              </p>
            </div>
          </div>

          <div
            class="flex h-6 shrink-0 items-center gap-3 border-t border-border bg-sunken px-3 text-[11px] text-ink-muted"
          >
            <span>click a column to sort</span>
          </div>
        </div>

        <!-- The selected row: in the file page's side panel, under "row"; full
             screen covers that panel, so there it stays beside the table. -->
        <Teleport defer to="#file-side-row" :disabled="fullscreen">
          <div
            v-if="!fullscreen || selectedIndex !== undefined"
            :class="{ 'w-[26rem] shrink-0 overflow-y-auto border-l border-border': fullscreen }"
          >
            <TableDetail
              v-if="selectedIndex !== undefined && rows[selectedIndex]"
              :row="rows[selectedIndex]!"
              :number="selectedIndex + 1"
              :columns="columns"
              :cells="table.cellsOf(rows[selectedIndex]!)"
            />
            <p v-else class="px-3 py-3 text-ink-muted">Select a row to see it in full.</p>
          </div>
        </Teleport>
      </div>
    </Teleport>
  </div>
</template>
