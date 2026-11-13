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
import { ChevronLeft, ChevronRight, Copy } from '@/components/icons'

import HexInspector from '@/components/viewers/HexInspector.vue'
import { useByteChunks } from '@/composables/useByteChunks'
import { useDelayedFlag } from '@/composables/useDelayedFlag'
import { useMarkedRange } from '@/composables/useMarkedRange'
import { useRowScroller } from '@/composables/useRowScroller'
import { copyToClipboard } from '@/directives/copyToClipboard'
import {
  decodings,
  hex2,
  offsetLabel,
  offsetWidth,
  parseOffsetRange,
  printable,
  readings,
  toHex,
} from '@/utils/bytes'
import { sameSpan, type Span } from '@/utils/marks'

/**
 * A file's bytes, sixteen to a row: offset, hex and text, for any file and
 * any size. Read-only.
 *
 * Only the rows on screen exist, and only their bytes are fetched (see
 * `useByteChunks`), so a disk image of many gigabytes opens as fast as a
 * small file. The scroll position is a row number with a scrollbar of its
 * own: a native scroll area would need to be taller than a browser allows.
 *
 * The hex and text columns are one selection: drag in either, and the same
 * bytes light in both; the byte under the pointer is marked in the other
 * column too. The inspector reads the bytes at the cursor and decodes the
 * selection; an integer there can be followed as an offset. Every jump (go
 * to, follow) is remembered, and `[` / `]` step back and forward through them,
 * as a structure is walked pointer by pointer. Bytes are only ever shown as text (printable ASCII, or a dot):
 * nothing in a file is interpreted.
 */
const props = defineProps<{ fileId: number; size: number }>()
/** Marked bytes (offsets, inclusive): the page keeps them in its URL as `#0x1f3-0x2a0`. */
const mark = defineModel<Span | null>('mark', { default: null })

const ROW = 16
const ROW_H = 20
/** Copying a selection reads its bytes: capped, so a stray ⌘A cannot pull in a disk image. */
const COPY_MAX = 64 * 1024
const DECODE_MAX = 256

const bytes = useByteChunks(
  () => props.fileId,
  () => props.size,
)
const showLoading = useDelayedFlag(() => bytes.loading.value)

const width = computed(() => offsetWidth(props.size))
const totalRows = computed(() => Math.ceil(props.size / ROW))
const last = computed(() => Math.max(0, props.size - 1))

// --- scrolling: a row number, and as many rows as fit ---

const body = ref<HTMLElement | null>(null)
const grid = ref<HTMLElement | null>(null)
const track = ref<HTMLElement | null>(null)
const {
  topRow,
  visibleRows,
  scrollTo,
  reveal: revealRow,
  onWheel,
  thumbHeight,
  thumbTop,
  onThumbDown,
  onThumbMove,
  onThumbUp,
  onTrackDown,
} = useRowScroller(body, track, () => totalRows.value, ROW_H)

const rows = computed(() => {
  const out: { row: number; offset: number; cells: (number | undefined)[] }[] = []
  for (let i = 0; i < visibleRows.value && topRow.value + i < totalRows.value; i++) {
    const row = topRow.value + i
    const offset = row * ROW
    const cells: (number | undefined)[] = []
    for (let col = 0; col < ROW; col++) {
      cells.push(offset + col <= last.value ? bytes.byteAt(offset + col) : undefined)
    }
    out.push({ row, offset, cells })
  }
  return out
})

// Fetch what is on screen; cancel what scrolled away.
watch(
  [topRow, visibleRows, () => props.fileId, () => props.size],
  () => bytes.show(topRow.value * ROW, (topRow.value + visibleRows.value) * ROW - 1),
  { immediate: true },
)

// --- the cursor and selection: byte offsets, shared by both columns ---

const anchor = ref(0)
const cursor = ref(0)
const hovered = ref<number | null>(null)
const selectionStart = computed(() => Math.min(anchor.value, cursor.value))
const selectionEnd = computed(() => Math.max(anchor.value, cursor.value))
const selected = (offset: number) => offset >= selectionStart.value && offset <= selectionEnd.value

watch(
  () => props.fileId,
  () => {
    anchor.value = cursor.value = 0
    topRow.value = 0
    hovered.value = null
    gotoText.value = ''
    gotoError.value = false
    dragging = false
    pressedOnByte = false
    history.value = { back: [], forward: [] }
    marks.anchor.value = null
  },
)

/** Keeps the cursor's row on screen, scrolling as little as it takes. */
function reveal(offset: number) {
  revealRow(Math.floor(offset / ROW))
}

