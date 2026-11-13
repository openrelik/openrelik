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
import { defineComponent, nextTick } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'
import { createPinia, setActivePinia } from 'pinia'
import { DOMWrapper, mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import HelpDialog from '@/components/dialogs/HelpDialog.vue'
import directives from '@/directives'
import { helpOpen, useHelp } from '@/composables/useHelp'
import { useKeyboardShortcuts } from '@/composables/useKeyboardShortcuts'
import { useModalStore } from '@/stores/modals'

const pinia = createPinia()
setActivePinia(pinia)

let wrapper: VueWrapper | null = null

function mountDialog(): DOMWrapper<HTMLElement> {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/', component: { template: '<div />' } }],
  })
  wrapper = mount(HelpDialog, {
    attachTo: document.body,
    global: {
      plugins: [pinia, directives, router],
    },
  })
  return new DOMWrapper(document.body)
}

beforeEach(() => {
  setActivePinia(pinia)
  useModalStore().closeAllModals()
})

afterEach(() => {
  useModalStore().closeAllModals()
  wrapper?.unmount()
  wrapper = null
  document.body.innerHTML = ''
})

describe('HelpDialog', () => {
  it('renders nothing while closed and opens with all keyboard shortcut groups', async () => {
    const body = mountDialog()
    expect(body.find('[role="dialog"]').exists()).toBe(false)

    const { open } = useHelp()
    open()
    await nextTick()

    const dialog = body.get('[role="dialog"]')
    expect(dialog.get('#help-title').text()).toBe('keyboard shortcuts')
    expect(dialog.text()).toContain('anywhere')
    expect(dialog.text()).toContain('prompt')
    expect(dialog.text()).toContain('listing')
    expect(dialog.text()).toContain('file')
    expect(dialog.text()).toContain('table view')
    expect(dialog.text()).toContain('text view')
    expect(dialog.text()).toContain('rendered markdown')
    expect(dialog.text()).toContain('hex view')
    expect(dialog.text()).toContain('full-screen flowchart')
    expect(dialog.text()).toContain('⌘ is Ctrl on Windows and Linux')
    expect(dialog.findAll('kbd').length).toBeGreaterThan(20)
  })

  it('closes when clicking the close button or backdrop', async () => {
    const body = mountDialog()
    helpOpen.value = true
    await nextTick()

    await body.get('button[aria-label="Close help"]').trigger('click')
    expect(helpOpen.value).toBe(false)
    expect(body.find('[role="dialog"]').exists()).toBe(false)

    helpOpen.value = true
    await nextTick()
    expect(body.find('[role="dialog"]').exists()).toBe(true)

    await body.get('[aria-hidden="true"]').trigger('pointerdown')
    expect(helpOpen.value).toBe(false)
    expect(body.find('[role="dialog"]').exists()).toBe(false)
  })

  it('closes when pressing ? on window while open and ignores unrelated keys', async () => {
    const body = mountDialog()

    // Pressing ? while closed leaves it closed
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '?', cancelable: true }))
    await nextTick()
    expect(helpOpen.value).toBe(false)

    helpOpen.value = true
    await nextTick()
    expect(body.find('[role="dialog"]').exists()).toBe(true)

    // Unrelated key does not close
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', cancelable: true }))
    await nextTick()
    expect(helpOpen.value).toBe(true)

    // ? closes and prevents default
    const event = new KeyboardEvent('keydown', { key: '?', cancelable: true })
    window.dispatchEvent(event)
    await nextTick()
    expect(event.defaultPrevented).toBe(true)
    expect(helpOpen.value).toBe(false)
    expect(body.find('[role="dialog"]').exists()).toBe(false)
  })

  it('closes cleanly with ? when paired with useKeyboardShortcuts and ignores ? when another modal is on top', async () => {
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: '/', component: { template: '<div />' } }],
    })
    // Mount HelpDialog inside a parent running useKeyboardShortcuts (same listener order as App.vue).
    const AppShell = defineComponent({
      components: { HelpDialog },
      setup() {
        useKeyboardShortcuts()
        return {}
      },
      template: '<HelpDialog />',
    })
    wrapper = mount(AppShell, {
      attachTo: document.body,
      global: { plugins: [pinia, directives, router] },
    })

    const modalStore = useModalStore()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '?', cancelable: true }))
    await nextTick()
    expect(modalStore.isModalOpen('help')).toBe(true)

    // With another modal stacked on top, ? must not close HelpDialog underneath.
    modalStore.openModal('settings')
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '?', cancelable: true }))
    await nextTick()
    expect(modalStore.isModalOpen('help')).toBe(true)
    modalStore.closeModal('settings')

    // Now HelpDialog is topmost again; ? closes it without useKeyboardShortcuts re-opening it.
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '?', cancelable: true }))
    await nextTick()
    expect(modalStore.isModalOpen('help')).toBe(false)
    expect(document.body.querySelector('[role="dialog"]')).toBeNull()
  })
})
