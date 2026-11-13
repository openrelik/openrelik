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
