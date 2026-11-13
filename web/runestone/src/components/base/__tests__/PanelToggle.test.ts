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
