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
import { DOMWrapper, flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import AccountDialog from '@/components/dialogs/AccountDialog.vue'
import directives from '@/directives'
import { ApiError, api, type ApiKeyRecord } from '@/api'
import { accountOpen, openAccount } from '@/composables/useApiKeys'
import { useConfirm } from '@/composables/useConfirm'
import { clearQueryCache } from '@/composables/useQueryCache'
import { useAuthStore } from '@/stores/auth'
import { useModalStore } from '@/stores/modals'

vi.mock('@/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api')>()
  const mockedApi = {
    ...actual.api,
    users: {
      ...actual.api.users,
      listApiKeys: vi.fn(),
      createApiKey: vi.fn(),
      deleteApiKey: vi.fn(),
    },
    auth: {
      ...actual.api.auth,
      logout: vi.fn(),
    },
  }
  return {
    ...actual,
    api: mockedApi,
    default: mockedApi,
  }
})

const pinia = createPinia()
setActivePinia(pinia)

let wrapper: VueWrapper | null = null
const writeTextMock = vi.fn<(text: string) => Promise<void>>()

function makeApiError(message: string, status = 500): ApiError {
  return new ApiError({ status, statusText: 'Error', message })
}

function mountDialog(): DOMWrapper<HTMLElement> {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/', component: { template: '<div />' } }],
  })
  wrapper = mount(AccountDialog, {
    attachTo: document.body,
    global: {
      plugins: [pinia, directives, router],
    },
  })
  return new DOMWrapper(document.body)
}

const NOW = Date.parse('2026-11-11T12:00:00Z')
const HOUR = 3_600_000
const DAY = 86_400_000

function makeKey(id: number, name: string, expIso: string, description = ''): ApiKeyRecord {
  return {
    id,
    display_name: name,
    description: description || null,
    token_exp: expIso,
    created_at: '2026-11-01T00:00:00Z',
  }
}

beforeEach(() => {
  Object.defineProperty(AbortController.prototype, Symbol.toStringTag, {
    value: 'AbortController',
    configurable: true,
  })
  setActivePinia(pinia)
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
  clearQueryCache()
  useConfirm().cancel()
  useModalStore().closeAllModals()
  useAuthStore().setUser({
    id: 1,
    username: 'analyst',
    display_name: 'Jane Analyst',
    email: 'jane@openrelik.org',
  })

  writeTextMock.mockReset().mockResolvedValue(undefined)
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText: writeTextMock },
    configurable: true,
  })
  vi.mocked(api.users.listApiKeys).mockResolvedValue([])
  vi.mocked(api.users.createApiKey).mockResolvedValue({
    display_name: 'CLI key',
    token: 'ork_secret_token_123',
  })
  vi.mocked(api.users.deleteApiKey).mockResolvedValue(undefined)
  vi.mocked(api.auth.logout).mockResolvedValue(undefined)
})

afterEach(() => {
  useConfirm().cancel()
  useModalStore().closeAllModals()
  wrapper?.unmount()
  wrapper = null
  document.body.innerHTML = ''
  clearQueryCache()
  vi.useRealTimers()
})

