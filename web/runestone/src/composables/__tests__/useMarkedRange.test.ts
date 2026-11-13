/*
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
*/

// @vitest-environment happy-dom
import { mount, type VueWrapper } from '@vue/test-utils'
import { defineComponent, h, ref, type Ref } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { useMarkedRange, type UseMarkedRangeReturn } from '@/composables/useMarkedRange'
import { parseMark, type MarkKind, type Span } from '@/utils/marks'

let activeWrapper: VueWrapper | null = null

afterEach(() => {
  activeWrapper?.unmount()
  activeWrapper = null
})

function mountMarkedRange(
  initial: Span | null = null,
  kind: MarkKind = 'line',
  withDeselect = true,
): {
  model: Ref<Span | null>
  range: UseMarkedRangeReturn
  land: ReturnType<typeof vi.fn<(span: Span) => void>>
  focus: ReturnType<typeof vi.fn<() => void>>
  deselect: ReturnType<typeof vi.fn<() => void>>
  wrapper: VueWrapper
} {
  const model = ref<Span | null>(initial)
  const land = vi.fn<(span: Span) => void>()
  const focus = vi.fn<() => void>()
  const deselect = vi.fn<() => void>()
  let range!: UseMarkedRangeReturn

  const Harness = defineComponent({
    setup() {
      range = useMarkedRange(model, kind, {
        land,
        focus,
        deselect: withDeselect ? deselect : undefined,
      })
      return () => h('div')
    },
  })

  const wrapper = mount(Harness)
  activeWrapper = wrapper
  return { model, range, land, focus, deselect, wrapper }
}

function makeGutterEvent(options: { button?: number; shiftKey?: boolean } = {}): {
  event: PointerEvent
  preventDefault: ReturnType<typeof vi.fn>
} {
  const el = document.createElement('button')
  vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({
    left: 10,
    width: 30,
    top: 0,
    bottom: 20,
    right: 40,
    height: 20,
    x: 10,
    y: 0,
    toJSON: () => ({}),
  })
  const preventDefault = vi.fn()
  const event = {
    button: options.button ?? 0,
    shiftKey: options.shiftKey ?? false,
    currentTarget: el,
    preventDefault,
  } as unknown as PointerEvent
  return { event, preventDefault }
}

