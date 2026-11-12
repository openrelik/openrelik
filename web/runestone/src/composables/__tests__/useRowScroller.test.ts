// @vitest-environment happy-dom
import { mount, type VueWrapper } from '@vue/test-utils'
import { defineComponent, h, ref } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useRowScroller, type UseRowScrollerReturn } from '@/composables/useRowScroller'

type ResizeCallback = (entries: { contentRect: { height: number } }[]) => void

let latestResizeCallback: ResizeCallback | null = null
const disconnectSpy = vi.fn()
const observeSpy = vi.fn()

class FakeResizeObserver {
  private callback: ResizeCallback
  constructor(callback: ResizeCallback) {
    this.callback = callback
    latestResizeCallback = callback
  }
  observe = observeSpy
  unobserve = vi.fn()
  disconnect = disconnectSpy
  trigger(height: number): void {
    this.callback([{ contentRect: { height } }])
  }
}

let activeWrapper: VueWrapper | null = null

beforeEach(() => {
  latestResizeCallback = null
  disconnectSpy.mockClear()
  observeSpy.mockClear()
  vi.stubGlobal('ResizeObserver', FakeResizeObserver)
})

afterEach(() => {
  activeWrapper?.unmount()
  activeWrapper = null
})

function mountScroller(options: {
  initialHeight?: number
  totalRows?: () => number
  rowHeight?: number
  withBody?: boolean
}): {
  scroller: UseRowScrollerReturn
  bodyEl: HTMLElement | null
  trackEl: HTMLElement
  wrapper: VueWrapper
} {
  const rowHeight = options.rowHeight ?? 20
  const total = options.totalRows ?? (() => 100)
  const bodyRef = ref<HTMLElement | null>(null)
  const trackRef = ref<HTMLElement | null>(null)
  let scroller!: UseRowScrollerReturn

  const Harness = defineComponent({
    setup() {
      scroller = useRowScroller(bodyRef, trackRef, total, rowHeight)
      return () =>
        h('div', [
          options.withBody === false ? null : h('div', { ref: bodyRef }),
          h('div', { ref: trackRef }),
        ])
    },
  })

  const wrapper = mount(Harness)
  activeWrapper = wrapper

  if (bodyRef.value && options.initialHeight !== undefined) {
    latestResizeCallback?.([{ contentRect: { height: options.initialHeight } }])
  }

  return { scroller, bodyEl: bodyRef.value, trackEl: trackRef.value!, wrapper }
}