function moveTo(offset: number, extend: boolean) {
  if (props.size <= 0) return
  cursor.value = Math.min(last.value, Math.max(0, offset))
  if (!extend) anchor.value = cursor.value
  reveal(cursor.value)
}

let dragging = false
/** The press began on a byte, without ⇧: its click unmarks (see `onGridClick`). */
let pressedOnByte = false
function onByteDown(event: PointerEvent, offset: number) {
  if (event.button !== 0 || props.size <= 0 || offset > last.value) return
  grid.value?.focus({ preventScroll: true })
  dragging = true
  pressedOnByte = !event.shiftKey
  moveTo(offset, event.shiftKey)
}
/**
 * A plain click on a byte unmarks the bytes, as a click in the text view
 * unmarks lines. A drag that selected bytes leaves them: the bytes can be
 * selected and copied from inside a mark.
 */
function onGridClick() {
  if (pressedOnByte && anchor.value === cursor.value && mark.value) marks.set(null)
  pressedOnByte = false
}
function onByteEnter(offset: number) {
  if (props.size <= 0 || offset > last.value) return
  hovered.value = offset
  if (dragging) cursor.value = offset
}
function endDrag() {
  if (!dragging) return
  dragging = false
  markSelected()
}
onMounted(() => window.addEventListener('pointerup', endDrag))
onUnmounted(() => window.removeEventListener('pointerup', endDrag))

// --- jumps, and back and forward through them ---

/** Where each jump left from (back), and where stepping back left from (forward). */
const history = ref<{ back: number[]; forward: number[] }>({ back: [], forward: [] })
const HISTORY_MAX = 100

/** Puts the cursor at `offset` with some context above, as a jump lands. */
function land(offset: number) {
  moveTo(offset, false)
  scrollTo(Math.floor(offset / ROW) - Math.floor(visibleRows.value / 3))
}

/** Goes to `offset`, remembering where it came from. */
function jump(offset: number) {
  if (offset < 0 || offset > last.value || offset === cursor.value) return
  history.value = {
    back: [...history.value.back, cursor.value].slice(-HISTORY_MAX),
    forward: [],
  }
  land(offset)
  grid.value?.focus({ preventScroll: true })
}

function stepBack() {
  const back = [...history.value.back]
  const to = back.pop()
  if (to === undefined) return
  history.value = { back, forward: [...history.value.forward, cursor.value] }
  land(to)
}

function stepForward() {
  const forward = [...history.value.forward]
  const to = forward.pop()
  if (to === undefined) return
  history.value = { back: [...history.value.back, cursor.value], forward }
  land(to)
}

// --- go to an offset ---

const gotoInput = ref<HTMLInputElement | null>(null)
const gotoText = ref('')
const gotoError = ref(false)
function goTo() {
  const span = parseOffsetRange(gotoText.value)
  if (props.size <= 0 || !span || span.from > last.value) {
    gotoError.value = true
    return
  }
  gotoError.value = false
  gotoText.value = ''
  const marked = { from: span.from, to: Math.min(span.to, last.value) }
  marks.set(marked)
  marks.anchor.value = marked
  if (marked.from !== cursor.value) jump(marked.from)
  else {
    land(marked.from)
    grid.value?.focus({ preventScroll: true })
  }
}

// --- marked bytes: from the offsets, go-to, or a link ---

const marks = useMarkedRange(mark, 'offset', {
  // Once mounted and measured, so the landing has rows of context above it.
  land: (span) => void nextTick(() => land(Math.min(span.from, last.value))),
  focus: () => grid.value?.focus({ preventScroll: true }),
  deselect: () => (anchor.value = cursor.value),
})
/** The bytes of the row at `offset`. */
const rowSpan = (offset: number) => ({ from: offset, to: Math.min(offset + ROW - 1, last.value) })
/** The mark is whole rows: only then do the offsets show it, as marked bytes show themselves. */
const wholeRows = computed(() => {
  if (!mark.value || props.size <= 0) return false
  const { from, to } = mark.value
  return from % ROW === 0 && ((to + 1) % ROW === 0 || to === last.value)
})
/** More than one byte selected: `m`, or the link button, marks them. */
const hasSelection = computed(() => selectionEnd.value > selectionStart.value)
/**
 * Selected bytes become the mark once the selection stops moving (the drag
 * let go of, the ⇧-arrow released), as clicked offsets do: the URL always
 * links to what is selected.
 */
function markSelected() {
  if (!hasSelection.value) return
  const span = { from: selectionStart.value, to: selectionEnd.value }
  if (sameSpan(span, mark.value)) return
  marks.set(span)
  marks.anchor.value = span
}

