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
import { nextTick } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { api, type WorkflowRecord } from '@/api'
import TaskInspector from '@/components/workflow/TaskInspector.vue'
import { clearQueryCache } from '@/composables/useQueryCache'
import { useTaskReport } from '@/composables/useTaskReport'
import { dismissEdits } from '@/composables/useWorkflow'
import directives from '@/directives'
import { useItemsStore } from '@/stores/items'
import { useModalStore } from '@/stores/modals'
import { useWorkflowsStore } from '@/stores/workflows'
import type { Item } from '@/types/item'
import type { Task, TaskGroup, Workflow } from '@/types/workflow'

vi.mock('@/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api')>()
  return {
    ...actual,
    api: {
      ...actual.api,
      workflows: {
        ...actual.api.workflows,
        saveSpec: vi.fn(),
      },
    },
  }
})

function makeWorkflowRecord(folderId: number): WorkflowRecord {
  return {
    id: 1,
    display_name: 'Workflow',
    spec_json: null,
    uuid: '00000000000000000000000000000000',
    files: [{ id: 10, display_name: 'disk.dd' }],
    tasks: [],
    folder: { id: folderId },
  }
}

function makeTask(id: string, overrides: Partial<Task> = {}): Task {
  return {
    id,
    name: `Worker ${id}`,
    module: `openrelik-worker-${id}.tasks.${id}`,
    queue: `openrelik-worker-${id}`,
    status: 'success',
    outputs: [],
    fileReports: [],
    options: [],
    config: {},
    groups: [],
    ...overrides,
  }
}

function makeGroup(id: string, tasks: Task[], join?: Task): TaskGroup {
  return join ? { id, tasks, join } : { id, tasks }
}

function makeFile(id: number, name: string, size: number, parent = 200): Item {
  return {
    id,
    parent,
    kind: 'file',
    name,
    owner: 'Alice',
    modified: '2026-11-01T00:00:00Z',
    size,
  }
}

function createTestRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', component: { template: '<div />' } },
      { path: '/folder/:folderId/file/:fileId', component: { template: '<div />' } },
    ],
  })
}

