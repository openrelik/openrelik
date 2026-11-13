import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  accountOpen,
  createApiKey,
  deleteApiKey,
  loadApiKeys,
  openAccount,
  useApiKeys,
} from '@/composables/useApiKeys'
import { clearQueryCache, DEFAULT_STALE_MS } from '@/composables/useQueryCache'
import { useModalStore } from '@/stores/modals'
import { api, ApiError, type ApiKeyRecord } from '@/api'

vi.mock('@/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api')>()
  return {
    ...actual,
    api: {
      ...actual.api,
      users: {
        listApiKeys: vi.fn(),
        createApiKey: vi.fn(),
        deleteApiKey: vi.fn(),
      },
    },
  }
})

describe('composables/useApiKeys', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-01T12:00:00Z'))
    setActivePinia(createPinia())
    clearQueryCache()
  })

  afterEach(() => {
    clearQueryCache()
    vi.useRealTimers()
  })

  it('loads API keys sorted soonest-to-expire first and caches while fresh', async () => {
    const records: ApiKeyRecord[] = [
      { id: 1, display_name: 'Later key', token_exp: '2027-01-01T00:00:00Z' },
      { id: 2, display_name: 'Sooner key', token_exp: '2026-07-01T00:00:00Z' },
      { id: 3, display_name: 'Middle key', token_exp: '2026-10-01T00:00:00Z' },
    ]
    vi.mocked(api.users.listApiKeys).mockResolvedValueOnce(records)

    const { keys, state } = useApiKeys()
    await loadApiKeys()

    expect(api.users.listApiKeys).toHaveBeenCalledTimes(1)
    expect(keys.value.map((k) => k.id)).toEqual([2, 3, 1])
    expect(state.value.status).toBe('success')

    // Within freshness window: does not call the API again.
    vi.advanceTimersByTime(DEFAULT_STALE_MS - 1)
    await loadApiKeys()
    expect(api.users.listApiKeys).toHaveBeenCalledTimes(1)

    // Explicit force reloads immediately.
    vi.mocked(api.users.listApiKeys).mockResolvedValueOnce([records[1]!])
    await loadApiKeys({ force: true })
    expect(api.users.listApiKeys).toHaveBeenCalledTimes(2)
    expect(keys.value.map((k) => k.id)).toEqual([2])
  })

  it('swallows load rejections and exposes the error through query state', async () => {
    vi.mocked(api.users.listApiKeys).mockRejectedValueOnce(
      new ApiError({ status: 503, statusText: 'Unavailable', message: 'Keys unavailable' }),
    )

    const { state } = useApiKeys()
    await expect(loadApiKeys()).resolves.toBeUndefined()

    expect(state.value.status).toBe('error')
    expect(state.value.error).toBe('Keys unavailable')
  })

  it('creates a trimmed key, refreshes the list, and returns the one-time token without storing it', async () => {
    vi.mocked(api.users.createApiKey).mockResolvedValueOnce({
      display_name: 'CLI token',
      token: 'secret-token-once',
    })
    vi.mocked(api.users.listApiKeys).mockResolvedValueOnce([
      {
        id: 42,
        display_name: 'CLI token',
        description: 'For automation',
        token_exp: '2026-12-01T00:00:00Z',
      },
    ])

    const token = await createApiKey('  CLI token  ', '  For automation  ')

    expect(api.users.createApiKey).toHaveBeenCalledWith('CLI token', 'For automation')
    expect(api.users.listApiKeys).toHaveBeenCalledTimes(1)
    expect(token).toBe('secret-token-once')

    const { keys } = useApiKeys()
    expect(keys.value).toHaveLength(1)
    expect(JSON.stringify(keys.value)).not.toContain('secret-token-once')
  })

  it('deletes a key from the reactive list only after server confirmation', async () => {
    vi.mocked(api.users.listApiKeys).mockResolvedValueOnce([
      { id: 10, display_name: 'First', token_exp: '2026-08-01T00:00:00Z' },
      { id: 20, display_name: 'Second', token_exp: '2026-09-01T00:00:00Z' },
    ])
    await loadApiKeys({ force: true })

    const { keys } = useApiKeys()
    vi.mocked(api.users.deleteApiKey).mockRejectedValueOnce(
      new ApiError({ status: 500, statusText: 'Error', message: 'Failed to revoke' }),
    )
    await expect(deleteApiKey(10)).rejects.toThrow('Failed to revoke')
    expect(keys.value.map((k) => k.id)).toEqual([10, 20])

    vi.mocked(api.users.deleteApiKey).mockResolvedValueOnce(undefined)
    await deleteApiKey(10)
    expect(api.users.deleteApiKey).toHaveBeenCalledWith(10)
    expect(keys.value.map((k) => k.id)).toEqual([20])
  })

  it('syncs accountOpen and openAccount with the modal store', () => {
    const modalStore = useModalStore()
    expect(accountOpen.value).toBe(false)

    openAccount()
    expect(accountOpen.value).toBe(true)
    expect(modalStore.isModalOpen('account')).toBe(true)

    accountOpen.value = false
    expect(modalStore.isModalOpen('account')).toBe(false)

    accountOpen.value = true
    expect(modalStore.isModalOpen('account')).toBe(true)
  })
})
