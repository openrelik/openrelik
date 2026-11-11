// @vitest-environment happy-dom
import { defineComponent } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useKeyboardShortcuts } from '@/composables/useKeyboardShortcuts'
import { useModalStore } from '@/stores/modals'

const ShortcutHarness = defineComponent({
  setup() {
    useKeyboardShortcuts()
    return () => null
  },
})

function press(target: EventTarget, key: string, init: KeyboardEventInit = {}): KeyboardEvent {
  const event = new KeyboardEvent('keydown', {
    key,
    bubbles: true,
    cancelable: true,
    ...init,
  })
  target.dispatchEvent(event)
  return event
}

describe('composables/useKeyboardShortcuts', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('opens help on ?, triggers prompt on g and Cmd/Ctrl+K, and opens settings on Cmd/Ctrl+,', () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const modalStore = useModalStore()
    const wrapper = mount(ShortcutHarness, { global: { plugins: [pinia] } })

    const helpEvent = press(window, '?')
    expect(helpEvent.defaultPrevented).toBe(true)
    expect(modalStore.isModalOpen('help')).toBe(true)

    // While a modal is open, Escape closes the topmost modal and other shortcuts are suppressed.
    modalStore.openModal('settings')
    press(window, 'g')
    expect(modalStore.isModalOpen('prompt')).toBe(false)

    const escTop = press(window, 'Escape')
    expect(escTop.defaultPrevented).toBe(true)
    expect(modalStore.isModalOpen('settings')).toBe(false)
    expect(modalStore.isModalOpen('help')).toBe(true)

    press(window, 'Escape')
    expect(modalStore.hasActiveModal).toBe(false)

    // 'g' opens prompt (or calls registered prompt focus callback).
    const focusCallback = vi.fn()
    const unregister = modalStore.registerPrompt(focusCallback)
    const gEvent = press(window, 'g')
    expect(gEvent.defaultPrevented).toBe(true)
    expect(focusCallback).toHaveBeenCalledTimes(1)
    unregister()

    // Cmd+K and Ctrl+K trigger prompt modal when no focus callback is registered.
    const cmdK = press(window, 'K', { metaKey: true })
    expect(cmdK.defaultPrevented).toBe(true)
    expect(modalStore.isModalOpen('prompt')).toBe(true)
    modalStore.closeAllModals()

    const ctrlK = press(window, 'k', { ctrlKey: true })
    expect(ctrlK.defaultPrevented).toBe(true)
    expect(modalStore.isModalOpen('prompt')).toBe(true)
    modalStore.closeAllModals()

    // Cmd+, and Ctrl+, open settings.
    const cmdComma = press(window, ',', { metaKey: true })
    expect(cmdComma.defaultPrevented).toBe(true)
    expect(modalStore.isModalOpen('settings')).toBe(true)
    modalStore.closeAllModals()

    // Alt-modified keys and unrelated keys are ignored.
    expect(press(window, '?', { altKey: true }).defaultPrevented).toBe(false)
    expect(press(window, 'g', { altKey: true }).defaultPrevented).toBe(false)
    expect(press(window, '/').defaultPrevented).toBe(false)
    expect(modalStore.hasActiveModal).toBe(false)

    wrapper.unmount()
  })

  it('suppresses single-key shortcuts while typing in inputs, textareas, or contentEditable, and cleans up on unmount', () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const modalStore = useModalStore()
    const wrapper = mount(ShortcutHarness, { global: { plugins: [pinia] } })

    const input = document.createElement('input')
    input.type = 'text'
    const textarea = document.createElement('textarea')
    const checkbox = document.createElement('input')
    checkbox.type = 'checkbox'
    document.body.append(input, textarea, checkbox)

    try {
      // Typing in text input or textarea ignores '?' and 'g'.
      press(input, '?')
      press(textarea, 'g')
      expect(modalStore.hasActiveModal).toBe(false)

      // Cmd+, still works from inside an input.
      press(input, ',', { ctrlKey: true })
      expect(modalStore.isModalOpen('settings')).toBe(true)
      modalStore.closeAllModals()

      // Checkbox is not text typing: '?' opens help.
      press(checkbox, '?')
      expect(modalStore.isModalOpen('help')).toBe(true)
      modalStore.closeAllModals()

      // After unmount, window listener is removed.
      wrapper.unmount()
      press(window, '?')
      press(window, 'g')
      expect(modalStore.hasActiveModal).toBe(false)
    } finally {
      input.remove()
      textarea.remove()
      checkbox.remove()
    }
  })
})
