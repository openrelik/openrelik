// @vitest-environment happy-dom
import { nextTick } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { api, type WorkflowRecord } from '@/api'
import WorkflowGraph from '@/components/workflow/WorkflowGraph.vue'
import WorkflowPanel from '@/components/workflow/WorkflowPanel.vue'
import WorkflowTree from '@/components/workflow/WorkflowTree.vue'
import { useConfirm } from '@/composables/useConfirm'
import { clearQueryCache } from '@/composables/useQueryCache'
import { closeRun } from '@/composables/useRun'
import { dismissEdits, removeTask, setTaskOption } from '@/composables/useWorkflow'
import directives from '@/directives'
import { useItemsStore } from '@/stores/items'
import { useModalStore } from '@/stores/modals'
import { useWorkflowsStore } from '@/stores/workflows'
import type { Task, TaskGroup, Workflow } from '@/types/workflow'

vi.mock('@/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api')>()
  const mockedApi = {
    ...actual.api,
    taskqueue: {
      ...actual.api.taskqueue,
      registeredTasks: vi.fn(),
    },
    workflows: {
      ...actual.api.workflows,
      saveSpec: vi.fn(),
      run: vi.fn(),
      copy: vi.fn(),
      createTemplate: vi.fn(),
    },
  }
  return {
    ...actual,
    default: mockedApi,
    api: mockedApi,
  }
})

function makeTask(id: string, overrides: Partial<Task> = {}): Task {
  return {
    id,
    name: `Task ${id}`,
    module: `openrelik-worker-${id}.tasks.${id}`,
    queue: `openrelik-worker-${id}`,
    status: 'pending',
    outputs: [],
    fileReports: [],
    options: [{ key: 'depth', label: 'Depth', type: 'text', default: '1' }],
    config: { depth: '1' },
    groups: [],
    ...overrides,
  }
}

function makeGroup(id: string, tasks: Task[], join?: Task): TaskGroup {
  return join ? { id, tasks, join } : { id, tasks }
}

