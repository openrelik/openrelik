// @vitest-environment happy-dom
import { computed } from 'vue'
import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'

import PanelResizeHandle from '@/components/base/PanelResizeHandle.vue'
import type { PanelWidth } from '@/composables/usePanelWidth'
import { directives } from '@/directives'

function makePanelMock(): PanelWidth {
  return {
    width: computed(() => 320),
    start: vi.fn(),
    move: vi.fn(),
    end: vi.fn(),
    reset: vi.fn(),
  }
}

describe('PanelResizeHandle', () => {
  it('renders vertical separator with label and forwards pointer and double-click gestures', async () => {
    const panel = makePanelMock()
    const wrapper = mount(PanelResizeHandle, {
      props: { panel, label: 'Resize inspector panel' },
      global: { plugins: [directives] },
    })

    const sep = wrapper.get('[role="separator"]')
    expect(sep.attributes('aria-orientation')).toBe('vertical')
    expect(sep.attributes('aria-label')).toBe('Resize inspector panel')

    await sep.trigger('pointerdown', { clientX: 500, pointerId: 1 })
    expect(panel.start).toHaveBeenCalledTimes(1)

    await sep.trigger('pointermove', { clientX: 460 })
    expect(panel.move).toHaveBeenCalledTimes(1)

    await sep.trigger('pointerup')
    expect(panel.end).toHaveBeenCalledTimes(1)

    await sep.trigger('pointercancel')
    expect(panel.end).toHaveBeenCalledTimes(2)

    await sep.trigger('dblclick')
    expect(panel.reset).toHaveBeenCalledTimes(1)

    wrapper.unmount()
  })
})
