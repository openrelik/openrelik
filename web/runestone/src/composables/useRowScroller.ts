/**
 * Row Scroller Composable
 *
 * Scrolling by row number, for viewers whose content may be taller than a
 * browser lets an element be (the hex and text viewers): the position is the
 * first row on screen, the rows that fit are drawn, and the scrollbar is the
 * viewer's own — a thumb over the whole file.
 *
 * - The body's height is measured (and followed with a `ResizeObserver`) to
 *   know how many rows fit.
 * - The wheel scrolls rows; a trackpad's fractions of a row add up until they
 *   make one. Mostly sideways wheels are left to the browser, for content
 *   that scrolls horizontally.
 * - The thumb drags; a click on the track pages toward it.
 */

import { computed, onMounted, onUnmounted, ref, watch, type ComputedRef, type Ref } from 'vue'

const THUMB_MIN = 24

export interface UseRowScrollerReturn {
  /** The first row on screen. */
  topRow: Ref<number>
  /** Rows that fit in the body. */
  visibleRows: ComputedRef<number>
  bodyHeight: Readonly<Ref<number>>
  scrollTo: (row: number) => void
  /** Scrolls as little as it takes to bring `row` on screen. */
  reveal: (row: number) => void
  onWheel: (event: WheelEvent) => void
  thumbHeight: ComputedRef<number>
  thumbTop: ComputedRef<number>
  onThumbDown: (event: PointerEvent) => void
  onThumbMove: (event: PointerEvent) => void
  onThumbUp: () => void
  onTrackDown: (event: PointerEvent) => void
}

export function useRowScroller(
  body: Readonly<Ref<HTMLElement | null>>,
  track: Readonly<Ref<HTMLElement | null>>,
  totalRows: () => number,
  rowHeight: number,
): UseRowScrollerReturn {
  const bodyHeight = ref(0)
  const visibleRows = computed(() => Math.max(1, Math.floor(bodyHeight.value / rowHeight)))
  const maxTop = computed(() => Math.max(0, totalRows() - visibleRows.value))
  const topRow = ref(0)
  const clampTop = (row: number) => Math.min(maxTop.value, Math.max(0, Math.round(row)))
  const scrollTo = (row: number) => (topRow.value = clampTop(row))
  watch(maxTop, (max) => {
    if (topRow.value > max) topRow.value = max
  })

  function reveal(row: number) {
    if (row < topRow.value) scrollTo(row)
    else if (row >= topRow.value + visibleRows.value) scrollTo(row - visibleRows.value + 1)
  }

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

  /** A trackpad sends fractions of rows: they add up until they make one. */
  let wheelRest = 0
  function onWheel(event: WheelEvent) {
    if (Math.abs(event.deltaX) > Math.abs(event.deltaY)) return
    event.preventDefault()
    const px =
      event.deltaMode === 1
        ? event.deltaY * rowHeight
        : event.deltaMode === 2
          ? event.deltaY * bodyHeight.value
          : event.deltaY
    wheelRest += px / rowHeight
    const step = Math.trunc(wheelRest)
    if (!step) return
    wheelRest -= step
    scrollTo(topRow.value + step)
  }

  const thumbHeight = computed(() =>
    !bodyHeight.value || totalRows() <= visibleRows.value
      ? 0
      : Math.max(THUMB_MIN, (visibleRows.value / totalRows()) * bodyHeight.value),
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

  return {
    topRow,
    visibleRows,
    bodyHeight,
    scrollTo,
    reveal,
    onWheel,
    thumbHeight,
    thumbTop,
    onThumbDown,
    onThumbMove,
    onThumbUp: () => (grab = null),
    onTrackDown,
  }
}
