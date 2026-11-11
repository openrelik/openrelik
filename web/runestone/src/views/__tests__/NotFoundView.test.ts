// @vitest-environment happy-dom
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import NotFoundView from '@/views/NotFoundView.vue'
import directives from '@/directives'
import { clearQueryCache } from '@/composables/useQueryCache'

vi.mock('@/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api')>()
  return {
    ...actual,
    api: {
      ...actual.api,
    },
  }
})

function buildRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'folders', component: { template: '<div>Home</div>' } },
      { path: '/metrics', name: 'metrics', component: { template: '<div>Metrics</div>' } },
      { path: '/case/:ref(.*)', name: 'case', component: NotFoundView },
      { path: '/:pathMatch(.*)*', name: 'not-found', component: NotFoundView },
    ],
  })
}

let wrapper: VueWrapper | null = null

beforeEach(() => {
  clearQueryCache()
  setActivePinia(createPinia())
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
})
