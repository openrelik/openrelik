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
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import LoginView from '@/views/LoginView.vue'
import directives from '@/directives'
import { clearQueryCache } from '@/composables/useQueryCache'
import { useAuthStore } from '@/stores/auth'
import { api, ApiError, type User } from '@/api'
import { POST_LOGIN_REDIRECT_KEY } from '@/utils/authRedirect'

vi.mock('@/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api')>()
  return {
    ...actual,
    api: {
      ...actual.api,
      config: {
        ...actual.api.config,
        useMockApi: false,
      },
      auth: {
        ...actual.api.auth,
        login: vi.fn(),
        getCurrentUser: vi.fn(),
        logout: vi.fn(),
      },
    },
  }
})

const operatorAlice: User = {
  id: 1,
  username: 'alice',
  display_name: 'Alice Analyst',
  email: 'alice@openrelik.local',
  is_admin: false,
}

function buildRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/login', name: 'login', component: LoginView },
      { path: '/', name: 'folders', component: { template: '<div>Folders</div>' } },
      { path: '/folder/:id', name: 'folder', component: { template: '<div>Folder</div>' } },
    ],
  })
}

let wrapper: VueWrapper | null = null

beforeEach(() => {
  clearQueryCache()
  sessionStorage.clear()
  api.config.apiServerUrl = ''
  api.config.authMethods = ['local']
})

afterEach(() => {
  wrapper?.unmount()
  wrapper = null
  document.body.innerHTML = ''
})