/** Marks the selected bytes and copies a link to them. */
async function markSelection() {
  if (!hasSelection.value) return
  const span = { from: selectionStart.value, to: selectionEnd.value }
  marks.set(span)
  marks.anchor.value = span
  // The mark shows once the selection's own highlight is gone.
  anchor.value = cursor.value
  say(await marks.copyLink(span))
}

/** The link button: to the selected bytes when there are some, else to the mark. */
async function copyLink() {
  if (hasSelection.value) await markSelection()
  else say(await marks.copyLink())
}
const linkLabel = computed(() =>
  hasSelection.value ? 'Copy a link to the selected bytes' : `Copy a link to ${marks.label()}`,
)

// --- copy ---

const notice = ref<string | null>(null)
let noticeTimer: ReturnType<typeof setTimeout> | undefined
function say(text: string) {
  notice.value = text
  clearTimeout(noticeTimer)
  noticeTimer = setTimeout(() => (notice.value = null), 2500)
}
onUnmounted(() => clearTimeout(noticeTimer))

async function copy(asText: boolean) {
  if (props.size <= 0) return
  const length = selectionEnd.value - selectionStart.value + 1
  const end = selectionStart.value + Math.min(length, COPY_MAX) - 1
  try {
    const data = await bytes.read(selectionStart.value, end)
    const ok = await copyToClipboard(asText ? Array.from(data, printable).join('') : toHex(data))
    if (!ok) {
      say('Could not copy the selection')
      return
    }
    say(
      `Copied ${data.length.toLocaleString('en-US')} bytes as ${asText ? 'text' : 'hex'}` +
        (length > COPY_MAX ? ` (the first ${COPY_MAX / 1024} KiB)` : ''),
    )
  } catch {
    say('Could not copy the selection')
  }
}

// --- keys, while the grid has focus ---

function onKey(event: KeyboardEvent) {
  if (event.altKey) return
  const mod = event.metaKey || event.ctrlKey
  const extend = event.shiftKey
  const page = visibleRows.value * ROW
  const moves: Record<string, () => number> = {
    ArrowLeft: () => cursor.value - 1,
    ArrowRight: () => cursor.value + 1,
    ArrowUp: () => (mod ? 0 : cursor.value - ROW),
    ArrowDown: () => (mod ? last.value : cursor.value + ROW),
    PageUp: () => cursor.value - page,
    PageDown: () => cursor.value + page,
    Home: () => (mod ? 0 : cursor.value - (cursor.value % ROW)),
    End: () =>
      mod ? last.value : Math.min(last.value, cursor.value - (cursor.value % ROW) + ROW - 1),
  }
  const move = moves[event.key]
  if (move && props.size > 0) {
    moveTo(move(), extend)
  } else if (mod && event.key.toLowerCase() === 'c' && props.size > 0) {
    void copy(extend)
  } else if (!mod && event.key === 'm' && (hasSelection.value || mark.value)) {
    void copyLink()
  } else if (!mod && event.key === 'o') {
    // `o` for offset: `g` is the app's prompt, everywhere.
    gotoInput.value?.focus()
  } else if (!mod && event.key === '[') {
    stepBack()
  } else if (!mod && event.key === ']') {
    stepForward()
  } else if (event.key === 'Escape' && anchor.value !== cursor.value) {
    anchor.value = cursor.value
  } else if (event.key === 'Escape' && mark.value) {
    marks.set(null)
  } else {
    return
  }
  // The file page's keys (←→ step through files, esc goes back) wait while the bytes have focus.
  event.preventDefault()
  event.stopPropagation()
}

// --- the inspector ---

const littleEndian = ref(true)
/** The bytes from the selection's start (the cursor, when nothing is selected), as far as loaded; up to 8. */
const atCursor = computed(() => {
  if (props.size <= 0) return new Uint8Array()
  const out: number[] = []
  const from = selectionStart.value
  for (let offset = from; offset < from + 8 && offset <= last.value; offset++) {
    const byte = bytes.byteAt(offset)
    if (byte === undefined) break
    out.push(byte)
  }
  return new Uint8Array(out)
})
const cursorReadings = computed(() => readings(atCursor.value, littleEndian.value))

