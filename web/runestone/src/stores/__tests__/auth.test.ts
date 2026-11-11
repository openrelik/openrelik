import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ensure, markFresh, queryState } from '@/composables/useQueryCache'
import { useAuthStore } from '@/stores/auth'
import { useItemsStore } from '@/stores/items'
import { useRootPagesStore } from '@/stores/rootPages'
import { useWorkflowsStore } from '@/stores/workflows'
import { api, ApiError, readSession, writeSession, type User } from '@/api'

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

function createMemoryStorage(): Storage {
  const store = new Map<string, string>()
  return {
    get length(): number {
      return store.size
    },
    clear(): void {
      store.clear()
    },
    getItem(key: string): string | null {
      return store.get(key) ?? null
    },
    key(index: number): string | null {
      return [...store.keys()][index] ?? null
    },
    removeItem(key: string): void {
      store.delete(key)
    },
    setItem(key: string, value: string): void {
      store.set(key, String(value))
    },
  }
}

const operatorAlice: User = {
  id: 1,
  username: 'alice',
  display_name: 'Alice Analyst',
  email: 'alice@openrelik.local',
  is_admin: false,
}

function seedOperatorWorkspace(): void {
  useItemsStore().upsertItems([
    {
      id: 10,
      parent: null,
      kind: 'folder',
      name: 'Alice Private Case',
      owner: 'Alice Analyst',
      modified: '2026-04-01T00:00:00Z',
    },
  ])
  useRootPagesStore().setRootPage('folders:root:s40:p1', {
    ids: [10],
    total: 1,
    page: 1,
    size: 40,
  })
  useWorkflowsStore().upsertWorkflow({
    id: 77,
    folderId: 10,
    name: 'Plaso Run',
    created: '2026-04-01T00:00:00Z',
    inputs: [],
    groups: [],
    draft: true,
  })
  markFresh('folders:root:s40:p1')
}

describe('stores/auth', () => {
  beforeEach(() => {
    vi.stubGlobal('sessionStorage', createMemoryStorage())
    setActivePinia(createPinia())
  })

  it('hydrates initial user from sessionStorage when present', () => {
    writeSession('openrelik.auth.user', JSON.stringify(operatorAlice))
    setActivePinia(createPinia())

    const auth = useAuthStore()
    expect(auth.user).toEqual(operatorAlice)
    expect(auth.isAuthenticated).toBe(true)
  })

  it('hydrates user, isAuthenticated, and sessionStorage on login', async () => {
    vi.mocked(api.auth.login).mockResolvedValueOnce(operatorAlice)
    const auth = useAuthStore()

    expect(auth.isAuthenticated).toBe(false)
    const loggedIn = await auth.login('alice', 'correct-horse')

    expect(api.auth.login).toHaveBeenCalledWith('alice', 'correct-horse')
    expect(loggedIn).toEqual(operatorAlice)
    expect(auth.user).toEqual(operatorAlice)
    expect(auth.isAuthenticated).toBe(true)
    expect(auth.isLoading).toBe(false)
    expect(auth.error).toBeNull()
    expect(JSON.parse(readSession('openrelik.auth.user') ?? 'null')).toEqual(operatorAlice)
  })

  it('records a readable error message and rethrows when login fails', async () => {
    const failure = new ApiError({
      status: 401,
      statusText: 'Unauthorized',
      message: 'Invalid username or password',
    })
    vi.mocked(api.auth.login).mockRejectedValueOnce(failure)
    const auth = useAuthStore()

    await expect(auth.login('alice', 'wrong')).rejects.toBe(failure)
    expect(auth.user).toBeNull()
    expect(auth.isAuthenticated).toBe(false)
    expect(auth.isLoading).toBe(false)
    expect(auth.error).toBe('Invalid username or password')
  })

  it('hydrates user and isAuthenticated on fetchCurrentUser, and clears state on 401', async () => {
    vi.mocked(api.auth.getCurrentUser).mockResolvedValueOnce(operatorAlice)
    const auth = useAuthStore()

    const hydrated = await auth.fetchCurrentUser()
    expect(hydrated).toEqual(operatorAlice)
    expect(auth.user).toEqual(operatorAlice)
    expect(auth.isAuthenticated).toBe(true)
    expect(auth.isLoading).toBe(false)

    // Populate workspace data, then simulate an expired session on next check.
    seedOperatorWorkspace()
    vi.mocked(api.auth.getCurrentUser).mockRejectedValueOnce(
      new ApiError({ status: 401, statusText: 'Unauthorized', message: 'Expired' }),
    )

    const afterExpiry = await auth.fetchCurrentUser()
    expect(afterExpiry).toBeNull()
    expect(auth.user).toBeNull()
    expect(auth.isAuthenticated).toBe(false)
    expect(useItemsStore().items).toEqual([])
    expect(queryState('folders:root:s40:p1').status).toBe('idle')
  })

  it('wipes items, rootPages, workflows, and queryCache on setUser(null)', async () => {
    const auth = useAuthStore()
    auth.setUser(operatorAlice)
    seedOperatorWorkspace()
    await ensure('folder:10:files', async () => {})

    expect(useItemsStore().items).toHaveLength(1)
    expect(useRootPagesStore().pages.size).toBe(1)
    expect(useWorkflowsStore().workflows.size).toBe(1)
    expect(queryState('folders:root:s40:p1').status).toBe('success')
    expect(queryState('folder:10:files').status).toBe('success')

    auth.setUser(null)

    expect(auth.user).toBeNull()
    expect(auth.isAuthenticated).toBe(false)
    expect(readSession('openrelik.auth.user')).toBeNull()
    expect(useItemsStore().items).toEqual([])
    expect(useRootPagesStore().pages.size).toBe(0)
    expect(useWorkflowsStore().workflows.size).toBe(0)
    expect(queryState('folders:root:s40:p1').status).toBe('idle')
    expect(queryState('folder:10:files').status).toBe('idle')
  })

  it('wipes all operator state on logout even when server logout fails, and redirects when asked', async () => {
    const assign = vi.fn()
    vi.stubGlobal('window', { location: { assign } })
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.mocked(api.auth.logout).mockRejectedValueOnce(
      new ApiError({ status: 500, statusText: 'Error', message: 'Server unavailable' }),
    )

    const auth = useAuthStore()
    auth.setUser(operatorAlice)
    seedOperatorWorkspace()

    await auth.logout(true)

    expect(api.auth.logout).toHaveBeenCalledTimes(1)
    expect(auth.user).toBeNull()
    expect(auth.isAuthenticated).toBe(false)
    expect(useItemsStore().items).toEqual([])
    expect(useRootPagesStore().pages.size).toBe(0)
    expect(useWorkflowsStore().workflows.size).toBe(0)
    expect(queryState('folders:root:s40:p1').status).toBe('idle')
    expect(assign).toHaveBeenCalledWith('/login')
  })
})
