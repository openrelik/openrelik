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
