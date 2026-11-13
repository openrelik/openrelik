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

import TaskStatusBadge from '@/components/workflow/TaskStatusBadge.vue'
import directives from '@/directives'
import type { TaskStatus } from '@/types/workflow'

vi.mock('@/api')

function createTestRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/', component: { template: '<div />' } }],
  })
}

describe('TaskStatusBadge', () => {
  const cases: {
    status: TaskStatus
    label: string
    toneClass: string
    hasPulseDot: boolean
  }[] = [
    {
      status: 'running',
      label: 'running',
      toneClass: 'text-brand',
      hasPulseDot: true,
    },
    {
      status: 'success',
      label: 'success',
      toneClass: 'text-success',
      hasPulseDot: false,
    },
    {
      status: 'pending',
      label: 'queued',
      toneClass: 'text-idle',
      hasPulseDot: false,
    },
    {
      status: 'failed',
      label: 'failed',
      toneClass: 'text-danger',
      hasPulseDot: false,
    },
    {
      status: 'skipped',
      label: 'won’t run',
      toneClass: 'text-ink-muted',
      hasPulseDot: false,
    },
  ]

  it.each(cases)(
    'renders $status badge with label "$label" and $toneClass tone',
    ({ status, label, toneClass, hasPulseDot }) => {
      const wrapper = mount(TaskStatusBadge, {
        props: { status },
        global: { plugins: [createPinia(), directives, createTestRouter()] },
      })

      const badge = wrapper.get('span.badge')
      expect(badge.text()).toBe(label)
      expect(badge.classes()).toContain(toneClass)

      if (hasPulseDot) {
        expect(wrapper.find('span.animate-pulse').exists()).toBe(true)
        expect(wrapper.find('svg').exists()).toBe(false)
      } else {
        expect(wrapper.find('span.animate-pulse').exists()).toBe(false)
        expect(wrapper.find('svg').exists()).toBe(true)
      }
    },
  )
})