describe('AccountDialog', () => {
  it('displays user profile and API keys across all expiry states, plus initial error retry', async () => {
    vi.mocked(api.users.listApiKeys).mockRejectedValueOnce(makeApiError('Server down', 503))

    const body = mountDialog()
    expect(body.find('[role="dialog"]').exists()).toBe(false)

    openAccount()
    await nextTick()
    await flushPromises()

    const dialog = body.get('[role="dialog"]')
    expect(dialog.text()).toContain('Jane Analyst')
    expect(dialog.text()).toContain('analyst · jane@openrelik.org')
    expect(dialog.get('[role="alert"]').text()).toContain('Could not load API keys: Server down')

    // Retry loads keys with varied expiry windows
    vi.mocked(api.users.listApiKeys).mockResolvedValueOnce([
      makeKey(1, 'Expired key', new Date(NOW - HOUR).toISOString(), 'Old script'),
      makeKey(2, 'Hours key', new Date(NOW + 6 * HOUR).toISOString()),
      makeKey(3, 'One day key', new Date(NOW + DAY + 2 * HOUR).toISOString()),
      makeKey(4, 'Multi day key', new Date(NOW + 10 * DAY).toISOString()),
      makeKey(5, 'Bad date key', 'not-a-date'),
    ])

    await dialog.get('[role="alert"] button').trigger('click')
    await flushPromises()

    const text = dialog.text()
    expect(text).toContain('Expired key')
    expect(text).toContain('Old script')
    expect(text).toContain('expired')
    expect(text).toContain('in 6 h')
    expect(text).toContain('in 1 day')
    expect(text).toContain('in 10 days')
  })

  it('creates an API key, guards Escape and backdrop while token is shown, copies token, and dismisses on Done', async () => {
    const body = mountDialog()
    openAccount()
    await nextTick()
    await flushPromises()

    expect(body.text()).toContain('You have no API keys.')

    // Start creating, then cancel with Escape (keeps dialog open)
    await body
      .findAll('button')
      .find((b) => b.text().includes('Create API key'))!
      .trigger('click')
    expect(body.find('form').exists()).toBe(true)

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }))
    await nextTick()
    expect(body.find('form').exists()).toBe(false)
    expect(accountOpen.value).toBe(true)

    // Reopen create form and submit
    await body
      .findAll('button')
      .find((b) => b.text().includes('Create API key'))!
      .trigger('click')
    const inputs = body.get('form').findAll('input')
    await inputs[0]!.setValue('  Laptop CLI  ')
    await inputs[1]!.setValue('For triage scripts')

    vi.mocked(api.users.listApiKeys).mockResolvedValue([
      makeKey(9, 'Laptop CLI', new Date(NOW + 30 * DAY).toISOString(), 'For triage scripts'),
    ])
    await body.get('form').trigger('submit')
    await flushPromises()

    expect(api.users.createApiKey).toHaveBeenCalledWith('Laptop CLI', 'For triage scripts')
    expect(body.text()).toContain('“Laptop CLI” is ready')

    const textarea = body.get('textarea[aria-label="The new API key"]')
    expect((textarea.element as HTMLTextAreaElement).value).toBe('ork_secret_token_123')
    await textarea.trigger('focus')

    // Close button and Sign out are hidden while key is displayed
    expect(body.find('button[aria-label="Close account"]').exists()).toBe(false)

    // Escape and backdrop warn instead of closing
    const esc = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true })
    window.dispatchEvent(esc)
    await nextTick()
    expect(esc.defaultPrevented).toBe(true)
    expect(accountOpen.value).toBe(true)
    expect(body.text()).toContain('Copy the key before you leave')

    await body.get('[aria-hidden="true"]').trigger('pointerdown')
    expect(accountOpen.value).toBe(true)

    // Clipboard failure shows error, then clipboard success shows Copied
    writeTextMock.mockRejectedValueOnce(new Error('Denied'))
    await body
      .findAll('button')
      .find((b) => b.text().includes('Copy key'))!
      .trigger('click')
    await flushPromises()
    expect(body.text()).toContain('Could not copy: select the key and copy it by hand.')

    writeTextMock.mockResolvedValueOnce(undefined)
    await body
      .findAll('button')
      .find((b) => b.text().includes('Copy key'))!
      .trigger('click')
    await flushPromises()
    expect(writeTextMock).toHaveBeenCalledWith('ork_secret_token_123')
    expect(body.text()).toContain('Copied')

    // Done returns to key list
    await body
      .findAll('button')
      .find((b) => b.text() === 'Done')!
      .trigger('click')
    expect(body.text()).toContain('Laptop CLI')
    expect(body.find('textarea[aria-label="The new API key"]').exists()).toBe(false)
  })

  it('handles create failure, key revocation with confirmation, revoke failure, sign out, and close', async () => {
    const logoutSpy = vi.spyOn(useAuthStore(), 'logout').mockResolvedValue(undefined)
    vi.mocked(api.users.listApiKeys).mockResolvedValue([
      makeKey(7, 'CI runner', new Date(NOW + 5 * DAY).toISOString()),
    ])
    const body = mountDialog()
    openAccount()
    await nextTick()
    await flushPromises()

    // Create failure
    vi.mocked(api.users.createApiKey).mockRejectedValueOnce(makeApiError('Quota reached', 400))
    await body
      .findAll('button')
      .find((b) => b.text().includes('Create API key'))!
      .trigger('click')
    await body.get('form input').setValue('Extra key')
    await body.get('form').trigger('submit')
    await flushPromises()
    expect(body.get('[role="alert"]').text()).toContain('Could not create the key: Quota reached')

    await body
      .get('form')
      .findAll('button')
      .find((b) => b.text() === 'Cancel')!
      .trigger('click')

    // Revoke cancelled -> does not delete
    await body.get('button[aria-label="Revoke CI runner"]').trigger('click')
    await nextTick()
    useConfirm().cancel()
    await flushPromises()
    expect(api.users.deleteApiKey).not.toHaveBeenCalled()

    // Revoke confirmed but fails -> shows error
    vi.mocked(api.users.deleteApiKey).mockRejectedValueOnce(makeApiError('Locked', 409))
    await body.get('button[aria-label="Revoke CI runner"]').trigger('click')
    await nextTick()
    useConfirm().accept()
    await flushPromises()
    expect(body.get('[role="alert"]').text()).toContain('Could not revoke “CI runner”: Locked')

    // Revoke confirmed and succeeds -> removes key from list
    await body.get('button[aria-label="Revoke CI runner"]').trigger('click')
    await nextTick()
    useConfirm().accept()
    await flushPromises()
    expect(api.users.deleteApiKey).toHaveBeenCalledWith(7)
    expect(body.text()).not.toContain('CI runner')

    // Backdrop closes when no newKey is active
    await body.get('[aria-hidden="true"]').trigger('pointerdown')
    expect(accountOpen.value).toBe(false)

    // Reopen, close via X button, reopen and Sign out
    openAccount()
    await nextTick()
    await flushPromises()
    await body.get('button[aria-label="Close account"]').trigger('click')
    expect(accountOpen.value).toBe(false)

    openAccount()
    await nextTick()
    await flushPromises()
    await body
      .findAll('button')
      .find((b) => b.text().includes('Sign out'))!
      .trigger('click')
    await flushPromises()
    expect(accountOpen.value).toBe(false)
    expect(logoutSpy).toHaveBeenCalled()
  })

  it('clears a revealed new API key secret when modals close on sign-out', async () => {
    vi.mocked(api.users.listApiKeys).mockResolvedValue([])
    vi.mocked(api.users.createApiKey).mockResolvedValueOnce({
      display_name: 'Transient Key',
      token: 'ork_transient_secret',
    })
    const body = mountDialog()
    openAccount()
    await nextTick()
    await flushPromises()

    await body
      .findAll('button')
      .find((b) => b.text().includes('Create API key'))!
      .trigger('click')
    await body.get('form input').setValue('Transient Key')
    await body.get('form').trigger('submit')
    await flushPromises()
    expect(body.find('textarea[aria-label="The new API key"]').exists()).toBe(true)

    useAuthStore().setUser(null)
    await nextTick()
    expect(accountOpen.value).toBe(false)

    openAccount()
    await nextTick()
    await flushPromises()
    expect(body.find('textarea[aria-label="The new API key"]').exists()).toBe(false)
  })

  it('ignores Escape while ConfirmDialog is active, clears create error on cancel, and guards in-flight create and concurrent revokes', async () => {
    vi.mocked(api.users.listApiKeys).mockResolvedValue([
      makeKey(11, 'Key One', new Date(NOW + 5 * DAY).toISOString()),
      makeKey(12, 'Key Two', new Date(NOW + 6 * DAY).toISOString()),
    ])
    const body = mountDialog()
    openAccount()
    await nextTick()
    await flushPromises()

    // Trigger create error then cancel: error clears
    vi.mocked(api.users.createApiKey).mockRejectedValueOnce(makeApiError('Quota reached', 400))
    await body
      .findAll('button')
      .find((b) => b.text().includes('Create API key'))!
      .trigger('click')
    await body.get('form input').setValue('Temp')
    await body.get('form').trigger('submit')
    await flushPromises()
    expect(body.find('[role="alert"]').exists()).toBe(true)

    await body
      .get('form')
      .findAll('button')
      .find((b) => b.text() === 'Cancel')!
      .trigger('click')
    expect(body.find('[role="alert"]').exists()).toBe(false)

    // With create form open and ConfirmDialog stacked on top, Escape is not intercepted by AccountDialog
    await body
      .findAll('button')
      .find((b) => b.text().includes('Create API key'))!
      .trigger('click')
    await body.get('button[aria-label="Revoke Key One"]').trigger('click')
    await nextTick()
    expect(useModalStore().activeModal).toBe('confirm')

    const escOnConfirm = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true })
    window.dispatchEvent(escOnConfirm)
    await nextTick()
    expect(escOnConfirm.defaultPrevented).toBe(false)
    expect(body.find('form').exists()).toBe(true)
    useConfirm().cancel()
    await flushPromises()

    // Concurrent revokes keep each row's own pending state
    let resolveFirstDelete!: () => void
    let resolveSecondDelete!: () => void
    vi.mocked(api.users.deleteApiKey)
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveFirstDelete = resolve
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveSecondDelete = resolve
          }),
      )

    await body.get('button[aria-label="Revoke Key One"]').trigger('click')
    await nextTick()
    useConfirm().accept()
    await flushPromises()

    await body.get('button[aria-label="Revoke Key Two"]').trigger('click')
    await nextTick()
    useConfirm().accept()
    await flushPromises()

    const btn1 = body.get('button[aria-label="Revoke Key One"]').element as HTMLButtonElement
    const btn2 = body.get('button[aria-label="Revoke Key Two"]').element as HTMLButtonElement
    expect(btn1.disabled).toBe(true)
    expect(btn2.disabled).toBe(true)

    resolveFirstDelete()
    await flushPromises()
    expect(body.find('button[aria-label="Revoke Key One"]').exists()).toBe(false)
    expect(
      (body.get('button[aria-label="Revoke Key Two"]').element as HTMLButtonElement).disabled,
    ).toBe(true)

    resolveSecondDelete()
    await flushPromises()
    expect(body.find('button[aria-label="Revoke Key Two"]').exists()).toBe(false)

    // Closing dialog while createApiKey is in flight discards late secret
    let resolveCreate!: (val: { display_name: string; token: string }) => void
    vi.mocked(api.users.createApiKey).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveCreate = resolve
        }),
    )
    await body.get('form input').setValue('Late Key')
    await body.get('form').trigger('submit')
    accountOpen.value = false
    await nextTick()

    resolveCreate({ display_name: 'Late Key', token: 'ork_late_secret' })
    await flushPromises()
    openAccount()
    await nextTick()
    await flushPromises()
    expect(body.find('textarea[aria-label="The new API key"]').exists()).toBe(false)
  })
})
