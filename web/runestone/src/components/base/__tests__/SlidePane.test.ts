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
