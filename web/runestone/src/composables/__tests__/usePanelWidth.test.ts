// @vitest-environment happy-dom
import { nextTick } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { usePanelWidth } from '@/composables/usePanelWidth'

function makePointerEvent(
  type: string,
  clientX: number,
  currentTarget?: HTMLElement,
): PointerEvent {
  const event = new PointerEvent(type, { clientX, pointerId: 7 })
  if (currentTarget) {
    Object.defineProperty(event, 'currentTarget', { value: currentTarget })
  }
  return event
}

describe('composables/usePanelWidth', () => {
  beforeEach(() => {
    localStorage.clear()
    Object.defineProperty(window, 'innerWidth', {
      value: 1000,
      configurable: true,
      writable: true,
    })
  })

  it('drags to resize, clamps between min and maxShare of window width, persists to localStorage, and resets', async () => {
    const panel = usePanelWidth('panel.inspector', {
      initial: 320,
      min: 240,
      maxShare: 0.5,
    })

    expect(panel.width.value).toBe(320)

    // Move before start is ignored.
    panel.move(makePointerEvent('pointermove', 500))
    expect(panel.width.value).toBe(320)

    const handle = document.createElement('div')
    const setPointerCapture = vi.fn()
    handle.setPointerCapture = setPointerCapture

    // Start drag at x = 680.
    panel.start(makePointerEvent('pointerdown', 680, handle))
    expect(setPointerCapture).toHaveBeenCalledWith(7)

    // Drag left by 80px -> widens from 320 to 400.
    panel.move(makePointerEvent('pointermove', 600))
    await nextTick()
    expect(panel.width.value).toBe(400)
    expect(JSON.parse(localStorage.getItem('panel.inspector')!)).toBe(400)

    // Drag far left -> clamps at innerWidth * 0.5 = 500.
    panel.move(makePointerEvent('pointermove', 100))
    await nextTick()
    expect(panel.width.value).toBe(500)

    // Drag far right -> clamps at min = 240.
    panel.move(makePointerEvent('pointermove', 950))
    await nextTick()
    expect(panel.width.value).toBe(240)

    // End drag stops reacting to pointer moves.
    panel.end()
    panel.move(makePointerEvent('pointermove', 500))
    expect(panel.width.value).toBe(240)

    // Reset restores initial width and persists it.
    panel.reset()
    await nextTick()
    expect(panel.width.value).toBe(320)
    expect(JSON.parse(localStorage.getItem('panel.inspector')!)).toBe(320)
  })

  it('restores persisted width from localStorage and clamps using default 0.6 maxShare', () => {
    localStorage.setItem('panel.workflow', JSON.stringify(750))
    const panel = usePanelWidth('panel.workflow', { initial: 360, min: 260 })

    // 1000 * 0.6 = 600 max.
    expect(panel.width.value).toBe(600)
  })
})