describe('LoginView', () => {
  it('validates empty username or password before calling the API', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const router = buildRouter()
    await router.push('/login')
    await router.isReady()

    wrapper = mount(LoginView, {
      attachTo: document.body,
      global: { plugins: [pinia, router, directives] },
    })

    await wrapper.get('input[name="username"]').setValue('   ')
    await wrapper.get('input[name="password"]').setValue('')
    await wrapper.get('form').trigger('submit')

    expect(api.auth.login).not.toHaveBeenCalled()
    const alert = wrapper.get('[role="alert"]')
    expect(alert.text()).toContain('Username and password are required.')
  })

  it('submits trimmed credentials, shows submitting state, and navigates to / by default', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const router = buildRouter()
    await router.push('/login')
    await router.isReady()

    let resolveLogin: ((user: User) => void) | undefined
    vi.mocked(api.auth.login).mockImplementationOnce(
      () =>
        new Promise<User>((resolve) => {
          resolveLogin = resolve
        }),
    )

    wrapper = mount(LoginView, {
      attachTo: document.body,
      global: { plugins: [pinia, router, directives] },
    })

    await wrapper.get('input[name="username"]').setValue('  alice  ')
    await wrapper.get('input[name="password"]').setValue('secret-pass')
    await wrapper.get('form').trigger('submit')

    expect(api.auth.login).toHaveBeenCalledWith('alice', 'secret-pass')
    expect(wrapper.get('button[type="submit"]').text()).toContain('Signing in…')
    expect(wrapper.get('input[name="username"]').attributes('disabled')).toBeDefined()

    resolveLogin!(operatorAlice)
    await flushPromises()

    expect(useAuthStore().isAuthenticated).toBe(true)
    expect(router.currentRoute.value.fullPath).toBe('/')
  })

  it('navigates to the redirect query parameter on successful login', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const router = buildRouter()
    await router.push('/login?redirect=/folder/42')
    await router.isReady()

    vi.mocked(api.auth.login).mockResolvedValueOnce(operatorAlice)

    wrapper = mount(LoginView, {
      attachTo: document.body,
      global: { plugins: [pinia, router, directives] },
    })

    await wrapper.get('input[name="username"]').setValue('alice')
    await wrapper.get('input[name="password"]').setValue('secret-pass')
    await wrapper.get('form').trigger('submit')
    await flushPromises()

    expect(router.currentRoute.value.fullPath).toBe('/folder/42')
  })

  it('displays an ApiError message when authentication fails and toggles password visibility', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const router = buildRouter()
    await router.push('/login')
    await router.isReady()

    vi.mocked(api.auth.login).mockRejectedValueOnce(
      new ApiError({
        status: 401,
        statusText: 'Unauthorized',
        message: 'Invalid username or password',
      }),
    )

    wrapper = mount(LoginView, {
      attachTo: document.body,
      global: { plugins: [pinia, router, directives] },
    })

    const passwordInput = wrapper.get('input[name="password"]')
    expect(passwordInput.attributes('type')).toBe('password')

    const toggleBtn = wrapper.get('button[aria-label="Show password"]')
    await toggleBtn.trigger('click')
    expect(passwordInput.attributes('type')).toBe('text')
    expect(wrapper.get('button[aria-label="Hide password"]').attributes('aria-pressed')).toBe(
      'true',
    )

    await wrapper.get('input[name="username"]').setValue('alice')
    await passwordInput.setValue('wrong-pass')
    await wrapper.get('form').trigger('submit')
    await flushPromises()

    expect(wrapper.get('[role="alert"]').text()).toContain('Invalid username or password')
    expect(wrapper.get('button[type="submit"]').text()).toContain('Sign in')
  })

  it('dismisses error message first on Escape, then resets form fields on a second Escape', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const router = buildRouter()
    await router.push('/login')
    await router.isReady()

    vi.mocked(api.auth.login).mockRejectedValueOnce(
      new ApiError({
        status: 401,
        statusText: 'Unauthorized',
        message: 'Account locked',
      }),
    )

    wrapper = mount(LoginView, {
      attachTo: document.body,
      global: { plugins: [pinia, router, directives] },
    })

    const userInput = wrapper.get('input[name="username"]')
    const passInput = wrapper.get('input[name="password"]')
    await userInput.setValue('alice')
    await passInput.setValue('bad')
    await wrapper.get('form').trigger('submit')
    await flushPromises()

    expect(wrapper.find('[role="alert"]').exists()).toBe(true)

    // First Escape clears the error message while keeping inputs.
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await flushPromises()
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
    expect((userInput.element as HTMLInputElement).value).toBe('alice')

    // Second Escape resets the form inputs and focuses username.
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await flushPromises()
    expect((userInput.element as HTMLInputElement).value).toBe('')
    expect((passInput.element as HTMLInputElement).value).toBe('')
    expect(document.activeElement).toBe(userInput.element)
  })

  it.each([
    'https://evil.example/phish',
    '//evil.example/phish',
    '/\\evil.example/phish',
    '/login?redirect=/folder/1',
    '/login/',
    '/Login?redirect=/folder/1',
  ])('falls back to / for unsafe redirect query %s', async (unsafeRedirect) => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const router = buildRouter()
    await router.push({ name: 'login', query: { redirect: unsafeRedirect } })
    await router.isReady()

    vi.mocked(api.auth.login).mockResolvedValueOnce(operatorAlice)

    wrapper = mount(LoginView, {
      attachTo: document.body,
      global: { plugins: [pinia, router, directives] },
    })

    await wrapper.get('input[name="username"]').setValue('alice')
    await wrapper.get('input[name="password"]').setValue('secret')
    await wrapper.get('form').trigger('submit')
    await flushPromises()

    expect(router.currentRoute.value.fullPath).toBe('/')
  })

  it('renders external OAuth/OIDC sign-in links alongside the local form when configured', async () => {
    api.config.apiServerUrl = 'https://api.openrelik.example/'
    api.config.authMethods = ['local', 'oidc', 'iap', 'google', 'github']

    const pinia = createPinia()
    setActivePinia(pinia)
    const router = buildRouter()
    await router.push('/login')
    await router.isReady()

    wrapper = mount(LoginView, {
      attachTo: document.body,
      global: { plugins: [pinia, router, directives] },
    })

    expect(wrapper.find('form').exists()).toBe(true)

    const links = wrapper.findAll('a')
    expect(links.map((link) => [link.text(), link.attributes('href')])).toEqual([
      ['Sign in with OIDC', 'https://api.openrelik.example/login/oidc'],
      ['Sign in with IAP', 'https://api.openrelik.example/login/iap'],
      ['Sign in with Google', 'https://api.openrelik.example/login/google'],
      ['Sign in with Github', 'https://api.openrelik.example/login/github'],
    ])
  })

  it('hides the local login form when local is not in authMethods', async () => {
    api.config.apiServerUrl = 'http://localhost:8710'
    api.config.authMethods = ['oidc']

    const pinia = createPinia()
    setActivePinia(pinia)
    const router = buildRouter()
    await router.push('/login')
    await router.isReady()

    wrapper = mount(LoginView, {
      attachTo: document.body,
      global: { plugins: [pinia, router, directives] },
    })

    expect(wrapper.find('form').exists()).toBe(false)
    const link = wrapper.get('a')
    expect(link.text()).toBe('Sign in with OIDC')
    expect(link.attributes('href')).toBe('http://localhost:8710/login/oidc')
  })

  it('persists a safe redirect path and clears cached user before starting external login', async () => {
    api.config.authMethods = ['local', 'oidc']

    const pinia = createPinia()
    setActivePinia(pinia)
    const authStore = useAuthStore()
    authStore.setUser(operatorAlice)

    const router = buildRouter()
    await router.push('/login?redirect=/folder/42?sort=name')
    await router.isReady()

    wrapper = mount(LoginView, {
      attachTo: document.body,
      global: { plugins: [pinia, router, directives] },
    })

    const link = wrapper.get('a[href="/login/oidc"]')
    await link.trigger('click')

    expect(authStore.isAuthenticated).toBe(false)
    expect(sessionStorage.getItem(POST_LOGIN_REDIRECT_KEY)).toBe('/folder/42?sort=name')

    // Unsafe or root redirect clears any previously saved target instead of storing it.
    await router.push('/login?redirect=https://evil.example/phish')
    await link.trigger('click')
    expect(sessionStorage.getItem(POST_LOGIN_REDIRECT_KEY)).toBeNull()
  })
})
