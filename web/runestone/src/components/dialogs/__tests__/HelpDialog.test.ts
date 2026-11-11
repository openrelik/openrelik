// @vitest-environment happy-dom
import { nextTick } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'
import { createPinia, setActivePinia } from 'pinia'
import { DOMWrapper, mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import HelpDialog from '@/components/dialogs/HelpDialog.vue'
import directives from '@/directives'
import { helpOpen, useHelp } from '@/composables/useHelp'
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
})
