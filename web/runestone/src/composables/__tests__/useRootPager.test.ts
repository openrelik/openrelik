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
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { defineComponent, h, nextTick, ref } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const connectionStatus = ref<'online' | 'offline' | 'unreachable'>('online')

vi.mock('@/composables/useConnection', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/composables/useConnection')>()
  return {
    ...actual,
    useConnection: () => ({ status: connectionStatus }),
  }
})

vi.mock('@/composables/useFolderLoader', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/composables/useFolderLoader')>()
  return {
    ...actual,
    prefetchRootPage: vi.fn().mockResolvedValue(undefined),
  }
})

import { folderKeys, prefetchRootPage } from '@/composables/useFolderLoader'
import { clearQueryCache, markFresh } from '@/composables/useQueryCache'
import { useRootPager, type UseRootPagerReturn } from '@/composables/useRootPager'
import { useRootPagesStore } from '@/stores/rootPages'
import { useSettingsStore } from '@/stores/settings'

function setNavigatorConnection(value: { saveData?: boolean; effectiveType?: string } | undefined) {
  Object.defineProperty(globalThis.navigator, 'connection', {
    value,
    configurable: true,
  })
}

async function mountPager(initialUrl = '/', isActive = ref(true)) {
  const pinia = createPinia()
  setActivePinia(pinia)
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/', component: defineComponent({ render: () => h('div') }) }],
  })
  await router.push(initialUrl)
  await router.isReady()

  let pager!: UseRootPagerReturn
  const Host = defineComponent({
    setup() {
      pager = useRootPager(() => isActive.value)
      return () => h('div')
    },
  })

  const wrapper = mount(Host, {
    global: { plugins: [pinia, router] },
  })

  return { wrapper, router, pager }
}

describe('useRootPager', () => {
  beforeEach(() => {
    clearQueryCache()
    connectionStatus.value = 'online'
    setNavigatorConnection(undefined)
    localStorage.clear()
  })

  afterEach(() => {
    setNavigatorConnection(undefined)
  })

  it('parses URL page query variants and computes bounds and navigation helpers', async () => {
    const { wrapper, router, pager } = await mountPager('/?page=invalid&keep=1')
    expect(pager.page.value).toBe(1)
    expect(pager.size.value).toBe(40)
    expect(pager.total.value).toBeNull()
    expect(pager.from.value).toBe(0)
    expect(pager.to.value).toBe(0)
    expect(pager.hasPrev.value).toBe(false)
    expect(pager.hasNext.value).toBe(false)

    // Array query param uses first value
    await router.replace({ query: { page: ['2', '3'] } })
    expect(pager.page.value).toBe(2)

    // Seed total=95 on page 2 (size 40 -> 3 pages total)
    useRootPagesStore().setRootPage(folderKeys.rootPage(2, 40), {
      ids: [1, 2],
      total: 95,
      page: 2,
      size: 40,
    })
    await nextTick()

    expect(pager.total.value).toBe(95)
    expect(pager.lastPage.value).toBe(3)
    expect(pager.from.value).toBe(41)
    expect(pager.to.value).toBe(80)
    expect(pager.hasPrev.value).toBe(true)
    expect(pager.hasNext.value).toBe(true)

    // Navigating to unloaded page 3 keeps lastTotal=95 so pager does not blank out
    pager.next()
    await router.isReady()
    await nextTick()
    await new Promise((r) => setTimeout(r, 0))
    expect(pager.page.value).toBe(3)
    expect(pager.total.value).toBe(95)
    expect(pager.to.value).toBe(95)
    expect(pager.hasNext.value).toBe(false)

    // Navigating back to page 1 strips ?page from query
    await pager.goTo(3) // same page no-op
    pager.prev()
    await new Promise((r) => setTimeout(r, 0))
    expect(pager.page.value).toBe(2)

    await pager.goTo(1)
    expect(router.currentRoute.value.query.page).toBeUndefined()

    wrapper.unmount()
  })

  it('clamps pages past the end once loaded and recalculates page when pageSize changes', async () => {
    const active = ref(true)
    const { wrapper, pager } = await mountPager('/?page=5', active)

    const page5Key = folderKeys.rootPage(5, 40)
    useRootPagesStore().setRootPage(page5Key, {
      ids: [],
      total: 50,
      page: 5,
      size: 40,
    })
    markFresh(page5Key)
    await nextTick()
    await new Promise((r) => setTimeout(r, 0))

    // 50 items at size 40 -> lastPage is 2
    expect(pager.page.value).toBe(2)

    // Changing pageSize from 40 to 25 on page 2 (first item index 40 -> floor(40/25)+1 = 2, test page 3 -> index 80 -> floor(80/25)+1 = 4)
    useRootPagesStore().setRootPage(folderKeys.rootPage(2, 40), {
      ids: [1],
      total: 120,
      page: 2,
      size: 40,
    })
    await pager.goTo(3)
    useSettingsStore().settings.explorer.pageSize = 25
    await nextTick()
    await new Promise((r) => setTimeout(r, 0))
    expect(pager.page.value).toBe(4)

    // Inactive pager ignores size changes
    active.value = false
    useSettingsStore().settings.explorer.pageSize = 100
    await nextTick()
    await new Promise((r) => setTimeout(r, 0))
    expect(pager.page.value).toBe(4)

    wrapper.unmount()
  })

  it('prefetches the next page in the background when online and unconstrained', async () => {
    const { wrapper } = await mountPager('/')
    const page1Key = folderKeys.rootPage(1, 40)
    useRootPagesStore().setRootPage(page1Key, {
      ids: [1],
      total: 80,
      page: 1,
      size: 40,
    })

    // Skipped while constrained
    setNavigatorConnection({ saveData: true })
    markFresh(page1Key)
    await nextTick()
    expect(prefetchRootPage).not.toHaveBeenCalled()

    // Triggered when online and unconstrained
    setNavigatorConnection(undefined)
    const { wrapper: wrapper2 } = await mountPager('/')
    useRootPagesStore().setRootPage(page1Key, {
      ids: [1],
      total: 80,
      page: 1,
      size: 40,
    })
    markFresh(page1Key)
    await nextTick()

    expect(prefetchRootPage).toHaveBeenCalledWith({ page: 2, size: 40 }, expect.any(AbortSignal))

    wrapper.unmount()
    wrapper2.unmount()
  })
})
