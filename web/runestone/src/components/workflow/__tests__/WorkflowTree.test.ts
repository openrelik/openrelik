// @vitest-environment happy-dom
import { nextTick } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import WorkflowTree from '@/components/workflow/WorkflowTree.vue'
import directives from '@/directives'
import { useItemsStore } from '@/stores/items'
import type { Task, TaskGroup, Workflow } from '@/types/workflow'

vi.mock('@/api')

function makeTask(id: string, overrides: Partial<Task> = {}): Task {
  return {
    id,
    name: `Task ${id}`,
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

function makeWorkflow(overrides: Partial<Workflow> = {}): Workflow {
  return {
    id: 1,
    folderId: 300,
    name: 'Analysis workflow',
    created: '2026-11-01T00:00:00Z',
    inputs: [{ id: 1, name: 'disk.dd' }],
    groups: [],
    draft: false,
    ...overrides,
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

describe('WorkflowTree', () => {
  let pinia: ReturnType<typeof createPinia>
  const wrappers: VueWrapper[] = []

  beforeEach(() => {
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
  })

  afterEach(() => {
    while (wrappers.length > 0) wrappers.pop()?.unmount()
  })

  function mountTree(props: {
    workflow: Workflow
    selectedId: string | null
    producerId?: string | null
    editable?: boolean
  }) {
    const router = createTestRouter()
    const wrapper = mount(WorkflowTree, {
      props,
      global: { plugins: [pinia, directives, router] },
    })
    wrappers.push(wrapper)
    return { wrapper }
  }

  it('renders empty draft state, input file link with size, and add-on-inputs button', async () => {
    useItemsStore().upsertItems([
      {
        id: 300,
        parent: 10,
        kind: 'folder',
        name: 'Workflow folder',
        owner: 'Alice',
        modified: '2026-11-01T00:00:00Z',
      },
      {
        id: 1,
        parent: 10,
        kind: 'file',
        name: 'disk.dd',
        owner: 'Alice',
        modified: '2026-11-01T00:00:00Z',
        size: 2048,
      },
    ])

    const workflow = makeWorkflow({
      inputs: [
        { id: 1, name: 'disk.dd' },
        { id: 2, name: 'unloaded.raw' },
      ],
      groups: [],
      draft: true,
    })

    const { wrapper } = mountTree({ workflow, selectedId: null, editable: true })

    expect(wrapper.text()).toContain('Empty workflow.')
    expect(wrapper.text()).toContain('2.05 kB')
    expect(wrapper.text()).toContain('–')
    expect(wrapper.find('a[href="/folder/10/file/1"]').exists()).toBe(true)

    // Only the last input row shows the add-worker button.
    const addInputBtns = wrapper.findAll('button[aria-label="Add worker on the inputs"]')
    expect(addInputBtns).toHaveLength(1)
    await addInputBtns[0]!.trigger('click')
    expect(wrapper.emitted('add')?.[0]?.[0]).toEqual({ after: null })
  })

  it('renders hierarchical tasks, parallel & waitsFor indicators, status badges, durations, and empty output counts', () => {
    useItemsStore().upsertItems([
      {
        id: 501,
        parent: 300,
        kind: 'file',
        name: 'out1.txt',
        owner: 'Alice',
        modified: '2026-11-01T00:00:00Z',
        size: 100,
      },
      {
        id: 502,
        parent: 300,
        kind: 'file',
        name: 'empty.txt',
        owner: 'Alice',
        modified: '2026-11-01T00:00:00Z',
        size: 0,
      },
    ])

    const child1 = makeTask('c1', { name: 'Child 1', status: 'pending' })
    const child2 = makeTask('c2', { name: 'Child 2', status: 'skipped' })
    const parent = makeTask('p1', {
      name: 'Strings',
      queue: 'openrelik-worker-strings',
      status: 'success',
      duration: 65,
      outputs: [501, 502],
      groups: [makeGroup('g-children', [child1, child2])],
    })
    const sibA = makeTask('s1', { name: 'YARA', status: 'running', duration: 10 })
    const sibB = makeTask('s2', { name: 'Plaso', status: 'failed' })
    const join = makeTask('j1', { name: 'Joiner', status: 'skipped' })

    const workflow = makeWorkflow({
      groups: [makeGroup('g1', [parent]), makeGroup('g2', [sibA, sibB], join)],
      draft: false,
    })

    const { wrapper } = mountTree({
      workflow,
      selectedId: 'p1',
      producerId: 's1',
    })

    expect(wrapper.text()).toContain('Strings')
    expect(wrapper.text()).toContain('strings')
    expect(wrapper.text()).not.toContain('openrelik-worker-strings')
    expect(wrapper.text()).toContain('⇉ 2')
    expect(wrapper.text()).toContain('1m 05s')
    expect(wrapper.text()).toContain('2 out (1 empty)')
    expect(wrapper.find('[aria-label="waits for 2 tasks"]').exists()).toBe(true)

    // Second sibling group's first row gets a dashed top separator.
    const sibARow = wrapper.get('tr[data-task="s1"]')
    expect(sibARow.attributes('style')).toContain('border-top')
    expect(sibARow.classes()).toContain('bg-brand-tint/50')

    const selectedRow = wrapper.get('tr[data-task="p1"]')
    expect(selectedRow.attributes('aria-selected')).toBe('true')
    expect(selectedRow.classes()).toContain('bg-brand-selected')
  })

  it('handles row selection, click-outside clearing, producer scrolling, and draft add/join/remove actions', async () => {
    const t1 = makeTask('t1', {
      name: 'Strings',
      options: [{ key: 'pat', label: 'Pattern', type: 'text', default: '', required: true }],
      config: {},
    })
    const t2 = makeTask('t2', { name: 'YARA' })
    // Chord group blocks chaining directly after its header tasks.
    const h1 = makeTask('h1', { name: 'Header 1' })
    const h2 = makeTask('h2', { name: 'Header 2' })
    const j1 = makeTask('j1', { name: 'Chord Join' })

    const workflow = makeWorkflow({
      groups: [makeGroup('g-free', [t1, t2]), makeGroup('g-chord', [h1, h2], j1)],
      draft: true,
    })

    const { wrapper } = mountTree({
      workflow,
      selectedId: 't1',
      producerId: null,
      editable: true,
    })

    // Required missing option warning in draft mode.
    expect(wrapper.text()).toContain('needs Pattern')

    // Selecting a row emits select(task).
    await wrapper.get('tr[data-task="t2"]').trigger('click')
    expect(wrapper.emitted('select')?.[0]?.[0]).toEqual(t2)

    // Clicking outside rows/buttons/links clears selection when selectedId is set.
    await wrapper.trigger('click')
    expect(wrapper.emitted('select')?.[1]).toEqual([null])

    // Add after t1 (chainable) and beside t2 (endsGroup).
    await wrapper.get('button[aria-label="Add worker after Strings"]').trigger('click')
    expect(wrapper.emitted('add')?.[0]?.[0]).toEqual({ after: 't1' })

    await wrapper.get('button[aria-label="Add worker beside YARA"]').trigger('click')
    expect(wrapper.emitted('add')?.[1]?.[0]).toEqual({ beside: 't2' })

    // Chord header tasks have no "Add worker after" button.
    expect(wrapper.find('button[aria-label="Add worker after Header 1"]').exists()).toBe(false)

    // Dashed join offer row for free multi-task group emits { join: 'g-free' }.
    await wrapper
      .get('button[aria-label="Add worker after all 2 tasks in this group"]')
      .trigger('click')
    expect(wrapper.emitted('add')?.[2]?.[0]).toEqual({ join: 'g-free' })

    // Remove button emits remove(taskId) without selecting the row.
    await wrapper.get('button[aria-label="Remove Strings"]').trigger('click')
    expect(wrapper.emitted('remove')).toEqual([['t1']])

    // Updating producerId scrolls the root container via scrollBy.
    const scrollSpy = vi.spyOn(wrapper.element as HTMLElement, 'scrollBy')
    await wrapper.setProps({ producerId: 't2' })
    await nextTick()
    expect(scrollSpy).toHaveBeenCalled()
  })
})
