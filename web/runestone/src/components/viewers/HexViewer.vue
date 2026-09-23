<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { ChevronLeft, ChevronRight } from '@/components/icons'

import HexInspector from '@/components/viewers/HexInspector.vue'
import KeyHint from '@/components/base/KeyHint.vue'
import { useByteChunks } from '@/composables/useByteChunks'
import { useDelayedFlag } from '@/composables/useDelayedFlag'
import {
  decodings,
  hex2,
  offsetLabel,
  offsetWidth,
  parseOffset,
  printable,
  readings,
  toHex,
} from '@/utils/bytes'

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
const bodyHeight = ref(0)
const visibleRows = computed(() => Math.max(1, Math.floor(bodyHeight.value / ROW_H)))
const maxTop = computed(() => Math.max(0, totalRows.value - visibleRows.value))
const topRow = ref(0)
const clampTop = (row: number) => Math.min(maxTop.value, Math.max(0, Math.round(row)))
const scrollTo = (row: number) => (topRow.value = clampTop(row))

let observer: ResizeObserver | undefined
onMounted(() => {
  if (!body.value) return
  // Measured now, not only when the observer first reports (it waits for a
  // paint, which a tab in the background never gets).
  bodyHeight.value = body.value.clientHeight
  observer = new ResizeObserver(([entry]) => (bodyHeight.value = entry!.contentRect.height))
  observer.observe(body.value)
})
onUnmounted(() => observer?.disconnect())

const rows = computed(() => {
  const out: { row: number; offset: number }[] = []
  for (let i = 0; i < visibleRows.value && topRow.value + i < totalRows.value; i++) {
    out.push({ row: topRow.value + i, offset: (topRow.value + i) * ROW })
  }
  return out
})

// Fetch what is on screen; cancel what scrolled away.
watch(
  [topRow, visibleRows, () => props.fileId],
  () => bytes.show(topRow.value * ROW, (topRow.value + visibleRows.value) * ROW - 1),
  { immediate: true },
)

/** A trackpad sends fractions of rows: they add up until they make one. */
let wheelRest = 0
function onWheel(event: WheelEvent) {
  const px =
    event.deltaMode === 1
      ? event.deltaY * ROW_H
      : event.deltaMode === 2
        ? event.deltaY * bodyHeight.value
        : event.deltaY
  wheelRest += px / ROW_H
  const step = Math.trunc(wheelRest)
  if (!step) return
  wheelRest -= step
  scrollTo(topRow.value + step)
}

// --- the scrollbar: a thumb over the whole file ---

const track = ref<HTMLElement | null>(null)
const THUMB_MIN = 24
const thumbHeight = computed(() =>
  !bodyHeight.value || totalRows.value <= visibleRows.value
    ? 0
    : Math.max(THUMB_MIN, (visibleRows.value / totalRows.value) * bodyHeight.value),
)
const thumbTop = computed(() =>
  maxTop.value ? (topRow.value / maxTop.value) * (bodyHeight.value - thumbHeight.value) : 0,
)
let grab: { y: number; top: number } | null = null
function onThumbDown(event: PointerEvent) {
  ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
  grab = { y: event.clientY, top: thumbTop.value }
}
function onThumbMove(event: PointerEvent) {
  if (!grab) return
  const room = bodyHeight.value - thumbHeight.value
  if (room > 0) scrollTo(((grab.top + event.clientY - grab.y) / room) * maxTop.value)
}
function onTrackDown(event: PointerEvent) {
  if (event.target !== track.value) return
  // A click on the track pages toward it.
  const above = event.offsetY < thumbTop.value
  scrollTo(topRow.value + (above ? -1 : 1) * visibleRows.value)
}

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
    history.value = { back: [], forward: [] }
  },
)

/** Keeps the cursor's row on screen, scrolling as little as it takes. */
function reveal(offset: number) {
  const row = Math.floor(offset / ROW)
  if (row < topRow.value) scrollTo(row)
  else if (row >= topRow.value + visibleRows.value) scrollTo(row - visibleRows.value + 1)
}

function moveTo(offset: number, extend: boolean) {
  cursor.value = Math.min(last.value, Math.max(0, offset))
  if (!extend) anchor.value = cursor.value
  reveal(cursor.value)
}

