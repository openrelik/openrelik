import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useModalStore } from '@/stores/modals'

describe('stores/modals', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('manages the modal stack without duplicating already-open modals', () => {
    const store = useModalStore()

    expect(store.modalStack).toEqual([])
    expect(store.activeModal).toBeNull()
    expect(store.hasActiveModal).toBe(false)

    store.openModal('help')
    store.openModal('settings')
    store.openModal('help')

    expect(store.modalStack).toEqual(['help', 'settings'])
    expect(store.activeModal).toBe('settings')
    expect(store.hasActiveModal).toBe(true)
    expect(store.isModalOpen('help')).toBe(true)
    expect(store.isModalOpen('account')).toBe(false)

    store.closeModal('help')
    expect(store.modalStack).toEqual(['settings'])
    store.closeModal('account')
    expect(store.modalStack).toEqual(['settings'])

    store.toggleModal('share')
    expect(store.isModalOpen('share')).toBe(true)
    store.toggleModal('share')
    expect(store.isModalOpen('share')).toBe(false)

    expect(store.closeTopModal()).toBe('settings')
    expect(store.closeTopModal()).toBeNull()

    store.openModal('confirm')
    store.openModal('uploads')
    store.closeAllModals()
    expect(store.modalStack).toEqual([])
    expect(store.hasActiveModal).toBe(false)
  })

  it('triggers a registered prompt callback or falls back to opening the prompt modal', () => {
    const store = useModalStore()

    store.triggerPrompt()
    expect(store.isModalOpen('prompt')).toBe(true)
    store.closeAllModals()

    const focusFirst = vi.fn()
    const focusSecond = vi.fn()
    const unregisterFirst = store.registerPrompt(focusFirst)

    store.triggerPrompt()
    expect(focusFirst).toHaveBeenCalledTimes(1)
    expect(store.isModalOpen('prompt')).toBe(false)

    const unregisterSecond = store.registerPrompt(focusSecond)
    // Stale unregister from first prompt must not clobber the active second callback.
    unregisterFirst()
    store.triggerPrompt()
    expect(focusSecond).toHaveBeenCalledTimes(1)

    unregisterSecond()
    store.triggerPrompt()
    expect(store.isModalOpen('prompt')).toBe(true)
  })
})
