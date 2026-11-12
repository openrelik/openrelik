// @vitest-environment happy-dom
import { defineComponent, nextTick, ref } from 'vue'
import { mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { hideTooltip, useTooltip } from '@/composables/useTooltip'
import { vOverflowTooltip } from '@/directives/overflowTooltip'

const wrappers: VueWrapper[] = []

function track<T extends VueWrapper>(wrapper: T): T {
  wrappers.push(wrapper)
  return wrapper
}

function mockDimensions(
  el: HTMLElement,
  dims: {
    scrollWidth?: number
    clientWidth?: number
    scrollHeight?: number
    clientHeight?: number
  },
): void {
  if (dims.scrollWidth !== undefined) {
    Object.defineProperty(el, 'scrollWidth', { configurable: true, get: () => dims.scrollWidth })
  }
  if (dims.clientWidth !== undefined) {
    Object.defineProperty(el, 'clientWidth', { configurable: true, get: () => dims.clientWidth })
  }
  if (dims.scrollHeight !== undefined) {
    Object.defineProperty(el, 'scrollHeight', { configurable: true, get: () => dims.scrollHeight })
  }
  if (dims.clientHeight !== undefined) {
    Object.defineProperty(el, 'clientHeight', { configurable: true, get: () => dims.clientHeight })
  }
}

beforeEach(() => {
  vi.useFakeTimers()
  hideTooltip()
  vi.advanceTimersByTime(500)
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

describe('vOverflowTooltip', () => {
  it('stays hidden when the element fits within its bounds or pointer is touch', () => {
    const Comp = defineComponent({
      directives: { overflowTooltip: vOverflowTooltip },
      template: '<span v-overflow-tooltip data-testid="label">short.txt</span>',
    })

    const wrapper = track(mount(Comp, { attachTo: document.body }))
    const el = wrapper.get('[data-testid="label"]').element as HTMLElement
    const { state } = useTooltip()

    mockDimensions(el, { scrollWidth: 80, clientWidth: 80, scrollHeight: 20, clientHeight: 20 })
    el.dispatchEvent(new PointerEvent('pointerenter', { pointerType: 'mouse' }))
    vi.advanceTimersByTime(600)
    expect(state.visible).toBe(false)

    // Even when overflowing, touch pointerenter is ignored
    mockDimensions(el, { scrollWidth: 240, clientWidth: 80 })
    el.dispatchEvent(new PointerEvent('pointerenter', { pointerType: 'touch' }))
    vi.advanceTimersByTime(600)
    expect(state.visible).toBe(false)
  })

  it('reveals textContent after 500ms when overflowing horizontally and hides after grace period on leave', () => {
    const Comp = defineComponent({
      directives: { overflowTooltip: vOverflowTooltip },
      template:
        '<span v-overflow-tooltip data-testid="label">  very-long-artifact-filename.evtx  </span>',
    })

    const wrapper = track(mount(Comp, { attachTo: document.body }))
    const el = wrapper.get('[data-testid="label"]').element as HTMLElement
    const { state } = useTooltip()

    mockDimensions(el, { scrollWidth: 300, clientWidth: 100, scrollHeight: 20, clientHeight: 20 })

    el.dispatchEvent(new PointerEvent('pointerenter', { pointerType: 'mouse' }))
    vi.advanceTimersByTime(499)
    expect(state.visible).toBe(false)

    vi.advanceTimersByTime(1)
    expect(state.visible).toBe(true)
    expect(state.text).toBe('very-long-artifact-filename.evtx')

    el.dispatchEvent(new PointerEvent('pointerleave', { pointerType: 'mouse' }))
    vi.advanceTimersByTime(99)
    expect(state.visible).toBe(true)

    vi.advanceTimersByTime(1)
    expect(state.visible).toBe(false)
  })

  it('supports vertical overflow, updated custom binding values, keyboard focusin/focusout, and unmount cleanup', async () => {
    const custom = ref<string | undefined>('Initial custom label')
    const Comp = defineComponent({
      directives: { overflowTooltip: vOverflowTooltip },
      setup() {
        return { custom }
      },
      template: `
        <div>
          <span v-overflow-tooltip="custom" tabindex="0" data-testid="label">fallback</span>
          <span v-overflow-tooltip data-testid="blank">   </span>
        </div>
      `,
    })

    const wrapper = mount(Comp, { attachTo: document.body })
    const el = wrapper.get('[data-testid="label"]').element as HTMLElement
    const blank = wrapper.get('[data-testid="blank"]').element as HTMLElement
    const { state } = useTooltip()

    mockDimensions(el, { scrollWidth: 50, clientWidth: 50, scrollHeight: 60, clientHeight: 20 })
    mockDimensions(blank, { scrollWidth: 200, clientWidth: 50 })

    // Blank text with no custom binding shows nothing
    blank.dispatchEvent(new PointerEvent('pointerenter', { pointerType: 'mouse' }))
    vi.advanceTimersByTime(500)
    expect(state.visible).toBe(false)

    // Non-keyboard focusin (matches(':focus-visible') === false) shows nothing
    vi.spyOn(el, 'matches').mockReturnValue(false)
    el.dispatchEvent(new FocusEvent('focusin'))
    vi.advanceTimersByTime(0)
    expect(state.visible).toBe(false)

    // Update custom binding and reveal immediately on keyboard focusin
    custom.value = 'Updated custom label'
    await nextTick()

    vi.spyOn(el, 'matches').mockImplementation((sel) => sel === ':focus-visible')
    el.dispatchEvent(new FocusEvent('focusin'))
    vi.advanceTimersByTime(0)
    expect(state.visible).toBe(true)
    expect(state.text).toBe('Updated custom label')

    // Blur hides immediately
    el.dispatchEvent(new FocusEvent('focusout'))
    expect(state.visible).toBe(false)

    // Update custom binding while visible updates live tooltip, then shrinking hides it
    el.dispatchEvent(new FocusEvent('focusin'))
    vi.advanceTimersByTime(0)
    expect(state.visible).toBe(true)
    custom.value = 'Live updated overflow label'
    await nextTick()
    expect(state.text).toBe('Live updated overflow label')

    mockDimensions(el, { scrollWidth: 50, clientWidth: 50, scrollHeight: 20, clientHeight: 20 })
    custom.value = 'Fits now'
    await nextTick()
    expect(state.visible).toBe(false)
    mockDimensions(el, { scrollWidth: 50, clientWidth: 50, scrollHeight: 60, clientHeight: 20 })

    // Unmount hides active tooltip and removes listeners
    el.dispatchEvent(new FocusEvent('focusin'))
    vi.advanceTimersByTime(0)
    expect(state.visible).toBe(true)

    wrapper.unmount()
    expect(state.visible).toBe(false)

    el.dispatchEvent(new FocusEvent('focusin'))
    vi.advanceTimersByTime(0)
    expect(state.visible).toBe(false)
  })
})
