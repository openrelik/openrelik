// @vitest-environment happy-dom
import { defineComponent, nextTick, ref } from 'vue'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { hideTooltip, useTooltip } from '@/composables/useTooltip'
import { copyToClipboard, vCopyToClipboard, type CopyValue } from '@/directives/copyToClipboard'
import { vTooltip } from '@/directives/tooltip'

const wrappers: VueWrapper[] = []

function track<T extends VueWrapper>(wrapper: T): T {
  wrappers.push(wrapper)
  return wrapper
}

let writeTextMock: ReturnType<typeof vi.fn<(text: string) => Promise<void>>>

beforeEach(() => {
  vi.useFakeTimers()
  hideTooltip()
  vi.advanceTimersByTime(500)

  writeTextMock = vi.fn<(text: string) => Promise<void>>().mockResolvedValue(undefined)
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: writeTextMock },
  })
})

afterEach(() => {
  while (wrappers.length > 0) {
    wrappers.pop()?.unmount()
  }
  hideTooltip()
  vi.runOnlyPendingTimers()
  vi.useRealTimers()
  document.body.innerHTML = ''
})

describe('copyToClipboard', () => {
  it('returns false for empty text without touching the clipboard', async () => {
    expect(await copyToClipboard('')).toBe(false)
    expect(writeTextMock).not.toHaveBeenCalled()
  })

  it('uses navigator.clipboard.writeText when available', async () => {
    expect(await copyToClipboard('deadbeef')).toBe(true)
    expect(writeTextMock).toHaveBeenCalledWith('deadbeef')
  })

  it('falls back to document.execCommand when writeText rejects, and returns false if fallback throws', async () => {
    writeTextMock.mockRejectedValueOnce(new Error('NotAllowedError'))
    const execMock = vi.fn(() => true)
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: execMock,
    })

    expect(await copyToClipboard('fallback-hash')).toBe(true)
    expect(execMock).toHaveBeenCalledWith('copy')
    expect(document.querySelector('textarea')).toBeNull()

    writeTextMock.mockRejectedValueOnce(new Error('NotAllowedError'))
    execMock.mockImplementationOnce(() => {
      throw new Error('execCommand disabled')
    })

    expect(await copyToClipboard('broken')).toBe(false)
  })
})

