// @vitest-environment happy-dom
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import PanelToggle from '@/components/base/PanelToggle.vue'
import { directives } from '@/directives'

describe('PanelToggle', () => {
  it('labels button to hide when open and emits toggle on click', async () => {
    const wrapper = mount(PanelToggle, {
      props: { open: true, name: 'workflow' },
      global: { plugins: [directives] },
    })

    const button = wrapper.get('button')
    expect(button.attributes('aria-label')).toBe('Hide workflow')

    await button.trigger('click')
    expect(wrapper.emitted('toggle')).toHaveLength(1)

    wrapper.unmount()
  })

  it('labels button to show when closed and updates reactively', async () => {
    const wrapper = mount(PanelToggle, {
      props: { open: false, name: 'details' },
      global: { plugins: [directives] },
    })

    const button = wrapper.get('button')
    expect(button.attributes('aria-label')).toBe('Show details')

    await wrapper.setProps({ open: true })
    expect(button.attributes('aria-label')).toBe('Hide details')

    wrapper.unmount()
  })
})