let dragging = false
function onByteDown(event: PointerEvent, offset: number) {
  if (event.button !== 0) return
  grid.value?.focus({ preventScroll: true })
  dragging = true
  moveTo(offset, event.shiftKey)
}
function onByteEnter(offset: number) {
  hovered.value = offset
  if (dragging) cursor.value = offset
}
const endDrag = () => (dragging = false)
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
  const offset = parseOffset(gotoText.value)
  if (offset === null || offset > last.value) {
    gotoError.value = true
    return
  }
  gotoError.value = false
  gotoText.value = ''
  jump(offset)
  grid.value?.focus({ preventScroll: true })
}

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
  const length = selectionEnd.value - selectionStart.value + 1
  const end = selectionStart.value + Math.min(length, COPY_MAX) - 1
  try {
    const data = await bytes.read(selectionStart.value, end)
    await navigator.clipboard.writeText(asText ? Array.from(data, printable).join('') : toHex(data))
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
  if (move) {
    moveTo(move(), extend)
  } else if (mod && event.key.toLowerCase() === 'c') {
    copy(extend)
  } else if (!mod && event.key === 'o') {
    // `o` for offset: `g` is the app's prompt, everywhere.
    gotoInput.value?.focus()
  } else if (!mod && event.key === '[') {
    stepBack()
  } else if (!mod && event.key === ']') {
    stepForward()
  } else if (event.key === 'Escape' && anchor.value !== cursor.value) {
    anchor.value = cursor.value
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
  [selectionStart, selectionEnd, () => props.fileId],
  async () => {
    const run = ++decodeRun
    const end = Math.min(selectionEnd.value, selectionStart.value + DECODE_MAX - 1)
    const data = await bytes.read(selectionStart.value, end).catch(() => new Uint8Array())
    if (run === decodeRun) decoded.value = data
  },
  { immediate: true },
)
const selectionDecodings = computed(() => decodings(decoded.value))

// --- a byte's look: selected, cursor, or marked from the other column ---

function tone(offset: number) {
  if (selected(offset)) return 'bg-brand-selected'
  if (hovered.value === offset) return 'bg-sunken'
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
          0x{{ offsetLabel(cursor, width) }}
          <template v-if="selectionEnd > selectionStart">
            · {{ (selectionEnd - selectionStart + 1).toLocaleString('en-US') }} bytes selected
          </template>
          · {{ size.toLocaleString('en-US') }} bytes
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
            type="button"
            class="flex size-5 cursor-pointer items-center justify-center rounded-(--radius-control) hover:bg-sunken hover:text-ink disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent"
            :disabled="!history.back.length"
            aria-label="Back to where the last jump left from"
            v-tooltip="
              history.back.length
                ? `Back to 0x${offsetLabel(history.back.at(-1)!, width)} ([)`
                : 'Back ([): no jump yet'
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
                ? `Forward to 0x${offsetLabel(history.forward.at(-1)!, width)} (])`
                : 'Forward (])'
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
            placeholder="go to offset (o)"
            aria-label="Go to offset, hex (0x…) or decimal"
            class="field tabular h-5 w-36 text-[11px]"
            :class="{ 'border-danger': gotoError }"
            v-tooltip="
              gotoError
                ? `Not an offset in this file (0 to 0x${last.toString(16)})`
                : 'Hex as 0x1f0, or decimal'
            "
            @input="gotoError = false"
            @keydown.esc.stop="((gotoText = ''), grid?.focus())"
          />
        </form>
      </div>

      <!-- the bytes -->
      <div
        ref="grid"
        tabindex="0"
        class="relative flex min-h-0 flex-1 overflow-hidden outline-none focus-visible:ring-1 focus-visible:ring-brand/40 focus-visible:ring-inset"
        role="grid"
        aria-label="File bytes"
        @keydown="onKey"
        @wheel.prevent="onWheel"
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
            <div v-for="line in rows" :key="line.row" class="flex h-5 items-center">
              <span class="shrink-0 px-3 text-ink-muted" :style="{ width: `${width + 3}ch` }">{{
                offsetLabel(line.offset, width)
              }}</span>
              <!-- hex -->
              <span class="flex shrink-0">
                <span
                  v-for="i in COLUMN_OFFSETS"
                  :key="i"
                  class="w-[2.5ch] cursor-default text-center"
                  :class="[
                    { 'ml-[1ch]': i === 8 },
                    line.offset + i > last ? 'invisible' : tone(line.offset + i),
                    isCursor(line.offset + i)
                      ? 'outline outline-1 outline-brand -outline-offset-1'
                      : '',
                    bytes.byteAt(line.offset + i) === undefined ? 'text-ink-muted/50' : 'text-ink',
                  ]"
                  @pointerdown="onByteDown($event, line.offset + i)"
                  @pointerenter="onByteEnter(line.offset + i)"
                  >{{
                    bytes.byteAt(line.offset + i) === undefined
                      ? '··'
                      : hex2(bytes.byteAt(line.offset + i)!)
                  }}</span
                >
              </span>
              <!-- text: the same bytes -->
              <span class="ml-4 flex shrink-0 pr-3">
                <span
                  v-for="i in COLUMN_OFFSETS"
                  :key="i"
                  class="w-[1ch] cursor-default text-center"
                  :class="[
                    line.offset + i > last ? 'invisible' : tone(line.offset + i),
                    isCursor(line.offset + i)
                      ? 'outline outline-1 outline-brand -outline-offset-1'
                      : '',
                    bytes.byteAt(line.offset + i) === undefined
                      ? 'text-ink-muted/50'
                      : bytes.byteAt(line.offset + i)! >= 0x20 &&
                          bytes.byteAt(line.offset + i)! <= 0x7e
                        ? 'text-ink'
                        : 'text-ink-muted/60',
                  ]"
                  @pointerdown="onByteDown($event, line.offset + i)"
                  @pointerenter="onByteEnter(line.offset + i)"
                  >{{
                    bytes.byteAt(line.offset + i) === undefined
                      ? '·'
                      : printable(bytes.byteAt(line.offset + i)!)
                  }}</span
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
            @pointerup="grab = null"
          />
        </div>
      </div>

      <div
        class="flex h-6 shrink-0 items-center gap-3 border-t border-border bg-sunken px-3 text-[11px] text-ink-muted"
      >
        <KeyHint keys="↑↓←→" label="move" />
        <KeyHint keys="⇧" label="select" />
        <KeyHint keys="o" label="go to offset" />
        <KeyHint keys="[ ]" label="back / forward" />
        <KeyHint keys="⌘C" label="copy hex" />
        <KeyHint keys="⇧⌘C" label="copy text" />
      </div>
    </div>

    <HexInspector
      v-model:little-endian="littleEndian"
      :cursor="cursor"
      :selection-start="selectionStart"
      :selection-length="selectionEnd - selectionStart + 1"
      :width="width"
      :readings="cursorReadings"
      :decodings="selectionDecodings"
      :decoded-limit="DECODE_MAX"
      :last="last"
      @jump="jump"
    />
  </div>
</template>
