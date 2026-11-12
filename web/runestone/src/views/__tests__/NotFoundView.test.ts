// @vitest-environment happy-dom
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { api, ApiError, type FolderDetail } from '@/api'
import NotFoundView from '@/views/NotFoundView.vue'
import directives from '@/directives'
import { caseLookupError, clearCaseLookups } from '@/composables/useCaseRef'
import { clearQueryCache } from '@/composables/useQueryCache'

vi.mock('@/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api')>()
  return {
    ...actual,
    api: {
      ...actual.api,
      folders: {
        ...actual.api.folders,
        getCaseFolder: vi.fn(),
      },
    },
  }
})

function buildRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'folders', component: { template: '<div>Home</div>' } },
      { path: '/folder/:id', name: 'folder', component: { template: '<div>Folder</div>' } },
      { path: '/metrics', name: 'metrics', component: { template: '<div>Metrics</div>' } },
      { path: '/case/:ref(.*)', name: 'case', component: NotFoundView },
      { path: '/:pathMatch(.*)*', name: 'not-found', component: NotFoundView },
    ],
  })
}

let wrapper: VueWrapper | null = null

beforeEach(() => {
  clearQueryCache()
  clearCaseLookups()
  setActivePinia(createPinia())
  vi.mocked(api.folders.getCaseFolder).mockReset()
})

afterEach(() => {
  wrapper?.unmount()
  wrapper = null
})

describe('NotFoundView', () => {
  it('renders the 404 Page Not Found state for an unknown path and navigates back home', async () => {
    const router = buildRouter()
    await router.push('/missing/evidence?tab=hex')
    await router.isReady()

    wrapper = mount(NotFoundView, {
      global: {
        plugins: [createPinia(), router, directives],
      },
    })

    expect(wrapper.text()).toContain('404: Not Found')
    expect(wrapper.get('h1').text()).toBe('Page Not Found')
    expect(wrapper.text()).toContain('The requested path /missing/evidence?tab=hex does not exist.')
    expect(wrapper.text()).toContain('404 not found')

    const returnLink = wrapper.findAll('a').find((link) => link.text().includes('Return to root'))
    expect(returnLink).toBeDefined()
    await returnLink!.trigger('click')
    await flushPromises()

    expect(router.currentRoute.value.fullPath).toBe('/')
  })

  it('renders the Case Not Found state when navigated to an inaccessible or missing case route', async () => {
    const router = buildRouter()
    await router.push('/case/ir-2026/042')
    await router.isReady()

    wrapper = mount(NotFoundView, {
      global: {
        plugins: [createPinia(), router, directives],
      },
    })

    expect(wrapper.get('h1').text()).toBe('Case Not Found')
    expect(wrapper.text()).toContain('No folder for case ir-2026/042 that you have access to.')

    const toolbarHomeLink = wrapper.get('a[href="/"]')
    await toolbarHomeLink.trigger('click')
    await flushPromises()

    expect(router.currentRoute.value.fullPath).toBe('/')
  })

  it('shows case lookup failure message and retries resolution on Retry', async () => {
    const router = buildRouter()
    await router.push('/case/ir-2026/042')
    await router.isReady()
    caseLookupError.value = 'Backend database unavailable'

    wrapper = mount(NotFoundView, {
      global: {
        plugins: [createPinia(), router, directives],
      },
    })

    expect(wrapper.get('h1').text()).toBe('Case Lookup Failed')
    expect(wrapper.text()).toContain('Backend database unavailable')
    expect(wrapper.text()).toContain('lookup failed')

    // First retry fails with a new error
    vi.mocked(api.folders.getCaseFolder).mockRejectedValueOnce(
      new ApiError({ status: 503, statusText: 'Service Unavailable', message: 'Still starting' }),
    )
    const retryButton = wrapper.findAll('button').find((b) => b.text() === 'Retry')
    expect(retryButton).toBeDefined()
    await retryButton!.trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('Still starting')

    // Second retry succeeds and opens the resolved folder
    const resolved: FolderDetail = {
      id: 42,
      uuid: 'case-42',
      display_name: 'IR 042',
      case_ref: 'ir-2026/042',
      parent: null,
    }
    vi.mocked(api.folders.getCaseFolder).mockResolvedValueOnce(resolved)
    const retryAgain = wrapper.findAll('button').find((b) => b.text() === 'Retry')
    expect(retryAgain).toBeDefined()
    await retryAgain!.trigger('click')
    await flushPromises()

    expect(api.folders.getCaseFolder).toHaveBeenCalledTimes(2)
    expect(router.currentRoute.value.fullPath).toBe('/folder/42')
  })
})
