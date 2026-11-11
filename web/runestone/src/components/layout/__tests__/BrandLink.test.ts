// @vitest-environment happy-dom
import { createMemoryHistory, createRouter } from 'vue-router'
import { flushPromises, mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import BrandLink from '@/components/layout/BrandLink.vue'
import { directives } from '@/directives'

describe('BrandLink', () => {
  it('renders home link with accessible label and logo, navigating to root on click', async () => {
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/', component: { template: '<div />' } },
        { path: '/metrics', component: { template: '<div />' } },
      ],
    })
    await router.push('/metrics')
    await router.isReady()

    const wrapper = mount(BrandLink, {
      global: { plugins: [router, directives] },
    })

    const link = wrapper.get('a')
    expect(link.attributes('aria-label')).toBe('All folders')
    expect(link.get('img').attributes('src')).toBe('/logo-light-round.png')

    await link.trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.fullPath).toBe('/')

    wrapper.unmount()
  })
})
