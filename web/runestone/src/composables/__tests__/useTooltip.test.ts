// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  flashTooltip,
  HIDE_GRACE,
  hideTooltip,
  holdTooltip,
  isKeyboardFocus,
  isTouch,
  parseTooltip,
  showTooltip,
  TOOLTIP_ID,
  updateTooltip,
  useTooltip,
} from '@/composables/useTooltip'

function makeAnchor(rect: Partial<DOMRect> = {}): HTMLButtonElement {
  const el = document.createElement('button')
  el.getBoundingClientRect = () =>
    ({
      x: 100,
      y: 80,
      left: 100,
      top: 80,
      right: 160,
      bottom: 112,
      width: 60,
      height: 32,
      toJSON: () => ({}),
      ...rect,
    }) as DOMRect
  document.body.appendChild(el)
  return el
}

describe('composables/useTooltip', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    hideTooltip()
    vi.advanceTimersByTime(1000)
  })

  afterEach(() => {
    hideTooltip()
    vi.advanceTimersByTime(1000)
    document.body.innerHTML = ''
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('parses string and options inputs and ignores empty tooltip text', () => {
    expect(parseTooltip('Copy hash')).toEqual({ text: 'Copy hash' })
    expect(parseTooltip({ text: 'Run', detail: 'Queue worker', placement: 'bottom' })).toEqual({
      text: 'Run',
      detail: 'Queue worker',
      placement: 'bottom',
    })

    const anchor = makeAnchor()
    const { state } = useTooltip()
    showTooltip(anchor, '')
    vi.advanceTimersByTime(1000)
    expect(state.visible).toBe(false)
  })

  it('waits 400ms on cold hover, transitions instantly while warm, and cools down after 400ms', () => {
    const first = makeAnchor({ left: 40, top: 20 })
    first.setAttribute('aria-describedby', 'existing-hint')
    const second = makeAnchor({ left: 120, top: 20 })
    const { state } = useTooltip()

    // Cold hover waits 400ms.
    showTooltip(first, { text: 'Download', detail: 'Stream to disk', placement: 'bottom' })
    vi.advanceTimersByTime(399)
    expect(state.visible).toBe(false)

    vi.advanceTimersByTime(1)
    expect(state.visible).toBe(true)
    expect(state.text).toBe('Download')
    expect(state.detail).toBe('Stream to disk')
    expect(state.preferred).toBe('bottom')
    expect(state.anchor?.left).toBe(40)
    expect(first.getAttribute('aria-describedby')).toBe(`existing-hint ${TOOLTIP_ID}`)

    // Re-hovering the same visible anchor cancels a pending grace hide without resetting.
    const revBefore = state.revision
    hideTooltip(first, HIDE_GRACE)
    vi.advanceTimersByTime(50)
    showTooltip(first, { text: 'Download', detail: 'Stream to disk', placement: 'bottom' })
    vi.advanceTimersByTime(200)
    expect(state.visible).toBe(true)
    expect(state.revision).toBe(revBefore)

    // Hide first tooltip: restores previous aria-describedby and enters warm window (400ms).
    hideTooltip(first)
    expect(state.visible).toBe(false)
    expect(first.getAttribute('aria-describedby')).toBe('existing-hint')

    // Within 400ms warm window, hovering second anchor shows immediately (0ms delay).
    vi.advanceTimersByTime(150)
    showTooltip(second, 'Share folder')
    vi.advanceTimersByTime(0)
    expect(state.visible).toBe(true)
    expect(state.text).toBe('Share folder')
    expect(second.getAttribute('aria-describedby')).toBe(TOOLTIP_ID)

    // Hide and wait past 400ms warm window -> next hover is cold again.
    hideTooltip()
    expect(second.hasAttribute('aria-describedby')).toBe(false)
    vi.advanceTimersByTime(400)

    showTooltip(second, 'Cold again')
    vi.advanceTimersByTime(200)
    expect(state.visible).toBe(false)
    vi.advanceTimersByTime(200)
    expect(state.visible).toBe(true)
  })

  it('skips duplicate aria-describedby when aria-label matches, describes focused child, and ignores disconnected anchors', () => {
    const matching = makeAnchor()
    matching.setAttribute('aria-label', 'Close')
    showTooltip(matching, 'Close', 0)
    vi.advanceTimersByTime(0)
    expect(matching.hasAttribute('aria-describedby')).toBe(false)
    hideTooltip()
    vi.advanceTimersByTime(500)

    // Focused input inside a container receives aria-describedby.
    const row = makeAnchor()
    const childInput = document.createElement('input')
    row.appendChild(childInput)
    childInput.focus()
    showTooltip(row, 'Filter value', 0)
    vi.advanceTimersByTime(0)
    expect(childInput.getAttribute('aria-describedby')).toBe(TOOLTIP_ID)
    hideTooltip()
    vi.advanceTimersByTime(500)

    // Disconnected anchor before timer fires never shows.
    const transient = makeAnchor()
    const { state } = useTooltip()
    showTooltip(transient, 'Gone soon', 100)
    transient.remove()
    vi.advanceTimersByTime(200)
    expect(state.visible).toBe(false)
  })

  it('supports updateTooltip, flashTooltip, grace period with holdTooltip, and target-scoped hideTooltip', () => {
    const anchor = makeAnchor()
    const other = makeAnchor()
    const { state } = useTooltip()

    // updateTooltip ignored while hidden.
    updateTooltip(anchor, 'Ignored')
    expect(state.visible).toBe(false)

    // flashTooltip shows immediately and auto-dismisses after duration.
    flashTooltip(anchor, 'Copied!', 600)
    expect(state.visible).toBe(true)
    expect(state.text).toBe('Copied!')

    // updateTooltip ignores other targets or empty text, updates active target.
    updateTooltip(other, 'Wrong target')
    updateTooltip(anchor, '')
    expect(state.text).toBe('Copied!')

    const prevRev = state.revision
    updateTooltip(anchor, { text: 'Copied SHA-256', detail: '64 hex chars' })
    expect(state.text).toBe('Copied SHA-256')
    expect(state.detail).toBe('64 hex chars')
    expect(state.revision).toBe(prevRev + 1)

    // hideTooltip for a different target does nothing.
    hideTooltip(other)
    expect(state.visible).toBe(true)

    // Auto-dismisses when flash duration elapses.
    vi.advanceTimersByTime(600)
    expect(state.visible).toBe(false)

    // Grace hide cancelled by holdTooltip keeps tooltip open until explicit hide.
    showTooltip(anchor, 'Hoverable', 0)
    vi.advanceTimersByTime(0)
    expect(state.visible).toBe(true)

    hideTooltip(anchor, HIDE_GRACE)
    vi.advanceTimersByTime(HIDE_GRACE - 10)
    holdTooltip()
    vi.advanceTimersByTime(500)
    expect(state.visible).toBe(true)

    // Unheld grace hide closes after grace ms.
    hideTooltip(anchor, HIDE_GRACE)
    vi.advanceTimersByTime(HIDE_GRACE)
    expect(state.visible).toBe(false)
  })

  it('dismisses on Escape, resize, and ancestor scroll while ignoring unrelated pane scroll, and detects touch/keyboard focus', () => {
    const paneA = document.createElement('div')
    const paneB = document.createElement('div')
    document.body.append(paneA, paneB)
    const anchor = makeAnchor()
    paneA.appendChild(anchor)

    const { state } = useTooltip()

    // 1. Escape dismisses; other keys do not.
    showTooltip(anchor, 'Shortcut target', 0)
    vi.advanceTimersByTime(0)
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }))
    expect(state.visible).toBe(true)
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(state.visible).toBe(false)

    // 2. Scrolling unrelated paneB keeps tooltip visible; scrolling ancestor paneA hides it.
    showTooltip(anchor, 'Scroll target', 0)
    vi.advanceTimersByTime(0)
    paneB.dispatchEvent(new Event('scroll'))
    expect(state.visible).toBe(true)
    paneA.dispatchEvent(new Event('scroll'))
    expect(state.visible).toBe(false)

    // 3. Window resize hides visible tooltip.
    showTooltip(anchor, 'Resize target', 0)
    vi.advanceTimersByTime(0)
    window.dispatchEvent(new Event('resize'))
    expect(state.visible).toBe(false)

    // 4. Touch and keyboard-focus helpers.
    expect(isTouch(new PointerEvent('pointerenter', { pointerType: 'touch' }))).toBe(true)
    expect(isTouch(new PointerEvent('pointerenter', { pointerType: 'mouse' }))).toBe(false)
    expect(isTouch(new Event('mouseenter'))).toBe(false)

    vi.spyOn(anchor, 'matches').mockImplementation((selector) => selector === ':focus-visible')
    const focusEvt = new FocusEvent('focus')
    Object.defineProperty(focusEvt, 'target', { value: anchor })
    expect(isKeyboardFocus(focusEvt)).toBe(true)
    expect(isKeyboardFocus(new FocusEvent('focus'))).toBe(false)
  })
})
