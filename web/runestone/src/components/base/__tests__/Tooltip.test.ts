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
import { nextTick } from 'vue'
import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import Tooltip from '@/components/base/Tooltip.vue'
import { HIDE_GRACE, hideTooltip, showTooltip, TOOLTIP_ID } from '@/composables/useTooltip'

describe('Tooltip', () => {
  let anchor: HTMLButtonElement

  beforeEach(() => {
    vi.useFakeTimers()
    hideTooltip()
    anchor = document.createElement('button')
    document.body.appendChild(anchor)
    vi.spyOn(anchor, 'getBoundingClientRect').mockReturnValue(new DOMRect(100, 100, 80, 24))
  })

  afterEach(() => {
    hideTooltip()
    anchor.remove()
    vi.useRealTimers()
  })

  it('renders nothing while hidden, then measures, places, and formats breakable text with detail', async () => {
    const wrapper = mount(Tooltip)
    expect(wrapper.find(`#${TOOLTIP_ID}`).exists()).toBe(false)

    showTooltip(
      anchor,
      { text: '/cases/2026/disk_image.raw', detail: 'Click to open', placement: 'bottom' },
      0,
    )
    vi.advanceTimersByTime(0)
    await nextTick()
    await nextTick()

    const tip = wrapper.get('[role="tooltip"]')
    expect(tip.attributes('id')).toBe(TOOLTIP_ID)
    expect(tip.classes()).not.toContain('invisible')
    expect(tip.text()).toContain('/cases/2026/disk_image.raw')
    expect(tip.text()).toContain('Click to open')
    expect(tip.findAll('wbr').length).toBeGreaterThan(0)

    wrapper.unmount()
  })

  it('holds the tooltip open on pointerenter and dismisses after HIDE_GRACE on pointerleave', async () => {
    const wrapper = mount(Tooltip)

    showTooltip(anchor, 'Quick label', 0)
    vi.advanceTimersByTime(0)
    await nextTick()
    await nextTick()

    const tip = wrapper.get('[role="tooltip"]')
    expect(tip.findAll('span')).toHaveLength(1)

    // Start grace hide from anchor, then move pointer onto tooltip to hold it open.
    hideTooltip(anchor, HIDE_GRACE)
    await tip.trigger('pointerenter')
    vi.advanceTimersByTime(HIDE_GRACE + 50)
    await nextTick()
    expect(wrapper.find('[role="tooltip"]').exists()).toBe(true)

    // Leaving tooltip hides after HIDE_GRACE.
    await tip.trigger('pointerleave')
    vi.advanceTimersByTime(HIDE_GRACE - 1)
    await nextTick()
    expect(wrapper.find('[role="tooltip"]').exists()).toBe(true)

    vi.advanceTimersByTime(1)
    await nextTick()
    expect(wrapper.find('[role="tooltip"]').exists()).toBe(false)

    wrapper.unmount()
  })
})
