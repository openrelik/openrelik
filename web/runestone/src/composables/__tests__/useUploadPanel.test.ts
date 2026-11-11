import { createPinia, setActivePinia } from 'pinia'
import { computed, nextTick, ref } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const activeCount = ref(0)

vi.mock('@/composables/useUploadQueue', () => ({
  useUploadQueue: () => ({
    activeCount: computed(() => activeCount.value),
  }),
}))

import { useUploadPanel } from '@/composables/useUploadPanel'
import { useModalStore } from '@/stores/modals'

describe('useUploadPanel', () => {
  // Share one Pinia instance because useUploadPanel registers a singleton module watcher on first call.
  const pinia = createPinia()

  beforeEach(async () => {
    setActivePinia(pinia)
    activeCount.value = 0
    await nextTick()
    useModalStore().closeAllModals()
  })

  it('opens automatically when uploads start and closes when the queue empties', async () => {
    const panel = useUploadPanel()
    expect(panel.isOpen.value).toBe(false)

    activeCount.value = 1
    await nextTick()
    expect(panel.isOpen.value).toBe(true)

    // Adding more files while running keeps it open
    activeCount.value = 2
    await nextTick()
    expect(panel.isOpen.value).toBe(true)

    // Queue emptying closes the auto-opened panel
    activeCount.value = 0
    await nextTick()
    expect(panel.isOpen.value).toBe(false)
  })

  it('remembers minimize during a batch and resets once the queue empties', async () => {
    const panel = useUploadPanel()

    activeCount.value = 1
    await nextTick()
    expect(panel.isOpen.value).toBe(true)

    panel.minimize()
    expect(panel.isOpen.value).toBe(false)

    // Even if activeCount transitions 0 -> 1? No: while >0 it stays minimized; test 2 -> 1 -> 0 -> 1
    activeCount.value = 2
    await nextTick()
    expect(panel.isOpen.value).toBe(false)

    // Queue empties: resets minimized flag without closing a manual state
    activeCount.value = 0
    await nextTick()
    expect(panel.isOpen.value).toBe(false)

    // Next batch opens automatically again
    activeCount.value = 1
    await nextTick()
    expect(panel.isOpen.value).toBe(true)
  })

  it('supports manual open, toggle, and does not auto-close a manually opened empty panel', async () => {
    const panel = useUploadPanel()

    panel.open()
    expect(panel.isOpen.value).toBe(true)

    // Start and finish uploads after manual open (before was 0, panel was not minimized -> opened=true)
    panel.toggle()
    expect(panel.isOpen.value).toBe(false)

    // Toggle back open while idle, then start while minimized was cleared
    panel.toggle()
    expect(panel.isOpen.value).toBe(true)

    // Minimize before uploads even start (e.g. toggled closed) prevents auto-open until 0 reset
    panel.minimize()
    activeCount.value = 1
    await nextTick()
    expect(panel.isOpen.value).toBe(false)

    panel.open()
    expect(panel.isOpen.value).toBe(true)

    // Since opened was cleared by minimize() and then opened manually while count=1, finishing does not auto-close!
    activeCount.value = 0
    await nextTick()
    expect(panel.isOpen.value).toBe(true)
  })
})
