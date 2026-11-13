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
import { computed, nextTick, ref } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'
import { createPinia, setActivePinia } from 'pinia'
import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import StatusBar from '@/components/layout/StatusBar.vue'
import { useAutoRefresh } from '@/composables/useAutoRefresh'
import type { ConnectionStatus } from '@/composables/useConnection'
import type { NetworkState } from '@/composables/useNetworkActivity'
import { directives } from '@/directives'
import { useAuthStore } from '@/stores/auth'
import { useModalStore } from '@/stores/modals'

const connectionStatus = ref<ConnectionStatus>('online')
const networkState = ref<NetworkState>('idle')
const activeUploadCount = ref(0)

vi.mock('@/composables/useConnection', () => ({
  useConnection: () => ({ status: computed(() => connectionStatus.value) }),
}))

vi.mock('@/composables/useNetworkActivity', () => ({
  useNetworkActivity: () => ({ state: computed(() => networkState.value) }),
}))

vi.mock('@/composables/useUploadQueue', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/composables/useUploadQueue')>()
  return {
    ...actual,
    useUploadQueue: () => ({
      ...actual.useUploadQueue(),
      activeCount: computed(() => activeUploadCount.value),
    }),
  }
})

function makeRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', component: { template: '<div />' } },
      { path: '/metrics', component: { template: '<div />' } },
    ],
  })
}

describe('StatusBar', () => {
  let pinia: ReturnType<typeof createPinia>

  beforeEach(() => {
    pinia = createPinia()
    setActivePinia(pinia)
    connectionStatus.value = 'online'
    networkState.value = 'idle'
    activeUploadCount.value = 0
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('renders slot, connection warnings with retry, network indicator states, and upload queue toggle', async () => {
    const router = makeRouter()
    await router.push('/')
    await router.isReady()

    const refreshSpy = vi.fn()
    const wrapper = mount(
      {
        components: { StatusBar },
        setup() {
          useAutoRefresh(refreshSpy)
          return {}
        },
        template: '<StatusBar><span data-slot-info>12 items</span></StatusBar>',
      },
      { global: { plugins: [pinia, router, directives] } },
    )

    const modalStore = useModalStore()
    expect(wrapper.get('[data-slot-info]').text()).toBe('12 items')
    expect(wrapper.get('[aria-label="Network: idle"] span').classes()).toContain('bg-success')
    expect(wrapper.find('[aria-label="Upload queue"]').exists()).toBe(true)

    // Fetching and prefetching states pulse warning dot.
    networkState.value = 'fetching'
    await nextTick()
    expect(wrapper.get('[aria-label="Network: fetching"] span').classes()).toContain('bg-warning')

    networkState.value = 'prefetch'
    await nextTick()
    expect(wrapper.get('[aria-label="Network: prefetch"] span').classes()).toContain(
      'animate-pulse',
    )

    // Offline and unreachable notices.
    connectionStatus.value = 'offline'
    await nextTick()
    expect(wrapper.text()).toContain('offline — showing saved data')

    connectionStatus.value = 'unreachable'
    await nextTick()
    expect(wrapper.text()).toContain('server unreachable — showing saved data')
    await wrapper.get('footer button').trigger('click')
    expect(refreshSpy).toHaveBeenCalledWith({ force: true })

    // Active uploads auto-open the upload panel; clicking toggles minimize/open.
    activeUploadCount.value = 3
    await nextTick()
    const uploadBtn = wrapper.get('[aria-label="Upload queue, 3 active"]')
    expect(uploadBtn.text()).toContain('3 active')
    expect(modalStore.isModalOpen('uploads')).toBe(true)
    await uploadBtn.trigger('click')
    expect(modalStore.isModalOpen('uploads')).toBe(false)
    await uploadBtn.trigger('click')
    expect(modalStore.isModalOpen('uploads')).toBe(true)

    wrapper.unmount()
  })

  it('opens help, settings, and account modals, and signs out authenticated operators', async () => {
    const router = makeRouter()
    await router.push('/')
    await router.isReady()

    const authStore = useAuthStore()
    const modalStore = useModalStore()
    authStore.setUser(null)

    const wrapper = mount(StatusBar, {
      global: { plugins: [pinia, router, directives] },
    })

    // Unauthenticated: no account block, help button carries -mr-3.
    expect(wrapper.find('[aria-label="Account and API keys"]').exists()).toBe(false)
    const helpBtn = wrapper.findAll('button').find((b) => b.text() === 'help')!
    expect(helpBtn.classes()).toContain('-mr-3')
    await helpBtn.trigger('click')
    expect(modalStore.isModalOpen('help')).toBe(true)

    // Authenticated: shows username, opens account dialog, and calls logout.
    authStore.setUser({
      id: 7,
      username: 'analyst',
      display_name: 'Analyst',
      email: 'analyst@example.com',
      is_admin: false,
      created_at: '2026-11-01T00:00:00Z',
    })
    const logoutSpy = vi.spyOn(authStore, 'logout').mockResolvedValue(undefined)
    await nextTick()

    const accountBtn = wrapper.get('[aria-label="Account and API keys"]')
    expect(accountBtn.text()).toContain('analyst')
    await accountBtn.trigger('click')
    expect(modalStore.isModalOpen('account')).toBe(true)

    await wrapper.get('[aria-label="Sign out"]').trigger('click')
    expect(logoutSpy).toHaveBeenCalledTimes(1)

    wrapper.unmount()
  })
})
