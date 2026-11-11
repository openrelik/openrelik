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

vi.mock('@/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api')>()
  return {
    ...actual,
    api: {
      ...actual.api,
      config: {
        ...actual.api.config,
        useMockApi: false,
        authMethods: ['local'],
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
    expect(wrapper.get('button[type="submit"]').text()).toContain('Signing in...')
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
})
