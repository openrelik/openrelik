// @vitest-environment happy-dom
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import Switch from '@/components/base/Switch.vue'
import { directives } from '@/directives'

describe('Switch', () => {
  it('reflects modelValue in aria-checked and styling, and toggles on click', async () => {
    const wrapper = mount(Switch, {
      props: {
        modelValue: false,
        'onUpdate:modelValue': (value: boolean) => {
          void wrapper.setProps({ modelValue: value })
        },
        label: 'Auto-refresh',
        tooltip: 'Poll every 10s',
      },
      global: { plugins: [directives] },
    })

    const button = wrapper.get('[role="switch"]')
    expect(button.attributes('aria-label')).toBe('Auto-refresh')
    expect(button.attributes('aria-checked')).toBe('false')
    expect(button.classes()).toContain('bg-sunken')

    await button.trigger('click')
    expect(wrapper.emitted('update:modelValue')?.[0]).toEqual([true])
    expect(button.attributes('aria-checked')).toBe('true')
    expect(button.classes()).toContain('bg-brand-tint')

    await button.trigger('click')
    expect(wrapper.emitted('update:modelValue')?.[1]).toEqual([false])
    expect(button.attributes('aria-checked')).toBe('false')

    wrapper.unmount()
  })
})
