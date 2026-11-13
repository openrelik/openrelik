import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'

import { helpOpen, useHelp } from '@/composables/useHelp'
import { useModalStore } from '@/stores/modals'

describe('composables/useHelp', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('controls the help modal via open, close, composable helpOpen, and module helpOpen', () => {
    const modalStore = useModalStore()
    const help = useHelp()

    expect(help.helpOpen.value).toBe(false)
    expect(helpOpen.value).toBe(false)

    help.open()
    expect(modalStore.isModalOpen('help')).toBe(true)
    expect(help.helpOpen.value).toBe(true)
    expect(helpOpen.value).toBe(true)

    help.close()
    expect(modalStore.isModalOpen('help')).toBe(false)
    expect(help.helpOpen.value).toBe(false)

    help.helpOpen.value = true
    expect(modalStore.isModalOpen('help')).toBe(true)
    help.helpOpen.value = false
    expect(modalStore.isModalOpen('help')).toBe(false)

    helpOpen.value = true
    expect(modalStore.isModalOpen('help')).toBe(true)
    helpOpen.value = false
    expect(modalStore.isModalOpen('help')).toBe(false)
  })
})