describe('TaskInspector', () => {
  let pinia: ReturnType<typeof createPinia>
  const wrappers: VueWrapper[] = []

  beforeEach(() => {
    vi.useFakeTimers()
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe(): void {}
        unobserve(): void {}
        disconnect(): void {}
      },
    )
    pinia = createPinia()
    setActivePinia(pinia)
    clearQueryCache()
    dismissEdits()
    vi.mocked(api.workflows.saveSpec).mockResolvedValue(makeWorkflowRecord(200))
  })

  afterEach(async () => {
    while (wrappers.length > 0) wrappers.pop()?.unmount()
    dismissEdits()
    await vi.runOnlyPendingTimersAsync()
    vi.useRealTimers()
  })

  function mountInspector(props: { task: Task; folderId: number; editable?: boolean }) {
    const router = createTestRouter()
    const wrapper = mount(TaskInspector, {
      props,
      global: { plugins: [pinia, directives, router] },
    })
    wrappers.push(wrapper)
    return { wrapper, router }
  }

  function seedWorkflow(workflow: Workflow): Workflow {
    useWorkflowsStore().upsertWorkflow(workflow)
    return useWorkflowsStore().workflowOf(workflow.folderId)!
  }

  it('renders completed task details, read-only options, inputs, error/traceback, report button, and timing', async () => {
    useItemsStore().upsertItems([
      {
        id: 200,
        parent: 50,
        kind: 'folder',
        name: 'Workflow folder',
        owner: 'Alice',
        modified: '2026-11-01T00:00:00Z',
      },
    ])
    const task = makeTask('t1', {
      name: 'Strings',
      description: 'Extracts printable strings',
      status: 'failed',
      duration: 45,
      error: 'Worker crashed unexpectedly',
      traceback: 'Traceback (most recent call last):\n  ValueError: boom',
      report: {
        summary: 'Found suspicious indicators',
        priority: 80,
        markdown: '# Findings',
      },
      fileReports: [
        {
          fileId: 301,
          fileName: 'hits.txt',
          summary: 'High confidence match',
          priority: 80,
          markdown: 'Match details',
        },
      ],
      options: [
        { key: 'min_len', label: 'Min length', type: 'text', default: '4' },
        { key: 'unused_opt', label: 'Unused', type: 'text', default: '' },
      ],
      config: { min_len: '8', unused_opt: '' },
    })
    seedWorkflow({
      id: 1,
      folderId: 200,
      name: 'Run 1',
      created: '2026-11-01T00:00:00Z',
      inputs: [{ id: 10, name: 'evidence.dd' }],
      groups: [makeGroup('g1', [task])],
      draft: false,
    })

    const { wrapper } = mountInspector({ task, folderId: 200 })

    expect(wrapper.get('[role="img"]').attributes('aria-label')).toBe('failed')
    expect(wrapper.text()).toContain('Strings')
    expect(wrapper.text()).toContain('Extracts printable strings')
    expect(wrapper.text()).toContain('Worker crashed unexpectedly')
    expect(wrapper.text()).toContain('Traceback (most recent call last):')
    expect(wrapper.text()).toContain('Found suspicious indicators')
    expect(wrapper.text()).toContain('1 file flagged')
    expect(wrapper.text()).toContain('failed after 45s')

    // Read-only options list includes only configured non-empty options.
    const dl = wrapper.get('dl')
    expect(dl.text()).toContain('Min length')
    expect(dl.text()).toContain('8')
    expect(dl.text()).not.toContain('Unused')
    expect(wrapper.find('input').exists()).toBe(false)

    // Ran-on input links to parent folder (50) and file id (10).
    const ranOnSection = wrapper.get('section[aria-label="Ran on"]')
    expect(ranOnSection.get('a').attributes('href')).toBe('/folder/50/file/10')

    // Open report opens the singleton report modal.
    const reportBtn = wrapper.findAll('button').find((btn) => btn.text().includes('Open report'))!
    await reportBtn.trigger('click')
    const { report } = useTaskReport()
    expect(useModalStore().isModalOpen('report')).toBe(true)
    expect(report.value?.task.id).toBe('t1')
    expect(report.value?.folderId).toBe(200)

    // Close task button emits close.
    await wrapper.get('button[aria-label="Close task"]').trigger('click')
    expect(wrapper.emitted('close')).toHaveLength(1)
  })

  it('shows running progress, parent/join ran-on descriptions, and unlinked input when parent folder is unknown', async () => {
    const child = makeTask('child', {
      name: 'YARA',
      status: 'running',
      progress: 'Scanning chunk 4/10',
      duration: 12,
    })
    const parentA = makeTask('a', { name: 'Strings', groups: [makeGroup('g-child', [child])] })
    const parentB = makeTask('b', { name: 'Plaso' })
    const joinTask = makeTask('join', { name: 'Aggregator', status: 'success', duration: 5 })
    const rootSolo = makeTask('solo', { name: 'Hasher', status: 'pending' })

    seedWorkflow({
      id: 2,
      folderId: 201,
      name: 'Run 2',
      created: '2026-11-01T00:00:00Z',
      inputs: [{ id: 11, name: 'mem.raw' }],
      groups: [makeGroup('g-ab', [parentA, parentB], joinTask), makeGroup('g-solo', [rootSolo])],
      draft: false,
    })

    const { wrapper } = mountInspector({ task: child, folderId: 201 })
    expect(wrapper.text()).toContain('Scanning chunk 4/10')
    expect(wrapper.text()).toContain('running for 12s')
    expect(wrapper.get('section[aria-label="Ran on"]').text()).toContain('the outputs of Strings')
    expect(wrapper.get('section[aria-label="Outputs"]').text()).toContain('Not yet.')

    await wrapper.setProps({ task: joinTask })
    expect(wrapper.get('section[aria-label="Ran on"]').text()).toContain(
      'the outputs of Strings, Plaso',
    )
    expect(wrapper.text()).toContain('ran for 5s')
    expect(wrapper.get('section[aria-label="Outputs"]').text()).toContain('None.')

    // Root task when workflow folder is not in itemsStore renders input as plain span (no anchor).
    await wrapper.setProps({ task: rootSolo })
    const ranOn = wrapper.get('section[aria-label="Ran on"]')
    expect(ranOn.text()).toContain('mem.raw')
    expect(ranOn.find('a').exists()).toBe(false)
  })

  it('sorts outputs by priority before non-flagged files, folds >2 empty files, and navigates on click', async () => {
    useItemsStore().upsertItems([
      makeFile(101, 'plain.txt', 512, 200),
      makeFile(102, 'critical.txt', 1024, 200),
      makeFile(103, 'empty-1.txt', 0, 200),
      makeFile(104, 'empty-2.txt', 0, 200),
      makeFile(105, 'empty-3.txt', 0, 200),
    ])

    const task = makeTask('t-out', {
      status: 'success',
      outputs: [103, 101, 104, 102, 105],
      fileReports: [
        {
          fileId: 102,
          fileName: 'critical.txt',
          priority: 80,
          summary: 'Malware signature matched',
          markdown: '',
        },
      ],
    })
    const otherTask = makeTask('t-other', { status: 'success', outputs: [] })

    seedWorkflow({
      id: 3,
      folderId: 200,
      name: 'Outputs run',
      created: '2026-11-01T00:00:00Z',
      inputs: [],
      groups: [makeGroup('g1', [task, otherTask])],
      draft: false,
    })

    const { wrapper, router } = mountInspector({ task, folderId: 200 })
    await router.isReady()

    const outSection = wrapper.get('section[aria-label="Outputs"]')
    const initialLinks = outSection.findAll('a')
    // 3 empty files fold behind "+3 empty", leaving critical.txt first, then plain.txt.
    expect(initialLinks.map((a) => a.text())).toEqual([
      expect.stringContaining('critical.txt'),
      expect.stringContaining('plain.txt'),
    ])
    expect(outSection.text()).toContain('Malware signature matched')

    const toggleBtn = outSection.get('button')
    expect(toggleBtn.text()).toBe('+3 empty')
    expect(toggleBtn.attributes('aria-expanded')).toBe('false')

    await toggleBtn.trigger('click')
    expect(toggleBtn.text()).toBe('hide empty files')
    expect(toggleBtn.attributes('aria-expanded')).toBe('true')
    expect(outSection.findAll('a')).toHaveLength(5)

    // Navigating via output RouterLink updates memory router location.
    await outSection.findAll('a')[0]!.trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.fullPath).toBe('/folder/200/file/102')

    // Switching tasks resets showEmpty back to folded.
    await wrapper.setProps({ task: otherTask })
    await wrapper.setProps({ task })
    expect(wrapper.get('section[aria-label="Outputs"] button').text()).toBe('+3 empty')
  })

  it('edits checkbox, select, textarea, and text options in draft mode via setTaskOption', async () => {
    const task = makeTask('draft-t', {
      status: 'pending',
      options: [
        { key: 'verbose', label: 'Verbose', type: 'checkbox', default: 'false' },
        {
          key: 'format',
          label: 'Format',
          type: 'select',
          default: '',
          items: ['json', 'csv'],
        },
        {
          key: 'rules',
          label: 'YARA rules',
          type: 'textarea',
          default: '',
          required: true,
          description: 'Paste YARA rules',
        },
        { key: 'filter', label: 'Filter', type: 'text', default: '', required: true },
      ],
      config: { verbose: 'false', format: '', rules: '', filter: '' },
    })

    seedWorkflow({
      id: 4,
      folderId: 200,
      name: 'Draft',
      created: '2026-11-01T00:00:00Z',
      inputs: [{ id: 10, name: 'disk.dd' }],
      groups: [makeGroup('g1', [task])],
      draft: true,
    })

    const { wrapper } = mountInspector({ task, folderId: 200, editable: true })

    const checkbox = wrapper.get('input[type="checkbox"]')
    await checkbox.setValue(true)
    expect(task.config.verbose).toBe('true')

    const select = wrapper.get('select')
    expect(select.findAll('option').map((o) => o.text())).toEqual(['–', 'json', 'csv'])
    await select.setValue('csv')
    expect(task.config.format).toBe('csv')

    const textarea = wrapper.get('textarea')
    expect(textarea.attributes('placeholder')).toBe('required')
    await textarea.setValue('rule test { condition: true }')
    expect(task.config.rules).toBe('rule test { condition: true }')

    const textInput = wrapper.get('input[type="text"]')
    await textInput.setValue('*.exe')
    expect(task.config.filter).toBe('*.exe')
  })

  it('emits add actions (after, beside, join, joinAll) and removes task + closes in draft mode', async () => {
    const child = makeTask('child')
    const taskA = makeTask('a', { groups: [makeGroup('gc', [child])] })
    const taskB = makeTask('b')
    // Free two-task group for join ({ join: groupId }).
    const free1 = makeTask('f1')
    const free2 = makeTask('f2')

    const workflow = seedWorkflow({
      id: 5,
      folderId: 200,
      name: 'Draft actions',
      created: '2026-11-01T00:00:00Z',
      inputs: [{ id: 10, name: 'disk.dd' }],
      groups: [makeGroup('g-free', [free1, free2])],
      draft: true,
    })

    const { wrapper } = mountInspector({ task: free1, folderId: 200, editable: true })

    const clickButtonNamed = async (label: string) => {
      const btn = wrapper.findAll('button').find((b) => b.text().includes(label))
      if (!btn) throw new Error(`Missing button "${label}"`)
      await btn.trigger('click')
    }

    await clickButtonNamed('Add worker after')
    expect(wrapper.emitted('add')?.[0]?.[0]).toEqual({ after: 'f1' })

    await clickButtonNamed('Add worker beside')
    expect(wrapper.emitted('add')?.[1]?.[0]).toEqual({ beside: 'f1' })

    await clickButtonNamed('Add worker after all 2')
    expect(wrapper.emitted('add')?.[2]?.[0]).toEqual({ join: 'g-free' })

    // When owner has multiple free sibling groups, join offers joinAll across all sibling tasks.
    const sib3 = makeTask('f3')
    workflow.groups.push(makeGroup('g-free-2', [sib3]))
    await nextTick()

    await clickButtonNamed('Add worker after all 3')
    expect(wrapper.emitted('add')?.[3]?.[0]).toEqual({ joinAll: null })

    // Removing a task with downstream children removes both from the workflow and emits close.
    workflow.groups = [makeGroup('g-chain', [taskA, taskB])]
    await wrapper.setProps({ task: taskA })
    await clickButtonNamed('Remove')

    expect(workflow.groups[0]?.tasks.map((t) => t.id)).toEqual(['b'])
    expect(wrapper.emitted('close')).toHaveLength(1)
  })

  it('links input via file parent, distinguishes unloaded outputs, and ignores failed remove', async () => {
    // Workflow folder 300 is NOT in itemsStore, while input file 55 IS loaded with parent 77.
    useItemsStore().upsertItems([makeFile(55, 'evidence.E01', 2048, 77)])
    const doneWithUnloaded = makeTask('u1', {
      status: 'success',
      duration: 8,
      outputs: [901, 902],
    })
    seedWorkflow({
      id: 6,
      folderId: 300,
      name: 'Unloaded outputs',
      created: '2026-11-01T00:00:00Z',
      inputs: [{ id: 55, name: 'evidence.E01' }],
      groups: [makeGroup('gu', [doneWithUnloaded])],
      draft: false,
    })

    const { wrapper } = mountInspector({ task: doneWithUnloaded, folderId: 300 })
    expect(wrapper.get('section[aria-label="Ran on"] a').attributes('href')).toBe(
      '/folder/77/file/55',
    )
    expect(wrapper.get('section[aria-label="Outputs"]').text()).toContain(
      '2 output files (not loaded)',
    )
    expect(wrapper.get('section[aria-label="Outputs"]').text()).not.toContain('None.')

    // Remove button does not emit close when removeTask cannot remove (non-draft / missing).
    const orphanDraftTask = makeTask('ghost-t')
    await wrapper.setProps({ task: orphanDraftTask, editable: true })
    const removeBtn = wrapper.findAll('button').find((b) => b.text().includes('Remove'))!
    await removeBtn.trigger('click')
    expect(wrapper.emitted('close')).toBeUndefined()
  })
})
