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
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { User } from '@/api'
import App from '@/App.vue'
import { directives } from '@/directives'
import { useModalStore } from '@/stores/modals'

let unauthorizedCallback: (() => void) | null = null

vi.mock('@/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api')>()
  return {
    ...actual,
    onUnauthorized: vi.fn((handler: (() => void) | null) => {
      unauthorizedCallback = handler
      actual.onUnauthorized(handler)
    }),
    api: {
      ...actual.api,
      auth: {
        ...actual.api.auth,
        getCurrentUser: vi.fn().mockResolvedValue(null),
      },
    },
  }
})

beforeEach(() => {
  unauthorizedCallback = null
  sessionStorage.clear()
  document.body.innerHTML = ''
})

afterEach(() => {
  document.body.innerHTML = ''
})

describe('App.vue', () => {
  it('renders the active route inside main and wires global keyboard shortcuts', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)

    const testRouter = createRouter({
      history: createMemoryHistory(),
      routes: [
        {
          path: '/',
          name: 'home',
          component: defineComponent({ template: '<div data-testid="routed">Workspace</div>' }),
        },
      ],
    })
    await testRouter.push('/')
    await testRouter.isReady()

    const wrapper = mount(App, {
      attachTo: document.body,
      global: {
        plugins: [pinia, testRouter, directives],
        stubs: {
          Prompt: true,
          SettingsDialog: true,
          AccountDialog: true,
          HelpDialog: true,
          RunDialog: true,
          WorkflowDialog: true,
          ShareDialog: true,
          TaskReportDialog: true,
          ConfirmDialog: true,
          UploadQueuePanel: true,
          Tooltip: true,
          LinkMenu: true,
        },
      },
    })

    expect(wrapper.get('main [data-testid="routed"]').text()).toBe('Workspace')

    const modalStore = useModalStore()
    expect(modalStore.hasActiveModal).toBe(false)

    window.dispatchEvent(new KeyboardEvent('keydown', { key: '?' }))
    expect(modalStore.isModalOpen('help')).toBe(true)

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(modalStore.isModalOpen('help')).toBe(false)

    wrapper.unmount()
  })
})

describe('main.ts', () => {
  it('mounts the application on #app and clears stale sessions via onUnauthorized', async () => {
    const host = document.createElement('div')
    host.id = 'app'
    document.body.appendChild(host)

    vi.resetModules()

    const { default: router } = await import('@/router')
    const { useAuthStore } = await import('@/stores/auth')
    await import('@/main')
    await flushPromises()
    await nextTick()

    expect(host.querySelector('main')).not.toBeNull()
    expect(unauthorizedCallback).toBeTypeOf('function')

    const authStore = useAuthStore()
    const user: User = {
      id: 3,
      username: 'bob',
      display_name: 'Bob Investigator',
    }

    // 1. Unauthenticated -> no-op
    authStore.setUser(null)
    unauthorizedCallback?.()
    expect(authStore.isAuthenticated).toBe(false)

    // 2. Authenticated while already on /login -> clears user without redundant push
    await router.replace({ name: 'login', query: { redirect: '/folder/9' } })
    authStore.setUser(user)
    unauthorizedCallback?.()
    await flushPromises()
    expect(authStore.isAuthenticated).toBe(false)
    expect(router.currentRoute.value.name).toBe('login')
    expect(router.currentRoute.value.query).toEqual({ redirect: '/folder/9' })

    // 3. Authenticated on a non-login route -> clears user and redirects to /login?redirect=...
    authStore.setUser(user)
    await router.push('/unknown-workspace?tab=1')
    expect(router.currentRoute.value.fullPath).toBe('/unknown-workspace?tab=1')

    unauthorizedCallback?.()
    await flushPromises()
    expect(authStore.isAuthenticated).toBe(false)
    expect(router.currentRoute.value.name).toBe('login')
    expect(router.currentRoute.value.query).toEqual({ redirect: '/unknown-workspace?tab=1' })

    // 4. Authenticated while a route navigation is still pending in beforeEach -> keeps pending path
    let holdLookup: (() => void) | undefined
    const beforeEachStop = router.beforeEach(async (to) => {
      if (to.path === '/pending-target') {
        await new Promise<void>((resolve) => {
          holdLookup = resolve
        })
      }
      return true
    })
    authStore.setUser(user)
    const pendingNav = router.push('/pending-target?tab=2')
    await flushPromises()

    unauthorizedCallback?.()
    holdLookup?.()
    await pendingNav.catch(() => {})
    await flushPromises()
    beforeEachStop()

    expect(router.currentRoute.value.name).toBe('login')
    expect(router.currentRoute.value.query).toEqual({ redirect: '/pending-target?tab=2' })
  })
})
