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
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import WorkflowSummary from '@/components/workflow/WorkflowSummary.vue'
import directives from '@/directives'
import { useItemsStore } from '@/stores/items'
import type { RunStats, Workflow } from '@/types/workflow'

vi.mock('@/api')

function createTestRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/', component: { template: '<div />' } }],
  })
}

function makeWorkflow(overrides: Partial<Workflow> = {}): Workflow {
  return {
    id: 1,
    folderId: 42,
    name: 'Server workflow name',
    created: '2026-11-01T00:00:00Z',
    inputs: [],
    groups: [],
    draft: false,
    ...overrides,
  }
}

function makeStats(overrides: Partial<RunStats> = {}): RunStats {
  return {
    done: 3,
    failed: 0,
    running: 1,
    total: 5,
    elapsed: 125,
    state: 'running',
    ...overrides,
  }
}

describe('WorkflowSummary', () => {
  let pinia: ReturnType<typeof createPinia>

  beforeEach(() => {
    pinia = createPinia()
    setActivePinia(pinia)
  })

  it('renders draft worker count without workflow name by default', () => {
    const wrapper = mount(WorkflowSummary, {
      props: {
        workflow: makeWorkflow({ draft: true }),
        stats: makeStats({ total: 1, state: 'draft' }),
      },
      global: { plugins: [pinia, directives, createTestRouter()] },
    })

    expect(wrapper.text()).toBe('draft · 1 worker')
    expect(wrapper.find('span.tabular').classes()).toContain('text-ink')
  })

  it('renders completed/running task counts, failure count, and formatted duration', () => {
    const wrapper = mount(WorkflowSummary, {
      props: {
        workflow: makeWorkflow({ draft: false }),
        stats: makeStats({ done: 12, total: 22, failed: 2, elapsed: 1240 }),
      },
      global: { plugins: [pinia, directives, createTestRouter()] },
    })

    expect(wrapper.text()).toContain('12/22 tasks done')
    expect(wrapper.text()).toContain('2 failed')
    expect(wrapper.get('.text-danger').text()).toBe('2 failed')
    expect(wrapper.text()).toContain('20m 40s')
  })

  it('omits failure segment when failed count is zero', () => {
    const wrapper = mount(WorkflowSummary, {
      props: {
        workflow: makeWorkflow({ draft: false }),
        stats: makeStats({ done: 4, total: 4, failed: 0, elapsed: 9 }),
      },
      global: { plugins: [pinia, directives, createTestRouter()] },
    })

    expect(wrapper.text().replace(/\s+/g, ' ')).toBe('4/4 tasks done · 9s')
    expect(wrapper.find('.text-danger').exists()).toBe(false)
  })

  it('shows folder name from items store when showName is true, falling back to workflow.name', async () => {
    const workflow = makeWorkflow({ folderId: 77, name: 'Fallback workflow', draft: true })
    const wrapper = mount(WorkflowSummary, {
      props: {
        workflow,
        stats: makeStats({ total: 3, state: 'draft' }),
        showName: true,
      },
      global: { plugins: [pinia, directives, createTestRouter()] },
    })

    expect(wrapper.text()).toContain('Fallback workflow')
    expect(wrapper.text()).toContain('draft · 3 workers')
    expect(wrapper.find('span.tabular').classes()).toContain('text-ink-muted')

    useItemsStore().upsertItems([
      {
        id: 77,
        parent: 1,
        kind: 'folder',
        name: 'Renamed folder',
        owner: 'Alice',
        modified: '2026-11-01T00:00:00Z',
      },
    ])
    await wrapper.vm.$nextTick()

    expect(wrapper.text()).toContain('Renamed folder')
    expect(wrapper.text()).not.toContain('Fallback workflow')
  })

  it('mutes non-draft summary text when showName is true', () => {
    const wrapper = mount(WorkflowSummary, {
      props: {
        workflow: makeWorkflow({ draft: false }),
        stats: makeStats({ done: 2, total: 5, failed: 0, elapsed: 45 }),
        showName: true,
      },
      global: { plugins: [pinia, directives, createTestRouter()] },
    })

    expect(wrapper.text()).toContain('Server workflow name')
    expect(wrapper.find('span.tabular').classes()).toContain('text-ink-muted')
  })
})