/** The selection's first bytes, read (and loaded, when off screen) as it changes. */
const decoded = ref<Uint8Array>(new Uint8Array())
let decodeRun = 0
watch(
  [selectionStart, selectionEnd, () => props.fileId, () => props.size],
  async () => {
    const run = ++decodeRun
    if (props.size <= 0) {
      decoded.value = new Uint8Array()
      return
    }
    const end = Math.min(selectionEnd.value, selectionStart.value + DECODE_MAX - 1)
    const data = await bytes.read(selectionStart.value, end).catch(() => new Uint8Array())
    if (run === decodeRun) decoded.value = data
  },
  { immediate: true },
)
const selectionDecodings = computed(() => decodings(decoded.value))

// --- a byte's look: selected, cursor, or marked from the other column ---

function tone(offset: number) {
  if (selected(offset)) return 'bg-selection'
  if (hovered.value === offset) return 'bg-sunken'
  if (marks.marked(offset)) return 'bg-warning-tint'
  return ''
}
const isCursor = (offset: number) => offset === cursor.value
const COLUMN_OFFSETS = Array.from({ length: ROW }, (_, i) => i)
</script>

<template>
  <div class="flex min-h-0 min-w-0 flex-1">
    <div class="flex min-h-0 min-w-0 flex-1 flex-col">
      <!-- status and go-to -->
      <div class="flex h-7 shrink-0 items-center gap-3 border-b border-border px-3 text-ink-muted">
        <span class="tabular truncate">
          <template v-if="size > 0">0x{{ offsetLabel(cursor, width) }} · </template
          ><template v-if="size > 0 && selectionEnd > selectionStart">
            {{ (selectionEnd - selectionStart + 1).toLocaleString('en-US') }} bytes selected · </template
          ><template v-if="mark">{{ marks.label() }} marked · </template
          >{{ size.toLocaleString('en-US') }} bytes
        </span>
        <span v-if="notice" class="truncate text-ink-secondary" aria-live="polite">{{
          notice
        }}</span>
        <span v-else-if="bytes.error.value" class="truncate text-danger" role="alert">{{
          bytes.error.value
        }}</span>
        <span v-else-if="showLoading" class="text-ink-muted">reading bytes…</span>
        <div class="ml-auto flex items-center">
          <button
            v-if="mark || hasSelection"
            type="button"
            class="mr-1 flex size-5 cursor-pointer items-center justify-center rounded-(--radius-control) hover:bg-sunken hover:text-ink"
            :aria-label="linkLabel"
            v-tooltip="linkLabel"
            @click="copyLink"
          >
            <Copy :size="13" :stroke-width="1.5" />
          </button>
          <button
            type="button"
            class="flex size-5 cursor-pointer items-center justify-center rounded-(--radius-control) hover:bg-sunken hover:text-ink disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent"
            :disabled="!history.back.length"
            aria-label="Back to where the last jump left from"
            v-tooltip="
              history.back.length
                ? `Back to 0x${offsetLabel(history.back.at(-1)!, width)}`
                : 'Back: no jump yet'
            "
            @click="stepBack"
          >
            <ChevronLeft :size="13" :stroke-width="1.5" />
          </button>
          <button
            type="button"
            class="flex size-5 cursor-pointer items-center justify-center rounded-(--radius-control) hover:bg-sunken hover:text-ink disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent"
            :disabled="!history.forward.length"
            aria-label="Forward again"
            v-tooltip="
              history.forward.length
                ? `Forward to 0x${offsetLabel(history.forward.at(-1)!, width)}`
                : 'Forward: no jump to return to'
            "
            @click="stepForward"
          >
            <ChevronRight :size="13" :stroke-width="1.5" />
          </button>
        </div>
        <form class="flex items-center gap-1.5" @submit.prevent="goTo">
          <input
            ref="gotoInput"
            v-model="gotoText"
            type="text"
            spellcheck="false"
            autocomplete="off"
            placeholder="go to offset"
            aria-label="Go to an offset, or a range as 0x1f0-0x2a0"
            class="field tabular h-5 w-36 font-mono text-[11px]"
            :class="{ 'border-danger': gotoError }"
            v-tooltip="
              gotoError
                ? size > 0
                  ? `Not an offset in this file (0 to 0x${last.toString(16)})`
                  : 'Empty file has no offsets'
                : 'An offset (0x1f0, or decimal), or a range as 0x1f0-0x2a0'
            "
            @input="gotoError = false"
            @keydown.esc.stop="((gotoText = ''), (gotoError = false), grid?.focus())"
          />
        </form>
      </div>

      <!-- the bytes -->
      <div
        ref="grid"
        tabindex="0"
        class="relative flex min-h-0 flex-1 overflow-hidden font-mono outline-none focus-visible:ring-1 focus-visible:ring-brand/40 focus-visible:ring-inset"
        role="grid"
        aria-label="File bytes"
        @keydown="onKey"
        @keyup="markSelected"
        @wheel="onWheel"
        @pointerdown.capture="pressedOnByte = false"
        @click="onGridClick"
        @pointerleave="hovered = null"
      >
        <!-- A column: the body fills what the heads leave, whatever rows it holds, so
             its measured height (how many rows fit) never depends on the rows. -->
        <div class="tabular flex min-w-0 flex-1 flex-col overflow-x-auto select-none">
          <!-- column heads -->
          <div
            class="flex h-6 shrink-0 items-center border-b border-border text-[11px] text-ink-muted"
          >
            <span class="shrink-0 px-3" :style="{ width: `${width + 3}ch` }">offset</span>
            <span class="flex shrink-0">
              <span
                v-for="i in COLUMN_OFFSETS"
                :key="i"
                class="w-[2.5ch] text-center"
                :class="{ 'ml-[1ch]': i === 8 }"
                >{{ hex2(i) }}</span
              >
            </span>
            <span class="ml-4 shrink-0">text</span>
          </div>

          <div ref="body" class="min-h-0 flex-1 overflow-hidden">
            <p v-if="size === 0" class="px-3 py-3 font-sans text-ink-muted">
              Empty file (0 bytes).
            </p>
            <div v-for="line in rows" :key="line.row" class="flex h-5 items-center">
              <!-- the row's offset: click, ⇧-click or drag to mark its bytes -->
              <span
                class="shrink-0 cursor-pointer px-3"
                :class="
                  wholeRows && marks.marked(line.offset, line.offset + ROW - 1)
                    ? 'bg-warning-tint text-warning shadow-[inset_2px_0_0_var(--color-warning)]'
                    : 'text-ink-muted hover:text-ink-secondary'
                "
                :style="{ width: `${width + 3}ch` }"
                @pointerdown="marks.onGutterDown($event, rowSpan(line.offset))"
                :data-mark-from="rowSpan(line.offset).from"
                :data-mark-to="rowSpan(line.offset).to"
                >{{ offsetLabel(line.offset, width) }}</span
              >
              <!-- hex -->
              <span class="flex shrink-0">
                <span
                  v-for="(byte, i) in line.cells"
                  :key="i"
                  class="w-[2.5ch] cursor-default text-center"
                  :class="[
                    { 'ml-[1ch]': i === 8 },
                    line.offset + i > last ? 'invisible' : tone(line.offset + i),
                    isCursor(line.offset + i)
                      ? 'outline outline-1 outline-brand -outline-offset-1'
                      : '',
                    byte === undefined ? 'text-ink-muted/50' : 'text-ink',
                  ]"
                  @pointerdown="onByteDown($event, line.offset + i)"
                  @pointerenter="onByteEnter(line.offset + i)"
                  >{{ byte === undefined ? '··' : hex2(byte) }}</span
                >
              </span>
              <!-- text: the same bytes -->
              <span class="ml-4 flex shrink-0 pr-3">
                <span
                  v-for="(byte, i) in line.cells"
                  :key="i"
                  class="w-[1ch] cursor-default text-center"
                  :class="[
                    line.offset + i > last ? 'invisible' : tone(line.offset + i),
                    isCursor(line.offset + i)
                      ? 'outline outline-1 outline-brand -outline-offset-1'
                      : '',
                    byte === undefined
                      ? 'text-ink-muted/50'
                      : byte >= 0x20 && byte <= 0x7e
                        ? 'text-ink'
                        : 'text-ink-muted/60',
                  ]"
                  @pointerdown="onByteDown($event, line.offset + i)"
                  @pointerenter="onByteEnter(line.offset + i)"
                  >{{ byte === undefined ? '·' : printable(byte) }}</span
                >
              </span>
            </div>
          </div>
        </div>

        <!-- a scrollbar over the whole file -->
        <div
          v-if="thumbHeight"
          ref="track"
          class="relative mt-6 w-2.5 shrink-0 border-l border-border bg-sunken"
          @pointerdown="onTrackDown"
        >
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

    <!-- shown in the file page's side panel, under "bytes" -->
    <Teleport defer to="#file-side-bytes">
      <HexInspector
        v-model:little-endian="littleEndian"
        :selection-start="selectionStart"
        :selection-length="size > 0 ? selectionEnd - selectionStart + 1 : 0"
        :width="width"
        :readings="cursorReadings"
        :decodings="selectionDecodings"
        :decoded-limit="DECODE_MAX"
        :last="last"
        @jump="jump"
      />
    </Teleport>
  </div>
</template>
