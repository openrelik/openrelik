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
import { createPinia, setActivePinia } from 'pinia'
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import SettingsTrigger from '@/components/layout/SettingsTrigger.vue'
import { directives } from '@/directives'
import { useModalStore } from '@/stores/modals'

describe('SettingsTrigger', () => {
  it('opens the settings modal when clicked', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const modalStore = useModalStore()

    const wrapper = mount(SettingsTrigger, {
      global: { plugins: [pinia, directives] },
    })

    const button = wrapper.get('button[aria-label="Settings"]')
    expect(button.text()).toContain('settings')
    expect(modalStore.isModalOpen('settings')).toBe(false)

    await button.trigger('click')
    expect(modalStore.isModalOpen('settings')).toBe(true)

    wrapper.unmount()
  })
})
