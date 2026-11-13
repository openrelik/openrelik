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
import { nextTick } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'
import { createPinia, setActivePinia } from 'pinia'
import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { api } from '@/api'
import Prompt from '@/components/prompt/Prompt.vue'
import { clearQueryCache } from '@/composables/useQueryCache'
import { directives } from '@/directives'
import { useItemsStore } from '@/stores/items'
import { useModalStore } from '@/stores/modals'
import { useRootPagesStore } from '@/stores/rootPages'

function makeRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'home', component: { template: '<div />' } },
      { path: '/folder/:id', name: 'folder', component: { template: '<div />' } },
      { path: '/metrics', name: 'metrics', component: { template: '<div />' } },
    ],
  })
}

describe('Prompt', () => {
  let pinia: ReturnType<typeof createPinia>
  const wrappers: { unmount: () => void }[] = []

  beforeEach(() => {
    clearQueryCache()
    pinia = createPinia()
    setActivePinia(pinia)
    vi.spyOn(api.folders, 'getAllFolders').mockResolvedValue({
      folders: [],
      total_count: 0,
      page: 1,
      page_size: 50,
    })
  })

  afterEach(() => {
    while (wrappers.length > 0) {
      wrappers.pop()?.unmount()
    }
    vi.restoreAllMocks()
  })

  it('opens when prompt modal is activated, navigates on Enter, and closes on Escape or backdrop pointerdown', async () => {
    const router = makeRouter()
    await router.push('/metrics')
    await router.isReady()

    const itemsStore = useItemsStore()
    const rootPagesStore = useRootPagesStore()
    const modalStore = useModalStore()

    itemsStore.upsertItems([
      {
        id: 10,
        kind: 'folder',
        name: 'incident-10',
        parent: null,
        owner: 'analyst',
        modified: '2026-11-10T00:00:00Z',
      },
      {
        id: 20,
        kind: 'folder',
        name: 'incident-20',
        parent: null,
        owner: 'analyst',
        modified: '2026-11-10T00:00:00Z',
      },
    ])
    rootPagesStore.setRootPage('folders:root:s40:p1', {
      ids: [10, 20],
      total: 2,
      page: 1,
      size: 40,
    })

    const wrapper = mount(Prompt, {
      global: { plugins: [pinia, router, directives] },
    })
    wrappers.push(wrapper)

    expect(document.body.querySelector('[role="dialog"]')).toBeNull()

    // Open prompt modal.
    modalStore.openModal('prompt')
    await nextTick()

    const dialog = document.body.querySelector<HTMLElement>('[role="dialog"]')
    expect(dialog).not.toBeNull()
    const input = dialog!.querySelector<HTMLInputElement>('input')!
    expect(input.value).toBe('')

    // Hovering an option updates active descendant.
    const options = dialog!.querySelectorAll<HTMLElement>('[role="option"]')
    expect(options.length).toBe(2)
    options[1]!.dispatchEvent(new PointerEvent('pointermove', { bubbles: true }))
    await nextTick()
    expect(input.getAttribute('aria-activedescendant')).toBe('prompt-1')

    // ArrowUp moves back to index 0, Enter navigates to /folder/10 and closes modal.
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }))
    await nextTick()
    expect(input.getAttribute('aria-activedescendant')).toBe('prompt-0')

    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    await vi.waitFor(() => {
      expect(modalStore.isModalOpen('prompt')).toBe(false)
      expect(router.currentRoute.value.fullPath).toBe('/folder/10')
    })

    // Re-open -> Escape closes modal.
    modalStore.openModal('prompt')
    await nextTick()
    const reopenedInput = document.body.querySelector<HTMLInputElement>('[role="dialog"] input')!
    reopenedInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await nextTick()
    expect(modalStore.isModalOpen('prompt')).toBe(false)

    // Re-open -> backdrop pointerdown closes modal.
    modalStore.openModal('prompt')
    await nextTick()
    const backdrop = document.body.querySelector<HTMLElement>(
      '.fixed.inset-0 > div[aria-hidden="true"]',
    )!
    backdrop.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    await nextTick()
    expect(modalStore.isModalOpen('prompt')).toBe(false)
  })

  it('clears line on close to cancel pending server searches and omits aria-activedescendant when empty', async () => {
    vi.useFakeTimers()
    try {
      const router = makeRouter()
      await router.push('/metrics')
      await router.isReady()

      const modalStore = useModalStore()
      const wrapper = mount(Prompt, {
        global: { plugins: [pinia, router, directives] },
      })
      wrappers.push(wrapper)

      modalStore.openModal('prompt')
      await nextTick()
      const inputEl = document.body.querySelector<HTMLInputElement>('[role="dialog"] input')!
      inputEl.value = 'zzz-missing'
      inputEl.dispatchEvent(new Event('input', { bubbles: true }))
      await nextTick()

      expect(inputEl.getAttribute('aria-activedescendant')).toBeNull()

      // Closing before the 250ms debounce cancels the search so no server call fires.
      modalStore.closeModal('prompt')
      await nextTick()
      vi.advanceTimersByTime(300)
      await nextTick()
      expect(api.folders.getAllFolders).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })
})