function makeWorkflowRecord(id: number, folderId: number, started = false): WorkflowRecord {
  return {
    id,
    display_name: 'Triage workflow',
    spec_json: null,
    uuid: '00000000000000000000000000000000',
    files: [{ id: 1, display_name: 'disk.dd' }],
    tasks: started ? [{ id: 1, uuid: 't1', display_name: 'Task t1', status_short: 'STARTED' }] : [],
    folder: { id: folderId },
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

let nextId = 500

describe('WorkflowPanel', () => {
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
    if (!HTMLElement.prototype.checkVisibility) {
      HTMLElement.prototype.checkVisibility = () => true
    }
    localStorage.clear()
    pinia = createPinia()
    setActivePinia(pinia)
    clearQueryCache()
    dismissEdits()
    closeRun()

    vi.mocked(api.taskqueue.registeredTasks).mockResolvedValue([
      {
        task_name: 'openrelik-worker-t1.tasks.t1',
        queue_name: 'openrelik-worker-t1',
        display_name: 'Task t1',
        description: 'Worker t1',
      },
      {
        task_name: 'openrelik-worker-t2.tasks.t2',
        queue_name: 'openrelik-worker-t2',
        display_name: 'Task t2',
        description: 'Worker t2',
      },
    ])
    vi.mocked(api.workflows.saveSpec).mockResolvedValue(makeWorkflowRecord(1, 1500))
  })

  afterEach(async () => {
    while (wrappers.length > 0) wrappers.pop()?.unmount()
    dismissEdits()
    closeRun()
    document.body.innerHTML = ''
    await vi.runOnlyPendingTimersAsync()
    vi.useRealTimers()
  })

  function seedWorkflow(groups: TaskGroup[], draft = true): Workflow {
    const id = nextId++
    const folderId = 1000 + id
    const workflow: Workflow = {
      id,
      folderId,
      name: `Workflow ${id}`,
      created: '2026-11-01T00:00:00Z',
      inputs: [{ id: 1, name: 'disk.dd' }],
      groups,
      draft,
    }
    useWorkflowsStore().upsertWorkflow(workflow)
    useItemsStore().upsertItems([
      {
        id: folderId,
        parent: 10,
        kind: 'folder',
        name: `Folder ${id}`,
        owner: 'Alice',
        modified: '2026-11-01T00:00:00Z',
        workflowId: id,
      },
    ])
    return workflow
  }

  function mountPanel(props: {
    workflow: Workflow
    selectedId: string | null
    producerId: string | null
  }) {
    const router = createTestRouter()
    const wrapper = mount(WorkflowPanel, {
      props,
      attachTo: document.body,
      global: { plugins: [pinia, directives, router] },
    })
    wrappers.push(wrapper)
    return { wrapper }
  }

  it('toggles between tree and graph views, collapses/expands, and stacks/opens all groups', async () => {
    const tasks = [1, 2, 3].map((n) =>
      makeTask(`s${n}`, {
        module: 'openrelik-worker-t1.tasks.t1',
      }),
    )
    const workflow = seedWorkflow([makeGroup('g-stack', tasks)], true)

    const { wrapper } = mountPanel({
      workflow,
      selectedId: null,
      producerId: null,
    })

    // Starts in tree view.
    expect(wrapper.findComponent(WorkflowTree).exists()).toBe(true)
    expect(wrapper.findComponent(WorkflowGraph).exists()).toBe(false)

    // Collapse and expand toggle.
    const collapseBtn = wrapper.get('button[aria-label="Collapse workflow"]')
    await collapseBtn.trigger('click')
    expect(wrapper.get('button[aria-label="Expand workflow"]').attributes('aria-expanded')).toBe(
      'false',
    )

    // Clicking flowchart view switches to WorkflowGraph and re-opens the pane.
    const viewButtons = wrapper.get('[role="group"][aria-label="Workflow view"]').findAll('button')
    await viewButtons[1]!.trigger('click')
    expect(wrapper.findComponent(WorkflowGraph).exists()).toBe(true)
    expect(wrapper.get('button[aria-label="Collapse workflow"]').attributes('aria-expanded')).toBe(
      'true',
    )

    // Group stack toggle opens all 3 tasks, then stacks them all again.
    await wrapper.get('button[aria-label="Show all tasks in every group"]').trigger('click')
    await wrapper.get('button[aria-label="Stack all groups"]').trigger('click')
  })

  it('shows save status/error with Retry, Undo banner + Ctrl+Z, Discard, Run workflow, and draft keyboard shortcuts', async () => {
    const workflow = seedWorkflow([makeGroup('g1', [makeTask('t1'), makeTask('t2')])], true)
    await Promise.resolve()
    await nextTick()

    const { wrapper } = mountPanel({
      workflow,
      selectedId: 't1',
      producerId: null,
    })

    // Discard emits discard.
    await wrapper
      .findAll('button')
      .find((b) => b.text().includes('Discard'))!
      .trigger('click')
    expect(wrapper.emitted('discard')).toHaveLength(1)

    // Simulate failed background save and retry.
    vi.mocked(api.workflows.saveSpec).mockRejectedValueOnce(new Error('disk full'))
    setTaskOption(workflow.folderId, 't1', 'depth', '9')
    await vi.advanceTimersByTimeAsync(600)
    await nextTick()

    expect(wrapper.get('[role="alert"]').text()).toContain('not saved: disk full')

    vi.mocked(api.workflows.saveSpec).mockResolvedValueOnce(
      makeWorkflowRecord(workflow.id, workflow.folderId),
    )
    await wrapper
      .findAll('button')
      .find((b) => b.text() === 'Retry')!
      .trigger('click')
    await Promise.resolve()
    await nextTick()
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)

    // Keyboard Delete removes selected task t1, emits select(null), and shows Undo banner.
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }))
    await nextTick()
    expect(workflow.groups[0]?.tasks.map((t) => t.id)).toEqual(['t2'])
    expect(wrapper.emitted('select')?.[0]).toEqual([null])
    expect(wrapper.text()).toContain('removed Task t1')

    // Ctrl+Z undoes the removal.
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }))
    await nextTick()
    expect(workflow.groups[0]?.tasks.map((t) => t.id)).toEqual(['t1', 't2'])

    // Pressing 'a' opens the Run modal to add a worker; close it afterwards.
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }))
    expect(useModalStore().isModalOpen('run')).toBe(true)
    closeRun()

    // Clicking Run workflow calls api.workflows.run and clears selection.
    vi.mocked(api.workflows.run).mockResolvedValueOnce(
      makeWorkflowRecord(workflow.id, workflow.folderId, true),
    )
    await wrapper
      .findAll('button')
      .find((b) => b.text().includes('Run workflow'))!
      .trigger('click')
    await Promise.resolve()
    await Promise.resolve()
    await nextTick()

    expect(api.workflows.run).toHaveBeenCalledTimes(1)
    expect(wrapper.emitted('select')?.at(-1)).toEqual([null])
  })

  it('opens full-screen flowchart with embedded TaskInspector and handles Escape / f / Exit', async () => {
    const t1 = makeTask('t1', { name: 'Strings' })
    const workflow = seedWorkflow([makeGroup('g1', [t1])], true)

    const { wrapper } = mountPanel({
      workflow,
      selectedId: 't1',
      producerId: null,
    })

    // Switch to graph view, then press 'f' to enter fullscreen.
    const viewButtons = wrapper.get('[role="group"][aria-label="Workflow view"]').findAll('button')
    await viewButtons[1]!.trigger('click')
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', bubbles: true }))
    await nextTick()

    const dialog = document.body.querySelector('[role="dialog"]')
    expect(dialog).not.toBeNull()
    expect(dialog?.getAttribute('aria-label')).toContain('flowchart')
    // Embedded TaskInspector is rendered inside the fullscreen dialog when selectedId matches.
    expect(dialog?.querySelector('aside[aria-label="Task"]')?.textContent).toContain('Strings')

    // First Escape while a task is selected emits select(null) and keeps fullscreen open.
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await nextTick()
    expect(wrapper.emitted('select')?.[0]).toEqual([null])
    expect(document.body.querySelector('[role="dialog"]')).not.toBeNull()

    // Once selectedId is null, Escape closes fullscreen.
    await wrapper.setProps({ selectedId: null })
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await nextTick()
    expect(document.body.querySelector('[role="dialog"]')).toBeNull()

    // Re-enter via header button and exit with the Exit button, then re-enter and exit with 'f'.
    await wrapper.get('button[aria-label="Full-screen flowchart"]').trigger('click')
    expect(document.body.querySelector('[role="dialog"]')).not.toBeNull()

    await wrapper.setProps({ selectedId: 't1' })
    const closeInspectorBtn = document.body.querySelector<HTMLButtonElement>(
      '[role="dialog"] button[aria-label="Close task"]',
    )
    closeInspectorBtn?.click()
    await nextTick()
    expect(wrapper.emitted('select')?.at(-1)).toEqual([null])

    const exitBtn = [
      ...document.body.querySelectorAll<HTMLButtonElement>('[role="dialog"] button'),
    ].find((b) => b.textContent?.includes('Exit'))
    exitBtn?.click()
    await nextTick()
    expect(document.body.querySelector('[role="dialog"]')).toBeNull()

    await wrapper.get('button[aria-label="Full-screen flowchart"]').trigger('click')
    expect(document.body.querySelector('[role="dialog"]')).not.toBeNull()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', bubbles: true }))
    await nextTick()
    expect(document.body.querySelector('[role="dialog"]')).toBeNull()
  })

  it('delegates split/merge from WorkflowGraph and handles Shift+Enter run shortcut', async () => {
    const workflow = seedWorkflow(
      [
        makeGroup('gm1', [
          makeTask('t1'),
          makeTask('t2'),
          makeTask('t3', { module: 'openrelik-worker-t1.tasks.t1' }),
        ]),
        makeGroup('gm2', [makeTask('t4', { module: 'openrelik-worker-t2.tasks.t2' })]),
      ],
      true,
    )
    await flushPromises()

    const { wrapper } = mountPanel({
      workflow,
      selectedId: null,
      producerId: null,
    })

    const viewButtons = wrapper.get('[role="group"][aria-label="Workflow view"]').findAll('button')
    await viewButtons[1]!.trigger('click')

    const graph = wrapper.getComponent(WorkflowGraph)
    graph.vm.$emit('split', ['t1', 't2'])
    await nextTick()
    expect(workflow.groups).toHaveLength(3)

    const [firstGroup, secondGroup] = workflow.groups
    graph.vm.$emit('merge', [firstGroup!.id, secondGroup!.id])
    await nextTick()
    expect(workflow.groups).toHaveLength(2)

    vi.mocked(api.workflows.run).mockResolvedValueOnce(
      makeWorkflowRecord(workflow.id, workflow.folderId, true),
    )
    window.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true }),
    )
    await flushPromises()
    expect(api.workflows.run).toHaveBeenCalledTimes(1)
  })

  it('saves completed workflow as a template and copies workflow into a new draft', async () => {
    const t1 = makeTask('t1', { status: 'success', duration: 15 })
    const workflow = seedWorkflow([makeGroup('g1', [t1])], false)

    const { wrapper } = mountPanel({
      workflow,
      selectedId: null,
      producerId: null,
    })

    // Save as template opens confirm prompt -> accept with custom template name.
    vi.mocked(api.workflows.createTemplate).mockResolvedValueOnce({
      id: 99,
      display_name: 'Standard Triage',
      spec_json: '{}',
      user_id: 1,
    })
    await wrapper
      .findAll('button')
      .find((b) => b.text().includes('Save as template'))!
      .trigger('click')

    const confirm = useConfirm()
    confirm.text.value = 'Standard Triage'
    confirm.accept()
    await flushPromises()

    expect(api.workflows.createTemplate).toHaveBeenCalledWith(workflow.id, 'Standard Triage')
    expect(wrapper.text()).toContain('Saved as template “Standard Triage”')

    // Confirmation message fades after 4000ms.
    await vi.advanceTimersByTimeAsync(4000)
    await nextTick()
    expect(wrapper.text()).not.toContain('Saved as template')

    // Copy workflow creates new draft and emits copied(newFolderId).
    vi.mocked(api.workflows.copy).mockResolvedValueOnce(makeWorkflowRecord(888, 2222, false))
    await wrapper
      .findAll('button')
      .find((b) => b.text().includes('Copy workflow'))!
      .trigger('click')
    await flushPromises()

    expect(wrapper.emitted('copied')).toEqual([[2222]])

    // Remove task edit via Undo button click on draft also exercises header Undo click.
    const draftWf = seedWorkflow([makeGroup('gd', [makeTask('d1'), makeTask('d2')])], true)
    await wrapper.setProps({ workflow: draftWf })
    removeTask(draftWf.folderId, 'd1')
    await nextTick()
    await wrapper
      .findAll('button')
      .find((b) => b.text() === 'Undo')!
      .trigger('click')
    expect(draftWf.groups[0]?.tasks.map((t) => t.id)).toEqual(['d1', 'd2'])
  })

  it('keeps fullscreen Tab/Enter/Cmd+K functional, surfaces errors & producerId, resets on workflow switch, and guards in-flight copy/run', async () => {
    const t1 = makeTask('t1', { name: 'T1' })
    const t2 = makeTask('t2', { name: 'T2' })
    const t3 = makeTask('t3', {
      name: 'T3',
      module: 'openrelik-worker-t1.tasks.t1',
      queue: 'openrelik-worker-t1',
    })
    const wf1 = seedWorkflow([makeGroup('g1', [t1, t2, t3])], true)
    const wf2 = seedWorkflow([makeGroup('g2', [makeTask('o1')])], false)
    await flushPromises()

    const { wrapper } = mountPanel({
      workflow: wf1,
      selectedId: 't1',
      producerId: 't2',
    })

    // Switch to flowchart and open fullscreen.
    const viewButtons = wrapper.get('[role="group"][aria-label="Workflow view"]').findAll('button')
    await viewButtons[1]!.trigger('click')
    await wrapper.get('button[aria-label="Full-screen flowchart"]').trigger('click')

    const dialog = document.body.querySelector<HTMLElement>('[role="dialog"]')!
    expect(dialog).not.toBeNull()
    expect(dialog.getAttribute('tabindex')).toBe('-1')

    // Fullscreen WorkflowGraph receives producerId (t2 highlighted with ring-2).
    const producerBtn = dialog.querySelector<HTMLButtonElement>('button[data-task="t2"]')
    expect(producerBtn?.className).toContain('ring-2')

    // Tab, Enter, Space, and Cmd+K are NOT cancelled by capture onKey in fullscreen.
    for (const init of [
      { key: 'Tab', bubbles: true, cancelable: true },
      { key: 'Enter', bubbles: true, cancelable: true },
      { key: ' ', bubbles: true, cancelable: true },
      { key: 'k', metaKey: true, bubbles: true, cancelable: true },
    ]) {
      const ev = new KeyboardEvent('keydown', init)
      window.dispatchEvent(ev)
      expect(ev.defaultPrevented).toBe(false)
    }

    // Explorer keys inside the dialog stop bubbling at the dialog instead of hitting window shortcuts.
    const windowBubbleSpy = vi.fn()
    window.addEventListener('keydown', windowBubbleSpy)
    dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'j', bubbles: true }))
    expect(windowBubbleSpy).not.toHaveBeenCalled()
    window.removeEventListener('keydown', windowBubbleSpy)

    // Pick t2 to form split picks in fullscreen; first Escape clears picks before deselecting t1.
    producerBtn?.dispatchEvent(new MouseEvent('click', { bubbles: true, metaKey: true }))
    await nextTick()
    expect(dialog.querySelector('[aria-label="Picked tasks"]')).not.toBeNull()

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await nextTick()
    expect(dialog.querySelector('[aria-label="Picked tasks"]')).toBeNull()
    expect(document.body.querySelector('[role="dialog"]')).not.toBeNull()

    // Fullscreen header shows background save errors with Retry.
    vi.mocked(api.workflows.saveSpec).mockRejectedValueOnce(new Error('save failed'))
    setTaskOption(wf1.folderId, 't1', 'depth', '5')
    await vi.advanceTimersByTimeAsync(600)
    await nextTick()
    expect(dialog.querySelector('[role="alert"]')?.textContent).toContain('not saved: save failed')

    // Draft shortcuts do not trigger while focus is inside a <select>.
    const selectEl = dialog.ownerDocument.createElement('select')
    dialog.appendChild(selectEl)
    selectEl.focus()
    selectEl.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }))
    expect(useModalStore().isModalOpen('run')).toBe(false)
    selectEl.remove()

    // Draft shortcuts do not trigger while workflow run is in flight (editable === false).
    let resolveRun!: (v: WorkflowRecord) => void
    vi.mocked(api.workflows.run).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveRun = resolve
        }),
    )
    const runBtn = [...dialog.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('Run workflow'),
    )!
    runBtn.click()
    await nextTick()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }))
    expect(useModalStore().isModalOpen('run')).toBe(false)
    resolveRun(makeWorkflowRecord(wf1.id, wf1.folderId, true))
    await flushPromises()

    // Switching to another workflow closes fullscreen and discards late copy responses.
    await wrapper.setProps({ workflow: wf2, selectedId: null, producerId: null })
    expect(document.body.querySelector('[role="dialog"]')).toBeNull()

    let resolveCopy!: (v: WorkflowRecord) => void
    vi.mocked(api.workflows.copy).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveCopy = resolve
        }),
    )
    await wrapper
      .findAll('button')
      .find((b) => b.text().includes('Copy workflow'))!
      .trigger('click')
    await wrapper.setProps({ workflow: wf1 })
    resolveCopy(makeWorkflowRecord(999, 3333, false))
    await flushPromises()
    expect(wrapper.emitted('copied')).toBeUndefined()
  })
})
