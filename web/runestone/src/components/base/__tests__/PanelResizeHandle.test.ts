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
    step: vi.fn(),
    reset: vi.fn(),
  }
}

describe('PanelResizeHandle', () => {
  it('renders vertical separator with label and forwards pointer, keyboard, and double-click gestures', async () => {
    const panel = makePanelMock()
    const wrapper = mount(PanelResizeHandle, {
      props: { panel, label: 'Resize inspector panel' },
      global: { plugins: [directives] },
    })

    const sep = wrapper.get('[role="separator"]')
    expect(sep.attributes('aria-orientation')).toBe('vertical')
    expect(sep.attributes('aria-label')).toBe('Resize inspector panel')
    expect(sep.attributes('aria-valuenow')).toBe('320')
    expect(sep.attributes('tabindex')).toBe('0')

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

    await sep.trigger('keydown', { key: 'ArrowLeft' })
    expect(panel.step).toHaveBeenLastCalledWith(16)

    await sep.trigger('keydown', { key: 'ArrowRight', shiftKey: true })
    expect(panel.step).toHaveBeenLastCalledWith(-48)

    await sep.trigger('keydown', { key: 'Home' })
    expect(panel.reset).toHaveBeenCalledTimes(2)

    wrapper.unmount()
  })
})