describe('useMarkedRange', () => {
  it('lands on an initial URL hash mark (#L10-L20) and distinguishes external vs self-set marks', async () => {
    const parsed = parseMark('#L10-L20')
    expect(parsed).toEqual({ kind: 'line', from: 10, to: 20 })

    const { model, range, land } = mountMarkedRange({ from: parsed!.from, to: parsed!.to }, 'line')

    expect(land).toHaveBeenCalledTimes(1)
    expect(land).toHaveBeenCalledWith({ from: 10, to: 20 })
    expect(range.anchor.value).toEqual({ from: 10, to: 20 })
    expect(range.marked(9)).toBe(false)
    expect(range.marked(10)).toBe(true)
    expect(range.marked(15, 25)).toBe(true)
    expect(range.marked(21, 30)).toBe(false)
    expect(range.label()).toBe('lines 10–20')

    // Self-set mark updates model without triggering land().
    land.mockClear()
    range.set({ from: 30, to: 35 })
    await Promise.resolve()
    expect(model.value).toEqual({ from: 30, to: 35 })
    expect(land).not.toHaveBeenCalled()

    // External navigation updating model triggers land().
    model.value = { from: 50, to: 52 }
    await Promise.resolve()
    expect(land).toHaveBeenCalledTimes(1)
    expect(land).toHaveBeenCalledWith({ from: 50, to: 52 })

    // Clearing via set(null) clears anchor and label.
    range.set(null)
    expect(model.value).toBeNull()
    expect(range.anchor.value).toBeNull()
    expect(range.label()).toBe('')
    expect(range.marked(50)).toBe(false)
  })

  it('handles gutter click, shift-click range extension, click-again clear, and non-primary clicks', () => {
    const { model, range, focus, deselect } = mountMarkedRange(null, 'line')

    // Right click (button = 2) is ignored.
    const rightClick = makeGutterEvent({ button: 2 })
    range.onGutterDown(rightClick.event, { from: 5, to: 5 })
    expect(rightClick.preventDefault).not.toHaveBeenCalled()
    expect(model.value).toBeNull()

    // Primary click on line 10 selects line 10.
    const click10 = makeGutterEvent()
    range.onGutterDown(click10.event, { from: 10, to: 10 })
    expect(click10.preventDefault).toHaveBeenCalledTimes(1)
    expect(focus).toHaveBeenCalledTimes(1)
    expect(deselect).toHaveBeenCalledTimes(1)
    expect(model.value).toEqual({ from: 10, to: 10 })
    expect(range.anchor.value).toEqual({ from: 10, to: 10 })

    // Shift-click on line 20 selects 10..20 while keeping anchor at 10.
    const shiftClick20 = makeGutterEvent({ shiftKey: true })
    range.onGutterDown(shiftClick20.event, { from: 20, to: 20 })
    expect(model.value).toEqual({ from: 10, to: 20 })
    expect(range.anchor.value).toEqual({ from: 10, to: 10 })

    // Shift-click upwards on line 4 selects 4..10 from the same anchor.
    const shiftClick4 = makeGutterEvent({ shiftKey: true })
    range.onGutterDown(shiftClick4.event, { from: 4, to: 4 })
    expect(model.value).toEqual({ from: 4, to: 10 })

    // Plain click on line 7 selects just line 7; clicking line 7 again clears the mark.
    range.onGutterDown(makeGutterEvent().event, { from: 7, to: 7 })
    expect(model.value).toEqual({ from: 7, to: 7 })

    range.onGutterDown(makeGutterEvent().event, { from: 7, to: 7 })
    expect(model.value).toBeNull()
    expect(range.anchor.value).toBeNull()
  })

  it('extends selection while pointer dragging across gutter rows and stops on pointerup', () => {
    const { model, range } = mountMarkedRange(null, 'offset', false)

    // Start drag on hex row 0x10..0x1f (dragX = 10 + 30/2 = 25).
    range.onGutterDown(makeGutterEvent().event, { from: 0x10, to: 0x1f })
    expect(model.value).toEqual({ from: 0x10, to: 0x1f })

    const gutterRow = document.createElement('div')
    gutterRow.dataset.markFrom = String(0x30)
    gutterRow.dataset.markTo = String(0x3f)
    const childSpan = document.createElement('span')
    gutterRow.appendChild(childSpan)

    const origElementFromPoint = document.elementFromPoint
    const fromPointSpy = vi.fn<(x: number, y: number) => Element | null>(() => childSpan)
    document.elementFromPoint = fromPointSpy

    try {
      window.dispatchEvent(new PointerEvent('pointermove', { clientY: 120 }))
      expect(fromPointSpy).toHaveBeenCalledWith(25, 120)
      expect(model.value).toEqual({ from: 0x10, to: 0x3f })

      // Moving over a non-marked element leaves selection unchanged.
      fromPointSpy.mockReturnValueOnce(document.createElement('div'))
      window.dispatchEvent(new PointerEvent('pointermove', { clientY: 140 }))
      expect(model.value).toEqual({ from: 0x10, to: 0x3f })

      // Releasing pointer ends drag: further pointermove does not query or mutate.
      window.dispatchEvent(new PointerEvent('pointerup'))
      fromPointSpy.mockClear()
      window.dispatchEvent(new PointerEvent('pointermove', { clientY: 180 }))
      expect(fromPointSpy).not.toHaveBeenCalled()
    } finally {
      document.elementFromPoint = origElementFromPoint
    }
  })

  it('copies a formatted URL hash link to the clipboard and handles missing marks or clipboard errors', async () => {
    window.location.href = 'http://localhost:5173/folder/1/file/2'
    const writeText = vi.fn<(text: string) => Promise<void>>().mockResolvedValue()
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    })

    const { range } = mountMarkedRange(null, 'line')
    expect(await range.copyLink()).toBe('')

    range.set({ from: 10, to: 20 })
    const copied = await range.copyLink()
    expect(copied).toBe('Copied a link to lines 10–20')
    expect(writeText).toHaveBeenCalledWith('http://localhost:5173/folder/1/file/2#L10-L20')

    // Explicit span override works before model settles.
    const overrideMsg = await range.copyLink({ from: 5, to: 5 })
    expect(overrideMsg).toBe('Copied a link to line 5')
    expect(writeText).toHaveBeenLastCalledWith('http://localhost:5173/folder/1/file/2#L5')

    // Clipboard rejection returns fallback status string.
    writeText.mockRejectedValueOnce(new Error('Permission denied'))
    expect(await range.copyLink()).toBe('Could not copy the link')
  })

  it('clears ownHash on external clear or external change so revisiting the same mark lands', async () => {
    const { model, range, land } = mountMarkedRange(null, 'line')

    // Self-set mark does not call land().
    range.onGutterDown(makeGutterEvent().event, { from: 10, to: 20 })
    await Promise.resolve()
    expect(land).not.toHaveBeenCalled()
    expect(range.anchor.value).toEqual({ from: 10, to: 20 })

    // External clear resets both anchor and ownHash.
    model.value = null
    await Promise.resolve()
    expect(range.anchor.value).toBeNull()

    // Setting the exact same range externally afterwards must call land().
    model.value = { from: 10, to: 20 }
    await Promise.resolve()
    expect(land).toHaveBeenCalledWith({ from: 10, to: 20 })

    // Returning externally (e.g., browser Back) to a previously self-set mark also calls land().
    range.set({ from: 30, to: 35 })
    await Promise.resolve()
    model.value = { from: 50, to: 55 }
    await Promise.resolve()
    model.value = { from: 30, to: 35 }
    await Promise.resolve()
    expect(land).toHaveBeenLastCalledWith({ from: 30, to: 35 })
  })

  it('ignores non-numeric drag targets, stops on pointercancel, and ignores shift-click without anchor', () => {
    const { model, range } = mountMarkedRange(null, 'line', false)

    // Shift-click with no existing mark uses the clicked span as anchor.
    range.onGutterDown(makeGutterEvent({ shiftKey: true }).event, { from: 8, to: 8 })
    expect(model.value).toEqual({ from: 8, to: 8 })

    const badRow = document.createElement('div')
    badRow.dataset.markFrom = 'NaN'
    badRow.dataset.markTo = '12'
    const origElementFromPoint = document.elementFromPoint
    const fromPointSpy = vi.fn<(x: number, y: number) => Element | null>(() => badRow)
    document.elementFromPoint = fromPointSpy

    try {
      window.dispatchEvent(new PointerEvent('pointermove', { clientY: 100 }))
      expect(model.value).toEqual({ from: 8, to: 8 })

      // Re-moving over same span leaves model unchanged; pointercancel ends drag.
      window.dispatchEvent(new PointerEvent('pointercancel'))
      fromPointSpy.mockClear()
      window.dispatchEvent(new PointerEvent('pointermove', { clientY: 120 }))
      expect(fromPointSpy).not.toHaveBeenCalled()
    } finally {
      document.elementFromPoint = origElementFromPoint
    }
  })
})
