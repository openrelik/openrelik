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
