// @vitest-environment happy-dom
import { nextTick } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'

import { closeSettings, openSettings, settingsOpen, useSettings } from '@/composables/useSettings'
import { useModalStore } from '@/stores/modals'
import { useSettingsStore } from '@/stores/settings'

describe('composables/useSettings', () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
  })

  it('toggles settingsOpen, openSettings, and closeSettings against the modal store', () => {
    const modalStore = useModalStore()
    expect(settingsOpen.value).toBe(false)

    openSettings()
    expect(settingsOpen.value).toBe(true)
    expect(modalStore.isModalOpen('settings')).toBe(true)

    closeSettings()
    expect(settingsOpen.value).toBe(false)
    expect(modalStore.isModalOpen('settings')).toBe(false)

    settingsOpen.value = true
    expect(modalStore.isModalOpen('settings')).toBe(true)
    settingsOpen.value = false
    expect(modalStore.isModalOpen('settings')).toBe(false)
  })

  it('returns a reactive ref synchronized with the settings store and localStorage', async () => {
    const settings = useSettings()
    const store = useSettingsStore()

    expect(settings.value.explorer.pageSize).toBe(40)
    settings.value.appearance.theme = 'dark'
    settings.value.explorer.showEmptyFiles = true
    await nextTick()

    expect(store.settings.appearance.theme).toBe('dark')
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
    expect(JSON.parse(localStorage.getItem('openrelik.settings')!).explorer.showEmptyFiles).toBe(
      true,
    )
  })
})