describe('vCopyToClipboard', () => {
  it('adds role, tabindex, and cursor to non-interactive elements while preserving interactive ones', () => {
    const Comp = defineComponent({
      directives: { copy: vCopyToClipboard },
      template: `
        <div>
          <span v-copy="'abc'" data-testid="span">abc</span>
          <span v-copy="'custom'" tabindex="2" role="link" data-testid="preset">custom</span>
          <button v-copy="'btn'" data-testid="button">Copy</button>
        </div>
      `,
    })

    const wrapper = track(mount(Comp, { attachTo: document.body }))
    const span = wrapper.get('[data-testid="span"]').element as HTMLElement
    const preset = wrapper.get('[data-testid="preset"]').element as HTMLElement
    const button = wrapper.get('[data-testid="button"]').element as HTMLElement

    expect(span.getAttribute('tabindex')).toBe('0')
    expect(span.getAttribute('role')).toBe('button')
    expect(span.style.cursor).toBe('pointer')

    expect(preset.getAttribute('tabindex')).toBe('2')
    expect(preset.getAttribute('role')).toBe('link')

    expect(button.hasAttribute('tabindex')).toBe(false)
    expect(button.hasAttribute('role')).toBe(false)
    expect(button.style.cursor).toBe('pointer')
  })

  it('copies on click, flashes tooltip, sets temporary data-copied, and resets timer on rapid clicks', async () => {
    const parentClick = vi.fn()
    const Comp = defineComponent({
      directives: { copy: vCopyToClipboard },
      setup() {
        return { parentClick }
      },
      template: `
        <div @click="parentClick">
          <span v-copy="{ text: 'sha256:1234', hint: 'Copy digest' }" data-testid="target">1234</span>
        </div>
      `,
    })

    const wrapper = track(mount(Comp, { attachTo: document.body }))
    const el = wrapper.get('[data-testid="target"]').element as HTMLElement
    const { state } = useTooltip()

    // Hover before copying shows custom hint
    el.dispatchEvent(new PointerEvent('pointerenter', { pointerType: 'mouse' }))
    vi.advanceTimersByTime(400)
    expect(state.visible).toBe(true)
    expect(state.text).toBe('Copy digest')

    el.dispatchEvent(new PointerEvent('pointerleave', { pointerType: 'mouse' }))
    vi.advanceTimersByTime(100)
    expect(state.visible).toBe(false)

    // Click copies and stops propagation
    await wrapper.get('[data-testid="target"]').trigger('click')
    await Promise.resolve()

    expect(parentClick).not.toHaveBeenCalled()
    expect(writeTextMock).toHaveBeenCalledWith('sha256:1234')
    expect(el.getAttribute('data-copied')).toBe('true')
    expect(state.visible).toBe(true)
    expect(state.text).toBe('Copied!')

    // Hover/leave while data-copied is active does not clobber 'Copied!'
    el.dispatchEvent(new PointerEvent('pointerenter', { pointerType: 'mouse' }))
    el.dispatchEvent(new PointerEvent('pointerleave', { pointerType: 'mouse' }))
    expect(state.text).toBe('Copied!')

    // Second click resets the 1500ms timer
    vi.advanceTimersByTime(1000)
    await wrapper.get('[data-testid="target"]').trigger('click')
    await Promise.resolve()
    vi.advanceTimersByTime(1000)
    expect(el.getAttribute('data-copied')).toBe('true')

    vi.advanceTimersByTime(500)
    expect(el.hasAttribute('data-copied')).toBe(false)
  })

  it('supports Enter and Space keyboard activation, .silent modifier, textContent fallback, and updated values', async () => {
    const val = ref<CopyValue | undefined>(undefined)
    const Comp = defineComponent({
      directives: { copy: vCopyToClipboard },
      setup() {
        return { val }
      },
      template: `
        <div>
          <span v-copy.silent="val" data-testid="item">  /cases/42  </span>
          <span v-copy data-testid="empty">   </span>
        </div>
      `,
    })

    const wrapper = track(mount(Comp, { attachTo: document.body }))
    const el = wrapper.get('[data-testid="item"]').element as HTMLElement
    const { state } = useTooltip()

    // Empty element textContent -> no copy
    await wrapper.get('[data-testid="empty"]').trigger('click')
    await flushPromises()
    expect(writeTextMock).not.toHaveBeenCalled()

    // Unrelated key does nothing
    await wrapper.get('[data-testid="item"]').trigger('keydown', { key: 'a' })
    expect(writeTextMock).not.toHaveBeenCalled()

    // Enter copies trimmed textContent silently (no tooltip flash)
    const enterEvent = new KeyboardEvent('keydown', { key: 'Enter', cancelable: true })
    el.dispatchEvent(enterEvent)
    await flushPromises()

    expect(enterEvent.defaultPrevented).toBe(true)
    expect(writeTextMock).toHaveBeenLastCalledWith('/cases/42')
    expect(el.getAttribute('data-copied')).toBe('true')
    expect(state.visible).toBe(false)

    // Update binding value to number and activate via Space
    val.value = 9001
    await nextTick()

    const spaceEvent = new KeyboardEvent('keydown', { key: ' ', cancelable: true })
    el.dispatchEvent(spaceEvent)
    await flushPromises()

    expect(spaceEvent.defaultPrevented).toBe(true)
    expect(writeTextMock).toHaveBeenLastCalledWith('9001')

    // Update binding value to object without hint -> default 'Click to copy'
    val.value = { text: 'obj-val' }
    await nextTick()
    vi.advanceTimersByTime(1500)
    el.dispatchEvent(new PointerEvent('pointerenter', { pointerType: 'mouse' }))
    vi.advanceTimersByTime(400)
    expect(state.text).toBe('Click to copy')
  })

  it('defers hover tooltip management when v-tooltip is also present and cleans up timers on unmount', async () => {
    const Comp = defineComponent({
      directives: { tooltip: vTooltip, copy: vCopyToClipboard },
      template:
        '<button v-tooltip="\'Explicit label\'" v-copy="\'val\'" data-testid="both">Run</button>',
    })

    const wrapper = mount(Comp, { attachTo: document.body })
    const el = wrapper.get('[data-testid="both"]').element as HTMLElement
    const { state } = useTooltip()

    el.dispatchEvent(new PointerEvent('pointerenter', { pointerType: 'mouse' }))
    vi.advanceTimersByTime(400)
    expect(state.text).toBe('Explicit label')

    el.dispatchEvent(new PointerEvent('pointerleave', { pointerType: 'mouse' }))
    vi.advanceTimersByTime(100)

    // Trigger copy so _copyFeedbackTimer is active when unmounting
    await wrapper.get('[data-testid="both"]').trigger('click')
    await Promise.resolve()
    expect(el.getAttribute('data-copied')).toBe('true')

    wrapper.unmount()

    // Clicking detached element after unmount does not copy again
    writeTextMock.mockClear()
    el.dispatchEvent(new MouseEvent('click'))
    expect(writeTextMock).not.toHaveBeenCalled()
  })
})
