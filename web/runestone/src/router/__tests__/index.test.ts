// @vitest-environment happy-dom
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { api, ApiError, type FolderDetail, type User } from '@/api'
import { caseLookupError, clearCaseLookups } from '@/composables/useCaseRef'
import { clearQueryCache } from '@/composables/useQueryCache'
import router from '@/router'
import { useAuthStore } from '@/stores/auth'

vi.mock('@/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api')>()
  return {
    ...actual,
    api: {
      ...actual.api,
      auth: {
        ...actual.api.auth,
        getCurrentUser: vi.fn(),
        login: vi.fn(),
        logout: vi.fn(),
      },
      folders: {
        ...actual.api.folders,
        getCaseFolder: vi.fn(),
      },
    },
  }
})

const operator: User = {
  id: 7,
  username: 'alice',
  display_name: 'Alice Analyst',
  email: 'alice@openrelik.local',
}

beforeEach(async () => {
  setActivePinia(createPinia())
  clearQueryCache()
  clearCaseLookups()
  sessionStorage.clear()
  vi.mocked(api.auth.getCurrentUser).mockRejectedValue(
    new ApiError({ status: 401, statusText: 'Unauthorized', message: 'Not signed in' }),
  )
  await router.replace('/login')
})

describe('router', () => {
  it('redirects unauthenticated requests to /login and preserves non-root redirect paths', async () => {
    await router.push('/')
    expect(router.currentRoute.value.name).toBe('login')
    expect(router.currentRoute.value.query).toEqual({})

    await router.push('/folder/42?sort=name')
    expect(router.currentRoute.value.name).toBe('login')
    expect(router.currentRoute.value.query).toEqual({ redirect: '/folder/42?sort=name' })
  })

  it('hydrates an uncached session via fetchCurrentUser and resolves private routes', async () => {
    vi.mocked(api.auth.getCurrentUser).mockResolvedValue(operator)

    await router.push('/metrics')
    expect(router.currentRoute.value.name).toBe('metrics')
    expect(useAuthStore().user).toEqual(operator)

    // Subsequent navigations while authenticated resolve every route without re-fetching user
    vi.mocked(api.auth.getCurrentUser).mockClear()

    await router.push('/')
    expect(router.currentRoute.value.name).toBe('folders')

    await router.push('/folder/15')
    expect(router.currentRoute.value.name).toBe('folder')
    expect(router.currentRoute.value.params).toEqual({ id: '15' })

    await router.push('/folder/15/file/88')
    expect(router.currentRoute.value.name).toBe('file')
    expect(router.currentRoute.value.params).toEqual({ folderId: '15', fileId: '88' })

    await router.push('/unmatched/deep/path')
    expect(router.currentRoute.value.name).toBe('not-found')

    expect(api.auth.getCurrentUser).not.toHaveBeenCalled()
  })

  it('handles /login navigation when authenticated with redirect query, valid session, or expired session', async () => {
    const authStore = useAuthStore()
    authStore.setUser(operator)

    // 1. Explicit redirect query stays on /login so login view can handle it
    await router.push({ path: '/login', query: { redirect: '/metrics' } })
    expect(router.currentRoute.value.name).toBe('login')
    expect(router.currentRoute.value.query.redirect).toBe('/metrics')

    // 2. Active session with no redirect query bounces to home ('/')
    vi.mocked(api.auth.getCurrentUser).mockResolvedValueOnce(operator)
    await router.push('/login')
    expect(router.currentRoute.value.name).toBe('folders')

    // 3. Stale cached user whose server session expired stays on /login
    vi.mocked(api.auth.getCurrentUser).mockRejectedValueOnce(
      new ApiError({ status: 401, statusText: 'Unauthorized', message: 'Expired' }),
    )
    await router.push('/login')
    expect(router.currentRoute.value.name).toBe('login')
    expect(authStore.isAuthenticated).toBe(false)
  })

  it('resolves /case/:ref to /folder/:id when found, or renders not-found on 404 or server failure', async () => {
    useAuthStore().setUser(operator)

    const caseFolder: FolderDetail = {
      id: 77,
      uuid: 'case-77-uuid',
      display_name: 'IR Case 007',
      case_ref: 'ir-2024/007',
      parent: null,
    }
    vi.mocked(api.folders.getCaseFolder).mockResolvedValueOnce(caseFolder)

    await router.push('/case/ir-2024/007')
    expect(router.currentRoute.value.name).toBe('folder')
    expect(router.currentRoute.value.path).toBe('/folder/77')

    // 404 case -> stays on 'case' (NotFoundView)
    vi.mocked(api.folders.getCaseFolder).mockRejectedValueOnce(
      new ApiError({ status: 404, statusText: 'Not Found', message: 'No such case' }),
    )
    await router.push('/case/ir-2024/missing')
    expect(router.currentRoute.value.name).toBe('case')

    // Return to another route so entering /case/:ref again runs beforeEnter
    await router.push('/')

    // Unexpected server error -> warns, stays on 'case', and exposes lookup error for Retry
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.mocked(api.folders.getCaseFolder).mockRejectedValueOnce(
      new ApiError({ status: 500, statusText: 'Server Error', message: 'DB offline' }),
    )
    await router.push('/case/ir-2024/boom')
    expect(router.currentRoute.value.name).toBe('case')
    expect(warnSpy).toHaveBeenCalledWith('[router] Case lookup failed:', expect.any(ApiError))
    expect(caseLookupError.value).toBe('DB offline')

    await router.push('/')
    expect(caseLookupError.value).toBeNull()
  })

  it('redirects to login instead of NotFoundView when /case lookup drops auth session', async () => {
    const authStore = useAuthStore()
    authStore.setUser(operator)
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    vi.mocked(api.folders.getCaseFolder).mockImplementationOnce(async () => {
      authStore.setUser(null)
      throw new ApiError({ status: 401, statusText: 'Unauthorized', message: 'Expired' })
    })

    await router.push('/case/ir-2024/007')
    expect(router.currentRoute.value.name).toBe('login')
    expect(router.currentRoute.value.query.redirect).toBe('/case/ir-2024/007')
    expect(warnSpy).toHaveBeenCalled()
  })

  // Regression: `/case/:ref(.*)` resolves in `beforeEach` rather than per-route `beforeEnter`
  // (which Vue Router skips when staying on the same route record), so navigating directly from a
  // missing `/case/...` page (`name: 'case'`) to another `/case/...` URL re-runs `findCaseFolder`.
  it('re-runs case lookup when navigating directly from one /case/:ref URL to another', async () => {
    useAuthStore().setUser(operator)

    vi.mocked(api.folders.getCaseFolder).mockRejectedValueOnce(
      new ApiError({ status: 404, statusText: 'Not Found', message: 'No such case' }),
    )
    await router.push('/case/ir-2024/missing')
    expect(router.currentRoute.value.name).toBe('case')

    const existingFolder: FolderDetail = {
      id: 77,
      uuid: 'case-77-uuid',
      display_name: 'IR Case 007',
      case_ref: 'ir-2024/007',
      parent: null,
    }
    vi.mocked(api.folders.getCaseFolder).mockResolvedValueOnce(existingFolder)

    await router.push('/case/ir-2024/007')
    expect(router.currentRoute.value.path).toBe('/folder/77')
  })
})
