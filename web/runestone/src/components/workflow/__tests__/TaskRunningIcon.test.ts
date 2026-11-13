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
import { createPinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'

import TaskRunningIcon from '@/components/workflow/TaskRunningIcon.vue'
import directives from '@/directives'

vi.mock('@/api')

function createTestRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/', component: { template: '<div />' } }],
  })
}

describe('TaskRunningIcon', () => {
  it.each([11, 13, 18])('renders an aria-hidden SVG at size %i with three circles', (size) => {
    const wrapper = mount(TaskRunningIcon, {
      props: { size },
      global: { plugins: [createPinia(), directives, createTestRouter()] },
    })

    const svg = wrapper.get('svg')
    expect(svg.attributes('width')).toBe(String(size))
    expect(svg.attributes('height')).toBe(String(size))
    expect(svg.attributes('aria-hidden')).toBe('true')
    expect(svg.attributes('viewBox')).toBe('0 0 24 24')

    const circles = wrapper.findAll('circle')
    expect(circles).toHaveLength(3)
    expect(circles[1]?.classes()).toContain('motion-safe:animate-spin')
  })
})
