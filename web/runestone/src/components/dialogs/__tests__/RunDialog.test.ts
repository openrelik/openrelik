// @vitest-environment happy-dom
import { nextTick } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'
import { createPinia, setActivePinia } from 'pinia'
import { DOMWrapper, flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import RunDialog from '@/components/dialogs/RunDialog.vue'
import directives from '@/directives'
import { ApiError, api, type RegisteredTask, type WorkflowRecord } from '@/api'
import { forgetRoles } from '@/composables/useFolderPermissions'
import { closeRun, openAddToWorkflow, openRun, runTarget } from '@/composables/useRun'
import { clearQueryCache } from '@/composables/useQueryCache'
import { useModalStore } from '@/stores/modals'
import { useWorkflowsStore } from '@/stores/workflows'
import type { Item } from '@/types/item'
import type { Workflow } from '@/types/workflow'

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
      create: vi.fn(),
      rename: vi.fn(),
      run: vi.fn(),
      get: vi.fn(),
      saveSpec: vi.fn(),
    },
    folders: {
      ...actual.api.folders,
      getMyFolderRole: vi.fn(),
      renameFolder: vi.fn(),
    },
  }
  return {
    ...actual,
    api: mockedApi,
    default: mockedApi,
  }
})

const pinia = createPinia()
setActivePinia(pinia)

let wrapper: VueWrapper | null = null

const REGISTERED_TASKS: RegisteredTask[] = [
  {
    task_name: 'openrelik-worker-strings.tasks.strings',
    queue_name: 'openrelik-worker-strings',
    display_name: 'Strings',
    description: 'Extract ASCII and Unicode strings',
    task_config: [{ name: 'min_len', label: 'Min length', type: 'text', value: '4' }],
  },
  {
    task_name: 'openrelik-worker-yara.tasks.yara',
    queue_name: 'openrelik-worker-yara',
    display_name: 'Yara Scan',
    description: 'Match Yara rules against files',
    task_config: [
      {
        name: 'rules',
        label: 'Yara rules',
        type: 'textarea',
        required: true,
        value: '',
        description: 'Paste Yara rule source',
      },
      {
        name: 'fast_mode',
        label: 'Fast mode',
        type: 'checkbox',
        value: false,
      },
      {
        name: 'preset',
        label: 'Preset',
        type: 'select',
        items: ['malware', 'webshells'],
        value: '',
      },
      {
        name: 'threads',
        label: 'Threads',
        type: 'text',
        value: '2',
      },
    ],
  },
]

const SAMPLE_FILE: Item = {
  id: 5,
  parent: 10,
  kind: 'file',
  name: 'disk.raw',
  owner: 'Jane',
  modified: '2026-11-11T00:00:00Z',
  size: 1024,
}

function makeWorkflowRecord(id = 50, folderId = 200): WorkflowRecord {
  return {
    id,
    display_name: 'Strings on disk.raw',
    spec_json: null,
    uuid: '00000000000000000000000000000000',
    files: [{ id: 5, display_name: 'disk.raw' }],
    tasks: [],
    folder: { id: folderId },
  }
}

function mountDialog(): DOMWrapper<HTMLElement> {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/', component: { template: '<div />' } }],
  })
  wrapper = mount(RunDialog, {
    attachTo: document.body,
    global: {
      plugins: [pinia, directives, router],
    },
  })
  return new DOMWrapper(document.body)
}

beforeEach(() => {
  Object.defineProperty(AbortController.prototype, Symbol.toStringTag, {
    value: 'AbortController',
    configurable: true,
  })
  setActivePinia(pinia)
  vi.useFakeTimers()
  clearQueryCache()
  forgetRoles()
  closeRun()
  useModalStore().closeAllModals()
  useWorkflowsStore().forgetWorkflows()

  vi.mocked(api.taskqueue.registeredTasks).mockResolvedValue(REGISTERED_TASKS)
  vi.mocked(api.workflows.create).mockResolvedValue(makeWorkflowRecord())
  vi.mocked(api.workflows.rename).mockResolvedValue(makeWorkflowRecord())
  vi.mocked(api.folders.getMyFolderRole).mockResolvedValue('Owner')
  vi.mocked(api.folders.renameFolder).mockResolvedValue({
    id: 200,
    uuid: 'u-200',
    display_name: 'Strings on disk.raw',
    parent: null,
  })
  vi.mocked(api.workflows.run).mockResolvedValue({
    ...makeWorkflowRecord(),
    tasks: [
      {
        id: 1,
        uuid: '11111111111111111111111111111111',
        display_name: 'Strings',
        status_short: 'SUCCESS',
      },
    ],
  })
  vi.mocked(api.workflows.saveSpec).mockResolvedValue(makeWorkflowRecord())
})

