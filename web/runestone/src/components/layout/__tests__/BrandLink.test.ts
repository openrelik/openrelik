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
