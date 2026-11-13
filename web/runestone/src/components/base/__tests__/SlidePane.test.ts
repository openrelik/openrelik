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
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import SlidePane from '@/components/base/SlidePane.vue'

describe('SlidePane', () => {
  it.each([
    ['top', true, 'grid-template-rows: 1fr', ['flex-col', 'justify-end']],
    ['bottom', false, 'grid-template-rows: 0fr', ['flex-col', 'justify-start']],
    ['left', true, 'grid-template-columns: 1fr', ['justify-end']],
    ['right', false, 'grid-template-columns: 0fr', ['justify-start']],
  ] as const)(
    'configures grid track and cling alignment for edge=%s open=%s',
    (edge, open, expectedStyle, expectedCling) => {
      const wrapper = mount(SlidePane, {
        props: { edge, open },
        slots: { default: '<div data-pane-body>Pane body</div>' },
      })

      expect(wrapper.attributes('style')).toContain(expectedStyle)
      if (open) {
        expect(wrapper.classes()).not.toContain('invisible')
        expect(wrapper.attributes('inert')).toBeUndefined()
      } else {
        expect(wrapper.classes()).toContain('invisible')
        expect(wrapper.attributes('inert')).toBeDefined()
      }

      const inner = wrapper.element.firstElementChild as HTMLElement
      for (const cls of expectedCling) {
        expect(inner.classList.contains(cls)).toBe(true)
      }
      // Slot stays mounted even when closed so state survives.
      expect(wrapper.get('[data-pane-body]').text()).toBe('Pane body')

      wrapper.unmount()
    },
  )
})