afterEach(() => {
  closeRun()
  useModalStore().closeAllModals()
  wrapper?.unmount()
  wrapper = null
  document.body.innerHTML = ''
  clearQueryCache()
  forgetRoles()
  vi.useRealTimers()
})

describe('RunDialog', () => {
  it('handles initial loading error + retry and empty workers state', async () => {
    vi.mocked(api.taskqueue.registeredTasks).mockRejectedValueOnce(
      new ApiError({ status: 0, statusText: 'Network Error', message: 'Offline' }),
    )

    const body = mountDialog()
    openRun([SAMPLE_FILE], 10)
    await nextTick()
    await flushPromises()

    const dialog = body.get('[role="dialog"]')
    expect(dialog.attributes('aria-label')).toBe('Run a worker')
    expect(dialog.text()).toContain('run on')
    expect(dialog.text()).toContain('disk.raw')
    expect(dialog.get('[role="alert"]').text()).toContain('Could not load workers: Offline')

    vi.mocked(api.taskqueue.registeredTasks).mockResolvedValueOnce([])
    await dialog.get('[role="alert"] button').trigger('click')
    await flushPromises()
    expect(dialog.text()).toContain('No workers are online.')

    await body.get('[aria-hidden="true"]').trigger('pointerdown')
    expect(runTarget.value).toBeNull()
  })

  it('filters workers, navigates with keyboard, opens optional config with Tab, and runs a quick task', async () => {
    const body = mountDialog()
    openRun([SAMPLE_FILE], 10)
    await nextTick()
    await flushPromises()

    const input = body.get('input[aria-label="Filter workers"]')
    expect(body.findAll('[role="option"]')).toHaveLength(2)

    // Filter with no matches
    await input.setValue('nonexistent')
    expect(body.text()).toContain('no worker matches')

    // Filter matching Strings
    await input.setValue('ascii')
    expect(body.findAll('[role="option"]')).toHaveLength(1)
    expect(body.get('[role="option"]').text()).toContain('Strings')

    // Clear filter and navigate with ArrowDown / ArrowUp / ignored key
    await input.setValue('')
    await input.trigger('keydown', { key: 'ArrowDown' })
    expect(body.findAll('[role="option"]')[1]!.attributes('aria-selected')).toBe('true')

    await input.trigger('keydown', { key: 'ArrowUp' })
    expect(body.findAll('[role="option"]')[0]!.attributes('aria-selected')).toBe('true')

    await input.trigger('keydown', { key: 'Home' })

    // Tab opens options for Strings even though none are required; Escape returns to list
    await input.trigger('keydown', { key: 'Tab' })
    expect(body.find('[role="listbox"]').exists()).toBe(false)

    const optionsPane = body.get('.overflow-y-auto')
    await optionsPane.trigger('keydown', { key: 'Home' })
    await optionsPane.trigger('keydown', { key: 'Escape' })
    expect(body.find('[role="listbox"]').exists()).toBe(true)

    // Pressing Enter on Strings runs immediately with default options
    await input.trigger('keydown', { key: 'Enter' })
    await flushPromises()

    expect(api.workflows.create).toHaveBeenCalledWith(10, [5], undefined)
    expect(api.workflows.run).toHaveBeenCalled()
    expect(runTarget.value).toBeNull()
  })

  it('opens config form for required options, edits checkbox/select/textarea/text, blocks until valid, and submits on Cmd+Enter', async () => {
    const body = mountDialog()
    openRun([SAMPLE_FILE], 10)
    await nextTick()
    await flushPromises()

    const options = body.findAll('[role="option"]')
    await options[1]!.trigger('pointermove')
    // Clicking Yara Scan opens config instead of running because `rules` is required
    await options[1]!.trigger('click')

    expect(body.text()).toContain('Yara Scan')
    expect(body.text()).toContain('fill in Yara rules')

    const checkbox = body.get('input[type="checkbox"]')
    const select = body.get('select')
    const textarea = body.get('textarea')
    const textInputs = body.findAll('input[type="text"]')
    const threadsInput = textInputs[textInputs.length - 1]!

    // Enter while required field is empty does not submit
    await threadsInput.trigger('keydown', { key: 'Enter' })
    expect(api.workflows.create).not.toHaveBeenCalled()

    // Update checkbox, select, text, and textarea
    await checkbox.setValue(true)
    await select.setValue('malware')
    await threadsInput.setValue('8')
    await textarea.setValue('rule test { condition: true }')

    expect(body.text()).not.toContain('fill in Yara rules')

    // Plain Enter inside textarea inserts newline instead of submitting
    await textarea.trigger('keydown', { key: 'Enter' })
    expect(api.workflows.create).not.toHaveBeenCalled()

    // Meta+Enter inside textarea submits configured worker
    await textarea.trigger('keydown', { key: 'Enter', metaKey: true })
    await flushPromises()

    expect(api.workflows.create).toHaveBeenCalledWith(10, [5], undefined)
    expect(runTarget.value).toBeNull()
  })

  it('adds workers into a draft workflow across placing modes and positions anchored popovers', async () => {
    const body = mountDialog()
    const workflowsStore = useWorkflowsStore()

    const draft: Workflow = {
      id: 7,
      folderId: 300,
      name: 'Draft',
      created: '2026-11-11T00:00:00Z',
      inputs: [{ id: 5, name: 'disk.raw' }],
      groups: [
        {
          id: 'g1',
          tasks: [
            {
              id: 't1',
              name: 'Strings',
              module: 'openrelik-worker-strings.tasks.strings',
              queue: 'openrelik-worker-strings',
              status: 'pending',
              outputs: [],
              fileReports: [],
              options: [],
              config: {},
              groups: [],
            },
            {
              id: 't2',
              name: 'Hashes',
              module: 'openrelik-worker-hashes.tasks.hashes',
              queue: 'openrelik-worker-hashes',
              status: 'pending',
              outputs: [],
              fileReports: [],
              options: [],
              config: {},
              groups: [],
            },
          ],
        },
      ],
      draft: true,
    }
    workflowsStore.upsertWorkflow(draft)

    // 1. Add beside (dialog mode, no anchor)
    openAddToWorkflow(draft, { beside: 't1' })
    await nextTick()
    await flushPromises()
    expect(body.get('[role="dialog"]').attributes('aria-label')).toBe('Add a worker')
    expect(body.text()).toContain('add beside')
    expect(body.text()).toContain('runs in parallel with it, on the same input')

    await body.get('input[aria-label="Filter workers"]').trigger('keydown', { key: 'Escape' })
    expect(runTarget.value).toBeNull()

    // 2. Add join (no anchor) -> check join header & footer, then with upper-left anchor -> `top:`
    openAddToWorkflow(draft, { join: 'g1' })
    await nextTick()
    expect(body.text()).toContain('add after all of')
    expect(body.text()).toContain('runs once they have all finished, on all their outputs')
    closeRun()
    await nextTick()

    Object.defineProperty(window, 'innerWidth', { value: 1200, configurable: true })
    Object.defineProperty(window, 'innerHeight', { value: 800, configurable: true })
    openAddToWorkflow(draft, { join: 'g1' }, { left: 100, right: 124, top: 100, bottom: 124 })
    await nextTick()
    expect(body.get('[role="dialog"]').attributes('style')).toContain('top:')
    closeRun()
    await nextTick()

    // 3. Add after inputs (no anchor, then lower-right anchor -> flips left with `bottom:`)
    openAddToWorkflow(draft, { after: null })
    await nextTick()
    expect(body.text()).toContain('add after')
    expect(body.text()).toContain('runs on its output')
    closeRun()
    await nextTick()

    openAddToWorkflow(draft, { after: null }, { left: 1100, right: 1124, top: 650, bottom: 674 })
    await nextTick()
    expect(body.get('[role="dialog"]').attributes('style')).toContain('bottom:')

    await body.findAll('[role="option"]')[0]!.trigger('click')
    expect(workflowsStore.workflowOf(300)?.groups).toHaveLength(2)
    expect(runTarget.value).toBeNull()
  })

  it('keeps cursor clamped on empty filter results and focuses select-only options container', async () => {
    const selectOnlyWorker: RegisteredTask = {
      task_name: 'openrelik-worker-triage.tasks.scan',
      queue_name: 'triage',
      task_config: [
        {
          name: 'mode',
          label: 'Mode',
          type: 'select',
          items: ['fast', 'deep'],
          value: 'fast',
        },
      ],
      display_name: 'Triage Select',
      description: 'Select only',
    }
    vi.mocked(api.taskqueue.registeredTasks).mockResolvedValueOnce([selectOnlyWorker])

    const body = mountDialog()
    openRun([SAMPLE_FILE], 10)
    await nextTick()
    await flushPromises()

    const filterInput = body.get('input[aria-label="Filter workers"]')
    await filterInput.setValue('nonexistent-worker')
    await filterInput.trigger('keydown', { key: 'ArrowDown' })

    // Clearing filter leaves the first option active instead of index -1.
    await filterInput.setValue('')
    const options = body.findAll('[role="option"]')
    expect(options[0]!.attributes('aria-selected')).toBe('true')

    // Opening options with Tab for a select-only worker lands focus on its tabindex="-1" options container.
    await filterInput.trigger('keydown', { key: 'Tab' })
    await nextTick()
    const selectEl = body.get('select')
    const optionsContainer = selectEl.element.closest('[tabindex="-1"]')
    expect(optionsContainer).not.toBeNull()
    expect(document.activeElement).toBe(optionsContainer)
  })
})
