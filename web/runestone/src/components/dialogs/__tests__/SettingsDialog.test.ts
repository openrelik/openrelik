// @vitest-environment happy-dom
import { nextTick } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'
import { createPinia, setActivePinia } from 'pinia'
import { DOMWrapper, mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import SettingsDialog from '@/components/dialogs/SettingsDialog.vue'
import directives from '@/directives'
import { openSettings, settingsOpen, useSettings } from '@/composables/useSettings'
import { useModalStore } from '@/stores/modals'

const pinia = createPinia()
setActivePinia(pinia)

let wrapper: VueWrapper | null = null

function resetPreferences(): void {
  const settings = useSettings()
  settings.value = {
    appearance: { theme: 'system' },
    ai: { enabled: true, summaries: true, chat: true, workflowNames: true },
    explorer: { pageSize: 40, showEmptyFiles: false },
  }
}

function mountDialog(): DOMWrapper<HTMLElement> {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/', component: { template: '<div />' } }],
  })
  wrapper = mount(SettingsDialog, {
    attachTo: document.body,
    global: {
      plugins: [pinia, directives, router],
    },
  })
  return new DOMWrapper(document.body)
}

beforeEach(() => {
  setActivePinia(pinia)
  localStorage.clear()
  useModalStore().closeAllModals()
  resetPreferences()
})

afterEach(() => {
  useModalStore().closeAllModals()
  wrapper?.unmount()
  wrapper = null
  document.body.innerHTML = ''
  localStorage.clear()
})

describe('SettingsDialog', () => {
  it('renders nothing while closed and shows appearance and explorer sections when open', async () => {
    const body = mountDialog()
    expect(body.find('[role="dialog"]').exists()).toBe(false)

    openSettings()
    await nextTick()

    const dialog = body.get('[role="dialog"]')
    expect(dialog.get('#settings-title').text()).toBe('settings')
    expect(dialog.text()).toContain('appearance.theme =')
    expect(dialog.text()).toContain('explorer.pageSize =')
    expect(dialog.text()).not.toContain('ai.enabled =')
  })

  it('switches theme between system, light, and dark and updates data-theme', async () => {
    const body = mountDialog()
    const settings = useSettings()
    openSettings()
    await nextTick()

    const themeGroup = body.get('[role="radiogroup"][aria-label="Theme"]')
    const radios = themeGroup.findAll('[role="radio"]')
    expect(radios).toHaveLength(3)

    await radios[2]!.trigger('click')
    expect(settings.value.appearance.theme).toBe('dark')
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
    expect(radios[2]!.attributes('aria-checked')).toBe('true')

    await radios[1]!.trigger('click')
    expect(settings.value.appearance.theme).toBe('light')
    expect(document.documentElement.getAttribute('data-theme')).toBe('light')
    expect(radios[1]!.attributes('aria-checked')).toBe('true')

    await radios[0]!.trigger('click')
    expect(settings.value.appearance.theme).toBe('system')
  })

  it('updates explorer page size and showEmptyFiles switch', async () => {
    const body = mountDialog()
    const settings = useSettings()
    openSettings()
    await nextTick()

    const sizeGroup = body.get('[role="radiogroup"][aria-label="Folders per page"]')
    const sizeButtons = sizeGroup.findAll('[role="radio"]')
    expect(sizeButtons.map((b) => b.text())).toEqual(['25', '40', '100'])

    await sizeButtons[0]!.trigger('click')
    expect(settings.value.explorer.pageSize).toBe(25)

    await sizeButtons[2]!.trigger('click')
    expect(settings.value.explorer.pageSize).toBe(100)

    expect(settings.value.explorer.showEmptyFiles).toBe(false)
    await body.get('button[role="switch"][aria-label="Show empty files"]').trigger('click')
    expect(settings.value.explorer.showEmptyFiles).toBe(true)
  })

  it('closes via close button and backdrop pointerdown', async () => {
    const body = mountDialog()
    openSettings()
    await nextTick()

    await body.get('button[aria-label="Close settings"]').trigger('click')
    expect(settingsOpen.value).toBe(false)
    expect(body.find('[role="dialog"]').exists()).toBe(false)

    openSettings()
    await nextTick()
    await body.get('[aria-hidden="true"]').trigger('pointerdown')
    expect(settingsOpen.value).toBe(false)
    expect(body.find('[role="dialog"]').exists()).toBe(false)
  })
})
