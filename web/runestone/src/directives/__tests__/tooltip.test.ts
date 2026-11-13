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
import { defineComponent, nextTick, ref } from 'vue'
import { mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { hideTooltip, useTooltip, type TooltipInput } from '@/composables/useTooltip'
import { vTooltip } from '@/directives/tooltip'

const wrappers: VueWrapper[] = []

function track<T extends VueWrapper>(wrapper: T): T {
  wrappers.push(wrapper)
  return wrapper
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

describe('vTooltip', () => {
  it('shows on mouse hover, ignores touch hover, and dismisses on leave or click', () => {
    const Comp = defineComponent({
      directives: { tooltip: vTooltip },
      template:
        '<button v-tooltip="{ text: \'Run workflow\', detail: \'Starts tasks\' }" data-testid="btn">Run</button>',
    })

    const wrapper = track(mount(Comp, { attachTo: document.body }))
    const el = wrapper.get('[data-testid="btn"]').element as HTMLElement
    const { state } = useTooltip()

    // Touch tap does not open tooltip
    el.dispatchEvent(new PointerEvent('pointerenter', { pointerType: 'touch' }))
    vi.advanceTimersByTime(500)
    expect(state.visible).toBe(false)

    // Mouse hover opens after 400ms cold delay
    el.dispatchEvent(new PointerEvent('pointerenter', { pointerType: 'mouse' }))
    vi.advanceTimersByTime(399)
    expect(state.visible).toBe(false)

    vi.advanceTimersByTime(1)
    expect(state.visible).toBe(true)
    expect(state.text).toBe('Run workflow')
    expect(state.detail).toBe('Starts tasks')

    // Click dismisses immediately
    el.dispatchEvent(new MouseEvent('click'))
    expect(state.visible).toBe(false)

    // Re-enter while warm shows at once, pointerleave hides after 100ms grace
    el.dispatchEvent(new PointerEvent('pointerenter', { pointerType: 'mouse' }))
    vi.advanceTimersByTime(0)
    expect(state.visible).toBe(true)

    el.dispatchEvent(new PointerEvent('pointerleave', { pointerType: 'mouse' }))
    vi.advanceTimersByTime(99)
    expect(state.visible).toBe(true)
    vi.advanceTimersByTime(1)
    expect(state.visible).toBe(false)
  })

  it('shows immediately on keyboard focusin, ignores mouse focusin, and hides on focusout', () => {
    const Comp = defineComponent({
      directives: { tooltip: vTooltip },
      template: '<button v-tooltip="\'Settings\'" data-testid="btn">Gear</button>',
    })

    const wrapper = track(mount(Comp, { attachTo: document.body }))
    const el = wrapper.get('[data-testid="btn"]').element as HTMLElement
    const { state } = useTooltip()

    vi.spyOn(el, 'matches').mockReturnValue(false)
    el.dispatchEvent(new FocusEvent('focusin'))
    vi.advanceTimersByTime(0)
    expect(state.visible).toBe(false)

    vi.spyOn(el, 'matches').mockImplementation((sel) => sel === ':focus-visible')
    el.dispatchEvent(new FocusEvent('focusin'))
    vi.advanceTimersByTime(0)
    expect(state.visible).toBe(true)
    expect(state.text).toBe('Settings')

    el.dispatchEvent(new FocusEvent('focusout'))
    expect(state.visible).toBe(false)
  })

  it('updates live tooltip text only when content changes, hides when cleared, and cleans up on unmount', async () => {
    const tip = ref<TooltipInput | undefined>(undefined)
    const tick = ref(0)

    const Comp = defineComponent({
      directives: { tooltip: vTooltip },
      setup() {
        return { tip, tick }
      },
      template: '<button v-tooltip="tip" :data-tick="tick" data-testid="btn">Status</button>',
    })

    const wrapper = mount(Comp, { attachTo: document.body })
    const el = wrapper.get('[data-testid="btn"]').element as HTMLElement
    const { state } = useTooltip()

    // Empty binding -> hover does nothing
    el.dispatchEvent(new PointerEvent('pointerenter', { pointerType: 'mouse' }))
    vi.advanceTimersByTime(500)
    expect(state.visible).toBe(false)

    // Update from undefined -> object, then show via keyboard focus
    tip.value = { text: 'Uploading', detail: '10%' }
    await nextTick()

    vi.spyOn(el, 'matches').mockImplementation((sel) => sel === ':focus-visible')
    el.dispatchEvent(new FocusEvent('focusin'))
    vi.advanceTimersByTime(0)
    expect(state.visible).toBe(true)
    expect(state.text).toBe('Uploading')
    expect(state.detail).toBe('10%')

    const revBefore = state.revision

    // Re-render with identical text + detail in a fresh object -> no revision bump
    tip.value = { text: 'Uploading', detail: '10%' }
    tick.value++
    await nextTick()
    expect(state.revision).toBe(revBefore)

    // Change detail -> updates live tooltip and bumps revision
    tip.value = { text: 'Uploading', detail: '65%' }
    await nextTick()
    expect(state.detail).toBe('65%')
    expect(state.revision).toBe(revBefore + 1)

    // Change placement -> updates live preferred placement
    tip.value = { text: 'Uploading', detail: '65%', placement: 'right' }
    await nextTick()
    expect(state.preferred).toBe('right')
    expect(state.revision).toBe(revBefore + 2)

    // Clearing binding value hides the tooltip
    tip.value = undefined
    await nextTick()
    expect(state.visible).toBe(false)

    // Show again and verify unmount hides and removes listeners
    tip.value = 'Done'
    await nextTick()
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
