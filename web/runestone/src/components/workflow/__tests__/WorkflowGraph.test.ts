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
import { mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import WorkflowGraph from '@/components/workflow/WorkflowGraph.vue'
import { useGroupStacks } from '@/composables/useGroupStacks'
import directives from '@/directives'
import { useItemsStore } from '@/stores/items'
import { useModalStore } from '@/stores/modals'
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

let nextWfId = 100

function makeWorkflow(overrides: Partial<Workflow> = {}): Workflow {
  const id = nextWfId++
  return {
    id,
    folderId: 1000 + id,
    name: `Graph Workflow ${id}`,
    created: '2026-11-01T00:00:00Z',
    inputs: [{ id: 1, name: 'evidence.dd' }],
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

describe('WorkflowGraph', () => {
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
    if (!HTMLElement.prototype.checkVisibility) {
      HTMLElement.prototype.checkVisibility = () => true
    }
    pinia = createPinia()
    setActivePinia(pinia)
  })

  afterEach(() => {
    while (wrappers.length > 0) wrappers.pop()?.unmount()
  })

  function mountGraph(props: {
    workflow: Workflow
    selectedId: string | null
    producerId?: string | null
    capped: boolean
    fill?: boolean
    editable?: boolean
  }) {
    const router = createTestRouter()
    const wrapper = mount(WorkflowGraph, {
      props,
      attachTo: document.body,
      global: { plugins: [pinia, directives, router] },
    })
    wrappers.push(wrapper)
    return { wrapper }
  }

  it('renders single input node, DAG task nodes, SVG edges, node facts, and chord join', async () => {
    useItemsStore().upsertItems([
      {
        id: 1,
        parent: 10,
        kind: 'file',
        name: 'evidence.dd',
        owner: 'Alice',
        modified: '2026-11-01T00:00:00Z',
        size: 4096,
      },
      {
        id: 50,
        parent: 1001,
        kind: 'file',
        name: 'out.txt',
        owner: 'Alice',
        modified: '2026-11-01T00:00:00Z',
        size: 128,
      },
      {
        id: 51,
        parent: 1001,
        kind: 'file',
        name: 'empty.txt',
        owner: 'Alice',
        modified: '2026-11-01T00:00:00Z',
        size: 0,
      },
    ])

    const t1 = makeTask('t1', {
      name: 'Strings',
      status: 'success',
      duration: 30,
      outputs: [50, 51],
    })
    const t2 = makeTask('t2', { name: 'YARA', status: 'running', duration: 8 })
    const join = makeTask('j1', { name: 'Report', status: 'pending' })
    const afterJoin = makeTask('after-j', { name: 'Cleanup', status: 'skipped' })
    join.groups = [makeGroup('g-after', [afterJoin])]

    const workflow = makeWorkflow({
      groups: [makeGroup('g-chord', [t1, t2], join)],
      draft: false,
    })

    const { wrapper } = mountGraph({
      workflow,
      selectedId: null,
      producerId: 't2',
      capped: true,
    })

    expect(wrapper.find('a[href="/folder/10/file/1"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('4.10 kB')
    expect(wrapper.text()).toContain('30s · 2 out (1 empty)')
    expect(wrapper.text()).toContain('running · 8s')
    expect(wrapper.find('[aria-label="waits for 2 lines"]').exists()).toBe(true)

    // SVG edges: 1 into boxed group + 2 out to join + 1 from join to afterJoin = 4 paths.
    expect(wrapper.findAll('svg path[marker-end]')).toHaveLength(4)

    // Selecting a node emits select(task), clicking empty canvas clears selection.
    await wrapper.get('button[data-task="t1"]').trigger('click')
    expect(wrapper.emitted('select')?.[0]?.[0]).toEqual(t1)

    await wrapper.get('.overflow-auto').trigger('click')
    expect(wrapper.emitted('select')?.[1]).toEqual([null])
  })

  it('stacks and expands multiple input files and large task groups', async () => {
    // 5 tasks of the same module (>= STACK_MIN=3) start stacked as "Strings ×5".
    const sameModuleTasks = [1, 2, 3, 4, 5].map((n) =>
      makeTask(`s${n}`, {
        name: 'Strings',
        module: 'openrelik-worker-strings.tasks.strings',
        status: n === 1 ? 'failed' : n === 2 ? 'running' : n === 3 ? 'skipped' : 'success',
      }),
    )

    const workflow = makeWorkflow({
      inputs: [
        { id: 11, name: 'f1.dd' },
        { id: 12, name: 'f2.dd' },
        { id: 13, name: 'f3.dd' },
        { id: 14, name: 'f4.dd' },
        { id: 15, name: 'f5.dd' },
      ],
      groups: [makeGroup('g-stack-1', sameModuleTasks)],
      draft: false,
    })

    useItemsStore().upsertItems([
      {
        id: workflow.folderId,
        parent: 10,
        kind: 'folder',
        name: workflow.name,
        owner: 'Alice',
        modified: '2026-11-01T00:00:00Z',
      },
      {
        id: 11,
        parent: 10,
        kind: 'file',
        name: 'f1.dd',
        owner: 'Alice',
        modified: '2026-11-01T00:00:00Z',
        size: 1024,
      },
    ])

    const { wrapper } = mountGraph({
      workflow,
      selectedId: null,
      capped: true,
    })

    // Inputs start stacked as one card ("5 files").
    const inputsStackBtn = wrapper.get('button[aria-label="5 input files. Show them"]')
    expect(inputsStackBtn.text()).toContain('5 files')
    await inputsStackBtn.trigger('click')

    // All 5 input links now render, and the corner toggle stacks them back.
    expect(wrapper.findAll('a')).toHaveLength(5)
    await wrapper.get('button[aria-label="Stack the 5 input files"]').trigger('click')
    expect(wrapper.findAll('a')).toHaveLength(0)

    // Task group starts stacked showing summary counts.
    expect(wrapper.text()).toContain('Strings')
    expect(wrapper.text()).toContain('×5')
    expect(wrapper.text()).toContain('2/5 done · 1 failed · 1 running')

    // Clicking the corner toggle expands all 5 tasks; clicking again stacks them back.
    await wrapper.get('button[aria-label="Show all tasks in this group"]').trigger('click')
    expect(wrapper.findAll('button[data-task]')).toHaveLength(5)

    await wrapper.get('button[aria-label="Stack the tasks in this group"]').trigger('click')
    expect(wrapper.findAll('button[data-task]')).toHaveLength(0)

    // Selecting a folded task from outside automatically opens its stack.
    await wrapper.setProps({ selectedId: 's1' })
    await nextTick()
    expect(wrapper.findAll('button[data-task]')).toHaveLength(5)

    // Restacking while selected highlights the stacked card.
    useGroupStacks().closeStack('g-stack-1')
    await nextTick()
    expect(wrapper.findAll('button[data-task]')).toHaveLength(0)
  })

  it('emits add (after, beside, join, joinAll) and remove actions in draft mode', async () => {
    const t1 = makeTask('t1', {
      name: 'Strings',
      options: [{ key: 'req', label: 'Rule', type: 'text', default: '', required: true }],
      config: {},
    })
    const t2 = makeTask('t2', { name: 'YARA' })

    const workflow = makeWorkflow({
      groups: [makeGroup('g-pair', [t1, t2])],
      draft: true,
    })

    const { wrapper } = mountGraph({
      workflow,
      selectedId: 't1',
      capped: true,
      editable: true,
    })

    expect(wrapper.text()).toContain('needs Rule')

    // Hover and click remove on t1.
    const nodeT1 = wrapper.get('button[data-task="t1"]')
    await nodeT1.trigger('pointerenter')
    await wrapper.get('button[aria-label="Remove Strings"]').trigger('click')
    expect(wrapper.emitted('remove')).toEqual([['t1']])

    // Add on inputs, after t1, beside t2, and after all 2 in g-pair.
    await wrapper.get('button[aria-label="Add worker after the inputs"]').trigger('click')
    expect(wrapper.emitted('add')?.[0]?.[0]).toEqual({ after: null })

    await wrapper.get('button[aria-label="Add worker after Strings"]').trigger('click')
    expect(wrapper.emitted('add')?.[1]?.[0]).toEqual({ after: 't1' })

    await wrapper.get('button[aria-label="Add worker beside YARA"]').trigger('click')
    expect(wrapper.emitted('add')?.[2]?.[0]).toEqual({ beside: 't2' })

    await wrapper
      .get('button[aria-label="Add worker after all 2 tasks in this group"]')
      .trigger('click')
    expect(wrapper.emitted('add')?.[3]?.[0]).toEqual({ join: 'g-pair' })

    // When multiple free sibling groups exist, renders fan ghost offering joinAll.
    const sibWorkflow = makeWorkflow({
      groups: [makeGroup('sg1', [makeTask('a1')]), makeGroup('sg2', [makeTask('a2')])],
      draft: true,
    })
    await wrapper.setProps({ workflow: sibWorkflow, selectedId: null })
    await wrapper
      .get('button[aria-label="Add worker after all 2 tasks after the inputs"]')
      .trigger('click')
    expect(wrapper.emitted('add')?.[4]?.[0]).toEqual({ joinAll: null })
  })

  it('supports modifier-clicking tasks to split, boxes to merge (or show refusal), and Escape to clear picks', async () => {
    const t1 = makeTask('t1', { name: 'T1' })
    const t2 = makeTask('t2', { name: 'T2' })
    const t3 = makeTask('t3', { name: 'T3' })
    const lone = makeTask('t4', { name: 'Lone' })

    const workflow = makeWorkflow({
      groups: [makeGroup('g-three', [t1, t2, t3]), makeGroup('g-lone', [lone])],
      draft: true,
    })
    // Ensure g-three is open so individual task buttons are rendered.
    useGroupStacks().openStack('g-three')

    const { wrapper } = mountGraph({
      workflow,
      selectedId: 't1',
      capped: true,
      editable: true,
    })

    // Meta-clicking t2 when t1 is already selected picks both [t1, t2] and shows Split offer.
    await wrapper.get('button[data-task="t2"]').trigger('click', { metaKey: true })
    const splitOffer = wrapper.get('[aria-label="Picked tasks"]')
    expect(splitOffer.text()).toContain('2 tasks selected')

    // Picking the 3rd task as well warns that the whole group is picked.
    await wrapper.get('button[data-task="t3"]').trigger('click', { metaKey: true })
    expect(wrapper.get('[aria-label="Picked tasks"]').text()).toContain('the whole group')

    // Unpicking t3 restores the Split button, which emits split(['t1', 't2']).
    await wrapper.get('button[data-task="t3"]').trigger('click', { metaKey: true })
    await wrapper
      .get('[aria-label="Picked tasks"]')
      .findAll('button')
      .find((b) => b.text().includes('Split into new group'))!
      .trigger('click')
    expect(wrapper.emitted('split')).toEqual([[['t1', 't2']]])

    // Click g-three's dashed box, then meta-click lone task (which picks its group g-lone) to merge.
    const dashedBox = wrapper.get('div.border-dashed')
    await dashedBox.trigger('click')
    await wrapper.get('button[data-task="t4"]').trigger('click', { shiftKey: true })

    const mergeOffer = wrapper.get('[aria-label="Picked groups"]')
    expect(mergeOffer.text()).toContain('2 groups selected')

    // Escape clears the picked groups before emitting merge.
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await nextTick()
    expect(wrapper.find('[aria-label="Picked groups"]').exists()).toBe(false)

    // Pick both groups again and click Merge groups.
    await dashedBox.trigger('click')
    await wrapper.get('button[data-task="t4"]').trigger('click', { ctrlKey: true })
    await wrapper
      .get('[aria-label="Picked groups"]')
      .findAll('button')
      .find((b) => b.text().includes('Merge groups'))!
      .trigger('click')
    expect(wrapper.emitted('merge')).toEqual([[['g-three', 'g-lone']]])

    // Two groups that both have joins show the refusal message instead of Merge button.
    const unmergeable = makeWorkflow({
      groups: [
        makeGroup('ja', [makeTask('x1'), makeTask('x2')], makeTask('jx')),
        makeGroup('jb', [makeTask('y1'), makeTask('y2')], makeTask('jy')),
      ],
      draft: true,
    })
    await wrapper.setProps({ workflow: unmergeable, selectedId: null })
    const boxes = wrapper.findAll('div.border-dashed')
    await boxes[0]!.trigger('click')
    await boxes[1]!.trigger('click', { metaKey: true })
    expect(wrapper.get('[aria-label="Picked groups"]').text()).toContain('Can’t merge')
  })

  it('handles zoom in, zoom out, reset, fit-to-view, fill auto-fit, and producer scroll', async () => {
    const workflow = makeWorkflow({
      groups: [makeGroup('g1', [makeTask('t1')])],
      draft: false,
    })

    const { wrapper } = mountGraph({
      workflow,
      selectedId: null,
      capped: true,
      fill: true,
    })

    const zoomGroup = wrapper.get('[role="group"][aria-label="Zoom"]')
    // Initial auto-fit on an unmeasured 0x0 container does not shrink scale to 30%.
    await nextTick()
    expect(wrapper.get('button[aria-label="Reset zoom to 100%"]').text()).toBe('100%')

    await wrapper.get('button[aria-label="Fit to view"]').trigger('click')
    expect(zoomGroup.text()).toContain('100%')

    const viewport = wrapper.get('.overflow-auto').element as HTMLElement
    Object.defineProperty(viewport, 'clientWidth', { value: 300, configurable: true })
    Object.defineProperty(viewport, 'clientHeight', { value: 200, configurable: true })

    await wrapper.get('button[aria-label="Fit to view"]').trigger('click')
    expect(zoomGroup.text()).not.toContain('100%')

    // Reset to 100% by clicking the percentage readout button.
    const readout = wrapper.get('button[aria-label="Reset zoom to 100%"]')
    await readout.trigger('click')
    expect(readout.text()).toBe('100%')

    await wrapper.get('button[aria-label="Zoom out"]').trigger('click')
    expect(readout.text()).toBe('90%')

    await wrapper.get('button[aria-label="Zoom in"]').trigger('click')
    expect(readout.text()).toBe('100%')

    // Updating producerId scrolls the viewport via scrollBy.
    const scrollSpy = vi.spyOn(viewport, 'scrollBy')
    await wrapper.setProps({ producerId: 't1' })
    await nextTick()
    expect(scrollSpy).toHaveBeenCalled()
  })

  it('gives each WorkflowGraph instance a distinct SVG arrow marker id within the same app', () => {
    const wf = makeWorkflow({ groups: [makeGroup('g1', [makeTask('t1')])] })
    const pinia = createPinia()
    setActivePinia(pinia)
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: '/:pathMatch(.*)*', component: { template: '<div />' } }],
    })
    const Dual = {
      components: { WorkflowGraph },
      setup: () => ({ wf }),
      template:
        '<div><WorkflowGraph :workflow="wf" :selected-id="null" :capped="true" /><WorkflowGraph :workflow="wf" :selected-id="null" :capped="false" /></div>',
    }
    const wrapper = mount(Dual, {
      global: {
        plugins: [pinia, router],
        directives: { tooltip: () => {} },
      },
    })
    const graphs = wrapper.findAllComponents(WorkflowGraph)
    expect(graphs).toHaveLength(2)
    const idA = graphs[0]!.get('marker').attributes('id')
    const idB = graphs[1]!.get('marker').attributes('id')
    expect(idA).toBeTruthy()
    expect(idB).toBeTruthy()
    expect(idA).not.toBe(idB)
    expect(graphs[0]!.get('path[marker-end]').attributes('marker-end')).toBe(`url(#${idA})`)
    expect(graphs[1]!.get('path[marker-end]').attributes('marker-end')).toBe(`url(#${idB})`)
  })

  it('respects active modals on Escape, prunes stale picks, skips broken input links, and finds non-CSS producer ids', async () => {
    const t1 = makeTask('t1', { name: 'T1' })
    const t2 = makeTask('t2', { name: 'T2' })
    const t3 = makeTask('t3', { name: 'T3' })
    const specialId = 'task:with"quotes[and]spaces'
    const tSpecial = makeTask(specialId, { name: 'Special' })
    const workflow = makeWorkflow({
      id: 201,
      folderId: 9999,
      // Unknown file & folder parent -> input must not render /folder/undefined/file/ links.
      inputs: [{ id: 8888, name: 'orphan.dd' }],
      groups: [makeGroup('g-three', [t1, t2, t3]), makeGroup('g-special', [tSpecial])],
      draft: true,
    })
    useGroupStacks().openStack('g-three')

    const { wrapper } = mountGraph({
      workflow,
      selectedId: 't1',
      capped: true,
      editable: true,
    })

    // No broken RouterLink rendered when parent folder is unknown.
    expect(wrapper.findAll('a')).toHaveLength(0)
    expect(wrapper.text()).toContain('orphan.dd')

    // Pick [t1, t2], then open a modal: Escape must NOT clear graph picks while modal is active.
    await wrapper.get('button[data-task="t2"]').trigger('click', { metaKey: true })
    expect(wrapper.find('[aria-label="Picked tasks"]').exists()).toBe(true)

    const modalStore = useModalStore()
    modalStore.openModal('help')
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await nextTick()
    expect(wrapper.find('[aria-label="Picked tasks"]').exists()).toBe(true)
    modalStore.closeModal('help')

    // Removing t2 leaves only t1 in picked and keeps Split offer honest; removing editable clears picks.
    await wrapper.setProps({
      workflow: makeWorkflow({
        id: 201,
        folderId: 9999,
        inputs: [{ id: 8888, name: 'orphan.dd' }],
        groups: [makeGroup('g-three', [t1, t3]), makeGroup('g-special', [tSpecial])],
        draft: true,
      }),
    })
    expect(wrapper.get('[aria-label="Picked tasks"]').text()).toContain('1 task selected')

    await wrapper.setProps({ editable: false })
    expect(wrapper.find('[aria-label="Picked tasks"]').exists()).toBe(false)

    // Non-CSS-identifier producerId scrolls cleanly via dataset lookup without querySelector syntax errors.
    const viewport = wrapper.get('.overflow-auto').element as HTMLElement
    const scrollSpy = vi.spyOn(viewport, 'scrollBy')
    await wrapper.setProps({ producerId: specialId })
    await nextTick()
    expect(scrollSpy).toHaveBeenCalled()
  })
})