describe('useRowScroller', () => {
  it('handles missing body ref on mount and disconnects ResizeObserver on unmount', () => {
    const empty = mountScroller({ withBody: false })
    expect(empty.scroller.bodyHeight.value).toBe(0)
    expect(empty.scroller.visibleRows.value).toBe(1)
    expect(empty.scroller.thumbHeight.value).toBe(0)
    empty.wrapper.unmount()

    const mounted = mountScroller({ initialHeight: 200 })
    expect(observeSpy).toHaveBeenCalledTimes(1)
    expect(mounted.scroller.bodyHeight.value).toBe(200)
    expect(mounted.scroller.visibleRows.value).toBe(10)

    // ResizeObserver updates visibleRows dynamically.
    latestResizeCallback?.([{ contentRect: { height: 300 } }])
    expect(mounted.scroller.visibleRows.value).toBe(15)

    mounted.wrapper.unmount()
    activeWrapper = null
    expect(disconnectSpy).toHaveBeenCalledTimes(1)
  })

  it('clamps scrollTo, reveals off-screen rows minimally, and adapts to dynamic totalRows', () => {
    const total = ref(100)
    const { scroller } = mountScroller({
      initialHeight: 200, // 10 visible rows at rowHeight = 20
      totalRows: () => total.value,
      rowHeight: 20,
    })

    scroller.scrollTo(-15)
    expect(scroller.topRow.value).toBe(0)

    scroller.scrollTo(999)
    expect(scroller.topRow.value).toBe(90) // 100 - 10

    scroller.scrollTo(20.4)
    expect(scroller.topRow.value).toBe(20)

    // Row 25 is already in [20, 30): reveal leaves topRow untouched.
    scroller.reveal(25)
    expect(scroller.topRow.value).toBe(20)

    // Row 35 is below viewport: scrolls minimally so row 35 is the bottom visible row (topRow = 26).
    scroller.reveal(35)
    expect(scroller.topRow.value).toBe(26)

    // Row 12 is above viewport: scrolls up to topRow = 12.
    scroller.reveal(12)
    expect(scroller.topRow.value).toBe(12)

    // When totalRows fits on screen, thumbHeight becomes 0 and thumbTop becomes 0.
    total.value = 8
    expect(scroller.thumbHeight.value).toBe(0)
    expect(scroller.thumbTop.value).toBe(0)

    // Huge totalRows enforces THUMB_MIN (24px).
    total.value = 100_000
    expect(scroller.thumbHeight.value).toBe(24)
  })

  it('accumulates fractional pixel wheel events, supports line/page deltaModes, and ignores horizontal swipes', () => {
    const { scroller } = mountScroller({ initialHeight: 200, rowHeight: 20 })

    // Horizontal gesture (|deltaX| > |deltaY|) is left to the browser.
    const horizPrevent = vi.fn()
    scroller.onWheel({
      deltaX: 30,
      deltaY: 5,
      deltaMode: 0,
      preventDefault: horizPrevent,
    } as unknown as WheelEvent)
    expect(horizPrevent).not.toHaveBeenCalled()
    expect(scroller.topRow.value).toBe(0)

    // Pixel mode (deltaMode = 0): two 12px events accumulate to 24px -> 1 row (with 4px remainder).
    const wheelPrevent = vi.fn()
    scroller.onWheel({
      deltaX: 0,
      deltaY: 12,
      deltaMode: 0,
      preventDefault: wheelPrevent,
    } as unknown as WheelEvent)
    expect(wheelPrevent).toHaveBeenCalledTimes(1)
    expect(scroller.topRow.value).toBe(0)

    scroller.onWheel({
      deltaX: 0,
      deltaY: 12,
      deltaMode: 0,
      preventDefault: wheelPrevent,
    } as unknown as WheelEvent)
    expect(scroller.topRow.value).toBe(1)

    // Line mode (deltaMode = 1): 3 lines -> +3 rows.
    scroller.onWheel({
      deltaX: 0,
      deltaY: 3,
      deltaMode: 1,
      preventDefault: wheelPrevent,
    } as unknown as WheelEvent)
    expect(scroller.topRow.value).toBe(4)

    // Page mode (deltaMode = 2): 1 page (200px = 10 rows) -> +10 rows.
    scroller.onWheel({
      deltaX: 0,
      deltaY: 1,
      deltaMode: 2,
      preventDefault: wheelPrevent,
    } as unknown as WheelEvent)
    expect(scroller.topRow.value).toBe(14)
  })

  it('drags scrollbar thumb and pages when clicking above or below the thumb on the track', () => {
    // 100 rows, 200px body, 20px rowHeight -> 10 visibleRows, maxTop = 90, thumbHeight = 24, room = 176.
    const { scroller, trackEl } = mountScroller({ initialHeight: 200, rowHeight: 20 })
    expect(scroller.thumbHeight.value).toBe(24)
    expect(scroller.thumbTop.value).toBe(0)

    // onThumbMove before grabbing does nothing.
    scroller.onThumbMove({ clientY: 100 } as unknown as PointerEvent)
    expect(scroller.topRow.value).toBe(0)

    const setPointerCapture = vi.fn()
    scroller.onThumbDown({
      pointerId: 1,
      clientY: 10,
      currentTarget: { setPointerCapture },
    } as unknown as PointerEvent)
    expect(setPointerCapture).toHaveBeenCalledWith(1)

    // Drag halfway down the available 176px room (+88px) -> topRow = 45.
    scroller.onThumbMove({ clientY: 98 } as unknown as PointerEvent)
    expect(scroller.topRow.value).toBe(45)
    expect(scroller.thumbTop.value).toBeCloseTo(88, 5)

    scroller.onThumbUp()
    scroller.onThumbMove({ clientY: 10 } as unknown as PointerEvent)
    expect(scroller.topRow.value).toBe(45)

    // Clicking a child element inside track (target !== trackEl) is ignored.
    scroller.onTrackDown({
      target: document.createElement('div'),
      offsetY: 10,
    } as unknown as PointerEvent)
    expect(scroller.topRow.value).toBe(45)

    // Clicking track above thumb (offsetY = 10 < thumbTop 88) pages up by visibleRows (10).
    scroller.onTrackDown({
      target: trackEl,
      offsetY: 10,
    } as unknown as PointerEvent)
    expect(scroller.topRow.value).toBe(35)

    // Clicking track below thumb (offsetY = 170 >= thumbTop) pages down by visibleRows (10).
    scroller.onTrackDown({
      target: trackEl,
      offsetY: 170,
    } as unknown as PointerEvent)
    expect(scroller.topRow.value).toBe(45)
  })

  it('clamps topRow when maxTop shrinks and ignores thumb drag when room <= 0', async () => {
    const { scroller } = mountScroller({ initialHeight: 200, rowHeight: 20 })
    scroller.scrollTo(90)
    expect(scroller.topRow.value).toBe(90)

    // Viewport grows from 200px (10 visibleRows, maxTop=90) to 400px (20 visibleRows, maxTop=80).
    latestResizeCallback?.([{ contentRect: { height: 400 } }])
    await Promise.resolve()
    expect(scroller.topRow.value).toBe(80)

    // Shrink viewport height to 0 so room <= 0; thumb drag does not throw or produce NaN.
    scroller.onThumbDown({
      pointerId: 2,
      clientY: 10,
      currentTarget: { setPointerCapture: vi.fn() },
    } as unknown as PointerEvent)
    latestResizeCallback?.([{ contentRect: { height: 0 } }])
    await Promise.resolve()
    scroller.onThumbMove({ clientY: 50 } as unknown as PointerEvent)
    expect(Number.isFinite(scroller.topRow.value)).toBe(true)
    expect(scroller.topRow.value).toBe(80)
  })
})
