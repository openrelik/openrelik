// @vitest-environment happy-dom
import { createPinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'

import TaskRunningIcon from '@/components/workflow/TaskRunningIcon.vue'
import TaskStatusIcon from '@/components/workflow/TaskStatusIcon.vue'
import directives from '@/directives'
import type { TaskStatus } from '@/types/workflow'

vi.mock('@/api')

function createTestRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/', component: { template: '<div />' } }],
  })
}

describe('TaskStatusIcon', () => {
  const cases: {
    status: TaskStatus
    size: number
    toneClass: string
    usesRunningSpinner: boolean
  }[] = [
    {
      status: 'success',
      size: 13,
      toneClass: 'text-success-icon',
      usesRunningSpinner: false,
    },
    {
      status: 'running',
      size: 13,
      toneClass: 'text-brand-icon',
      usesRunningSpinner: true,
    },
    {
      status: 'pending',
      size: 11,
      toneClass: 'text-idle',
      usesRunningSpinner: false,
    },
    {
      status: 'failed',
      size: 13,
      toneClass: 'text-danger-icon',
      usesRunningSpinner: false,
    },
    {
      status: 'skipped',
      size: 11,
      toneClass: 'text-ink-muted',
      usesRunningSpinner: false,
    },
  ]

  it.each(cases)(
    'renders the $status icon variant at size $size with class $toneClass',
    ({ status, size, toneClass, usesRunningSpinner }) => {
      const wrapper = mount(TaskStatusIcon, {
        props: { status },
        global: { plugins: [createPinia(), directives, createTestRouter()] },
      })

      const svg = wrapper.get('svg')
      expect(svg.attributes('width')).toBe(String(size))
      expect(svg.attributes('height')).toBe(String(size))
      expect(svg.classes()).toContain('shrink-0')
      expect(svg.classes()).toContain(toneClass)
      expect(wrapper.findComponent(TaskRunningIcon).exists()).toBe(usesRunningSpinner)
    },
  )
})
