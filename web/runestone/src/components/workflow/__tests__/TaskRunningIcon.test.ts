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
