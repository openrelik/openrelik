import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { clearQueryCache, markFresh, queryState } from '@/composables/useQueryCache'
import { useConfirm } from '@/composables/useConfirm'
import { folderKeys } from '@/composables/useFolderLoader'
import { useWorkflowTemplates } from '@/composables/useWorkflowTemplates'
import {
  addTask,
  clearWorkflowState,
  copyWorkflow,
  createWorkflow,
  discardWorkflow,
  dismissEdits,
  followWorkflow,
  lastEdit,
  loadWorkflow,
  mergeGroups,
  POLL_MS,
  removeTask,
  renameWorkflow,
  retrySave,
  runWorkflow,
  saveAsTemplate,
  setTaskOption,
  splitGroup,
  workflowActivity,
  workflowKeys,
} from '@/composables/useWorkflow'
import { useItemsStore } from '@/stores/items'
import { useWorkflowsStore } from '@/stores/workflows'
import { ApiError, api, type WorkflowRecord, type WorkflowSpec } from '@/api'
import type { Worker } from '@/types/worker'
import type { Task, TaskGroup, Workflow } from '@/types/workflow'

vi.mock('@/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api')>()
  return {
    ...actual,
    api: {
      ...actual.api,
      folders: {
        ...actual.api.folders,
        renameFolder: vi.fn(),
        deleteFolder: vi.fn(),
      },
      workflows: {
        ...actual.api.workflows,
        create: vi.fn(),
        get: vi.fn(),
        saveSpec: vi.fn(),
        rename: vi.fn(),
        copy: vi.fn(),
        createTemplate: vi.fn(),
        run: vi.fn(),
      },
    },
  }
})

const SAVE_DELAY_MS = 600
const UNDO_MS = 10_000

let nextId = 1

function makeWorker(id: string, name = `Worker ${id}`): Worker {
  return {
    id: `openrelik-worker-${id}.tasks.${id}`,
    name,
    queue: `openrelik-worker-${id}`,
    description: `Runs ${name}`,
    options: [
      { key: 'depth', label: 'Depth', type: 'text', default: '1' },
      { key: 'flag', label: 'Flag', type: 'checkbox', default: 'false' },
    ],
  }
}

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

function makeWorkflowRecord(workflowId = 1, folderId = 100): WorkflowRecord {
  return {
    id: workflowId,
    display_name: 'Draft workflow',
    spec_json: null,
    uuid: '00000000000000000000000000000000',
    files: [{ id: 1, display_name: 'evidence.dd' }],
    tasks: [],
    folder: { id: folderId },
  }
}

function cloneTask(task: Task): Task {
  return {
    ...task,
    outputs: [...task.outputs],
    fileReports: task.fileReports.map((r) => ({ ...r })),
    options: task.options.map((o) => (o.items ? { ...o, items: [...o.items] } : { ...o })),
    config: { ...task.config },
    groups: cloneGroups(task.groups),
  }
}

function cloneGroups(groups: TaskGroup[]): TaskGroup[] {
  return groups.map((group) => {
    const cloned: TaskGroup = { id: group.id, tasks: group.tasks.map(cloneTask) }
    if (group.join) cloned.join = cloneTask(group.join)
    return cloned
  })
}

function seedWorkflow(groups: TaskGroup[] = [], draft = true): Workflow {
  const id = nextId++
  const folderId = 1000 + id
  const workflow: Workflow = {
    id,
    folderId,
    name: `Workflow ${id}`,
    created: '2026-11-01T00:00:00Z',
    inputs: [{ id: 1, name: 'evidence.dd' }],
    groups: cloneGroups(groups),
    draft,
  }
  useWorkflowsStore().upsertWorkflow(workflow)
  return workflow
}

function snapshotGroups(folderId: number): TaskGroup[] {
  const workflow = useWorkflowsStore().workflowOf(folderId)
  return cloneGroups(workflow?.groups ?? [])
}

function createDeferred<T>(): {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (err: unknown) => void
} {
  let resolve!: (value: T) => void
  let reject!: (err: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

beforeEach(() => {
  vi.useFakeTimers()
  setActivePinia(createPinia())
  clearQueryCache()
  dismissEdits()
  vi.mocked(api.workflows.saveSpec).mockResolvedValue(makeWorkflowRecord())
})

afterEach(async () => {
  dismissEdits()
  await vi.runOnlyPendingTimersAsync()
  vi.useRealTimers()
})

describe('addTask across all AddAt positions and refusals', () => {
  it('adds tasks at after: null, after: taskId, beside: taskId, and join: groupId', () => {
    const workflow = seedWorkflow()
    const { folderId } = workflow

    const rootA = addTask(folderId, { after: null }, makeWorker('strings', 'Strings'), {
      depth: '2',
    })
    expect(rootA).not.toBeNull()
    expect(workflow.groups).toHaveLength(1)
    expect(workflow.groups[0]?.tasks.map((t) => t.id)).toEqual([rootA!.id])
    expect(rootA?.config).toEqual({ depth: '2' })

    // beside inserts immediately after the target task in the same group.
    const rootC = addTask(folderId, { beside: rootA!.id }, makeWorker('yara', 'YARA'), {})
    const rootB = addTask(folderId, { beside: rootA!.id }, makeWorker('plaso', 'Plaso'), {})
    expect(workflow.groups[0]?.tasks.map((t) => t.id)).toEqual([rootA!.id, rootB!.id, rootC!.id])

    // join attaches a callback to a free multi-task group.
    const rootGroupId = workflow.groups[0]!.id
    const joinTask = addTask(folderId, { join: rootGroupId }, makeWorker('hayabusa'), {})
    expect(joinTask).not.toBeNull()
    expect(workflow.groups[0]?.join?.id).toBe(joinTask!.id)

    // after: taskId works on a chord join (joins are chainable).
    const postJoin = addTask(folderId, { after: joinTask!.id }, makeWorker('follow'), {})
    expect(postJoin).not.toBeNull()
    expect(joinTask?.groups[0]?.tasks.map((t) => t.id)).toEqual([postJoin!.id])
  })

  it('merges sibling groups and attaches a join for joinAll: null and joinAll: taskId', () => {
    const parent = makeTask('parent', {
      groups: [makeGroup('cg1', [makeTask('c1')]), makeGroup('cg2', [makeTask('c2')])],
    })
    const workflow = seedWorkflow([
      makeGroup('rg1', [makeTask('r1')]),
      makeGroup('rg2', [makeTask('r2'), makeTask('r3')]),
    ])
    const childWorkflow = seedWorkflow([makeGroup('p-group', [parent])])

    const rootJoined = addTask(workflow.folderId, { joinAll: null }, makeWorker('agg'), {})
    expect(rootJoined).not.toBeNull()
    expect(workflow.groups).toHaveLength(1)
    expect(workflow.groups[0]?.id).toBe('rg1')
    expect(workflow.groups[0]?.tasks.map((t) => t.id)).toEqual(['r1', 'r2', 'r3'])
    expect(workflow.groups[0]?.join?.id).toBe(rootJoined!.id)

    const childJoined = addTask(
      childWorkflow.folderId,
      { joinAll: 'parent' },
      makeWorker('child-agg'),
      {},
    )
    expect(childJoined).not.toBeNull()
    const updatedParent = childWorkflow.groups[0]?.tasks[0]
    expect(updatedParent?.groups).toHaveLength(1)
    expect(updatedParent?.groups[0]?.tasks.map((t) => t.id)).toEqual(['c1', 'c2'])
    expect(updatedParent?.groups[0]?.join?.id).toBe(childJoined!.id)
  })

  it('refuses addTask when !canChainAfter, !canJoin, or !canJoinAll', async () => {
    const workflow = seedWorkflow([
      makeGroup('joined-group', [makeTask('h1'), makeTask('h2')], makeTask('j1')),
      makeGroup('single-group', [makeTask('solo')]),
      makeGroup('chained-group', [
        makeTask('with-child', { groups: [makeGroup('sub', [makeTask('sub-t')])] }),
        makeTask('peer'),
      ]),
    ])
    const before = snapshotGroups(workflow.folderId)

    // Cannot chain after a chord header task (!canChainAfter).
    expect(addTask(workflow.folderId, { after: 'h1' }, makeWorker('w'), {})).toBeNull()
    // Cannot join a single-task group, an already joined group, or a group with downstream tasks.
    expect(addTask(workflow.folderId, { join: 'single-group' }, makeWorker('w'), {})).toBeNull()
    expect(addTask(workflow.folderId, { join: 'joined-group' }, makeWorker('w'), {})).toBeNull()
    expect(addTask(workflow.folderId, { join: 'chained-group' }, makeWorker('w'), {})).toBeNull()
    // Cannot joinAll when any group already has a join or downstream tasks.
    expect(addTask(workflow.folderId, { joinAll: null }, makeWorker('w'), {})).toBeNull()
    // Cannot insert beside a join or unknown task.
    expect(addTask(workflow.folderId, { beside: 'j1' }, makeWorker('w'), {})).toBeNull()
    expect(addTask(workflow.folderId, { after: 'missing' }, makeWorker('w'), {})).toBeNull()

    expect(workflow.groups).toEqual(before)
    await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS)
    expect(api.workflows.saveSpec).not.toHaveBeenCalled()
  })
})

describe('removeTask and undo', () => {
  it('removes a plain sole task (and its empty group) and restores the exact prior tree on undo', () => {
    const workflow = seedWorkflow([
      makeGroup('g0', [makeTask('t0')]),
      makeGroup('g1', [makeTask('t1')]),
      makeGroup('g2', [makeTask('t2')]),
    ])
    const before = snapshotGroups(workflow.folderId)

    const edit = removeTask(workflow.folderId, 't1')
    expect(edit).not.toBeNull()
    expect(workflow.groups.map((g) => g.id)).toEqual(['g0', 'g2'])

    lastEdit.value?.undo()
    expect(workflow.groups).toEqual(before)
    expect(lastEdit.value).toBeNull()
  })

  it('removes a task with downstream tasks and restores the full subtree on undo', () => {
    const grand = makeTask('grand')
    const child = makeTask('child', { groups: [makeGroup('g-grand', [grand])] })
    const root = makeTask('root', {
      name: 'Strings',
      groups: [makeGroup('g-child', [child])],
    })
    const workflow = seedWorkflow([makeGroup('g-root', [root, makeTask('sibling')])])
    const before = snapshotGroups(workflow.folderId)

    const edit = removeTask(workflow.folderId, 'root')
    expect(edit?.label).toBe('removed Strings and 2 tasks after it')
    expect(workflow.groups[0]?.tasks.map((t) => t.id)).toEqual(['sibling'])

    lastEdit.value?.undo()
    expect(workflow.groups).toEqual(before)
  })

  it('removes a chord join and restores it on undo', () => {
    const workflow = seedWorkflow([
      makeGroup('g-chord', [makeTask('h1'), makeTask('h2')], makeTask('join-1')),
    ])
    const before = snapshotGroups(workflow.folderId)

    removeTask(workflow.folderId, 'join-1')
    expect(workflow.groups[0]?.join).toBeUndefined()
    expect(workflow.groups[0]?.tasks.map((t) => t.id)).toEqual(['h1', 'h2'])

    lastEdit.value?.undo()
    expect(workflow.groups).toEqual(before)
  })

  it('demotes the join to a plain task when the last task in a joined group is removed, and undoes cleanly', () => {
    const afterJoin = makeTask('after-join')
    const join = makeTask('join-1', { groups: [makeGroup('g-after', [afterJoin])] })
    const workflow = seedWorkflow([makeGroup('g-chord', [makeTask('h1'), makeTask('h2')], join)])
    const initial = snapshotGroups(workflow.folderId)

    // Remove first header task: group still has h2 + join.
    removeTask(workflow.folderId, 'h1')
    const oneHeaderLeft = snapshotGroups(workflow.folderId)
    expect(workflow.groups[0]?.tasks.map((t) => t.id)).toEqual(['h2'])
    expect(workflow.groups[0]?.join?.id).toBe('join-1')

    // Remove last header task: join is demoted to the group's plain task.
    removeTask(workflow.folderId, 'h2')
    expect(workflow.groups).toHaveLength(1)
    expect(workflow.groups[0]?.id).toBe('g-chord')
    expect(workflow.groups[0]?.join).toBeUndefined()
    expect(workflow.groups[0]?.tasks.map((t) => t.id)).toEqual(['join-1'])
    expect(workflow.groups[0]?.tasks[0]?.groups[0]?.tasks[0]?.id).toBe('after-join')

    // First undo promotes join-1 back to group.join and restores h2.
    lastEdit.value?.undo()
    expect(workflow.groups).toEqual(oneHeaderLeft)

    // Second undo restores h1 at index 0.
    lastEdit.value?.undo()
    expect(workflow.groups).toEqual(initial)
  })
})

describe('splitGroup and undo', () => {
  it('places split top tasks above the original group and restores exact indices on undo', () => {
    const workflow = seedWorkflow([
      makeGroup('g-before', [makeTask('p0')]),
      makeGroup('g-main', [makeTask('t0'), makeTask('t1'), makeTask('t2'), makeTask('t3')]),
    ])
    const before = snapshotGroups(workflow.folderId)

    const split = splitGroup(workflow.folderId, ['t0', 't1'])
    expect(split).not.toBeNull()
    expect(workflow.groups.map((g) => g.id)).toEqual(['g-before', split!.id, 'g-main'])
    expect(split?.tasks.map((t) => t.id)).toEqual(['t0', 't1'])
    expect(workflow.groups[2]?.tasks.map((t) => t.id)).toEqual(['t2', 't3'])

    lastEdit.value?.undo()
    expect(workflow.groups).toEqual(before)
  })

  it('places split non-top tasks below the original group and restores scattered indices on undo', () => {
    const workflow = seedWorkflow([
      makeGroup('g-main', [makeTask('t0'), makeTask('t1'), makeTask('t2'), makeTask('t3')]),
      makeGroup('g-after', [makeTask('n0')]),
    ])
    const before = snapshotGroups(workflow.folderId)

    const split = splitGroup(workflow.folderId, ['t1', 't3'])
    expect(split).not.toBeNull()
    expect(workflow.groups.map((g) => g.id)).toEqual(['g-main', split!.id, 'g-after'])
    expect(workflow.groups[0]?.tasks.map((t) => t.id)).toEqual(['t0', 't2'])
    expect(split?.tasks.map((t) => t.id)).toEqual(['t1', 't3'])

    lastEdit.value?.undo()
    expect(workflow.groups).toEqual(before)
  })

  it('turns edit.undoable() false once a join is added to the split group', () => {
    const workflow = seedWorkflow([
      makeGroup('g-main', [makeTask('t0'), makeTask('t1'), makeTask('t2')]),
    ])

    const split = splitGroup(workflow.folderId, ['t0', 't1'])
    const splitEdit = lastEdit.value
    expect(split).not.toBeNull()
    expect(splitEdit?.undoable()).toBe(true)

    const joined = addTask(workflow.folderId, { join: split!.id }, makeWorker('joiner'), {})
    expect(joined).not.toBeNull()
    expect(splitEdit?.undoable()).toBe(false)
    expect(lastEdit.value).toBeNull()

    const afterJoin = snapshotGroups(workflow.folderId)
    splitEdit?.undo()
    expect(workflow.groups).toEqual(afterJoin)
  })

  it('refuses invalid splits (all tasks, empty, or cross-group selection)', () => {
    const workflow = seedWorkflow([
      makeGroup('g1', [makeTask('a1'), makeTask('a2')]),
      makeGroup('g2', [makeTask('b1')]),
    ])
    const before = snapshotGroups(workflow.folderId)

    expect(splitGroup(workflow.folderId, [])).toBeNull()
    expect(splitGroup(workflow.folderId, ['a1', 'a2'])).toBeNull()
    expect(splitGroup(workflow.folderId, ['a1', 'b1'])).toBeNull()
    expect(workflow.groups).toEqual(before)
  })
})

describe('mergeGroups and undo', () => {
  it('merges non-adjacent sibling groups into the upper group and restores positions on undo', () => {
    const workflow = seedWorkflow([
      makeGroup('g0', [makeTask('t0')]),
      makeGroup('g1', [makeTask('t1')]),
      makeGroup('g2', [makeTask('t2')]),
      makeGroup('g3', [makeTask('t3'), makeTask('t4')]),
    ])
    const before = snapshotGroups(workflow.folderId)

    const merged = mergeGroups(workflow.folderId, ['g3', 'g1'])
    expect(merged?.id).toBe('g1')
    expect(workflow.groups.map((g) => g.id)).toEqual(['g0', 'g1', 'g2'])
    expect(merged?.tasks.map((t) => t.id)).toEqual(['t1', 't3', 't4'])

    lastEdit.value?.undo()
    expect(workflow.groups).toEqual(before)
  })

  it('preserves a single join from a lower group and restores it to that group on undo', () => {
    const workflow = seedWorkflow([
      makeGroup('g1', [makeTask('t1')]),
      makeGroup('g2', [makeTask('t2'), makeTask('t3')], makeTask('join-2')),
    ])
    const before = snapshotGroups(workflow.folderId)

    const merged = mergeGroups(workflow.folderId, ['g1', 'g2'])
    expect(merged?.id).toBe('g1')
    expect(merged?.tasks.map((t) => t.id)).toEqual(['t1', 't2', 't3'])
    expect(merged?.join?.id).toBe('join-2')
    expect(workflow.groups).toHaveLength(1)

    lastEdit.value?.undo()
    expect(workflow.groups).toEqual(before)
  })

  it('refuses invalid merges (single group, two joins, join with downstream child, different parents)', async () => {
    const childGroup = makeGroup('g-child', [makeTask('c1')])
    const workflow = seedWorkflow([
      makeGroup('ja', [makeTask('a1'), makeTask('a2')], makeTask('j1')),
      makeGroup('jb', [makeTask('b1'), makeTask('b2')], makeTask('j2')),
      makeGroup('chained', [makeTask('p1', { groups: [childGroup] })]),
    ])
    const before = snapshotGroups(workflow.folderId)

    expect(mergeGroups(workflow.folderId, ['ja'])).toBeNull()
    expect(mergeGroups(workflow.folderId, ['ja', 'jb'])).toBeNull()
    expect(mergeGroups(workflow.folderId, ['ja', 'chained'])).toBeNull()
    expect(mergeGroups(workflow.folderId, ['ja', 'g-child'])).toBeNull()

    expect(workflow.groups).toEqual(before)
    await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS)
    expect(api.workflows.saveSpec).not.toHaveBeenCalled()
  })
})

describe('setTaskOption', () => {
  it('updates config on value change and ignores no-op writes', async () => {
    const workflow = seedWorkflow([makeGroup('g1', [makeTask('t1')])])

    // Same value as existing config ('1') is a no-op and schedules no save.
    setTaskOption(workflow.folderId, 't1', 'depth', '1')
    await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS)
    expect(api.workflows.saveSpec).not.toHaveBeenCalled()

    // Changed value updates config and schedules a save.
    setTaskOption(workflow.folderId, 't1', 'depth', '5')
    expect(workflow.groups[0]?.tasks[0]?.config.depth).toBe('5')
    await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS)
    expect(api.workflows.saveSpec).toHaveBeenCalledTimes(1)
  })
})

describe('undo independence and edit guards', () => {
  it('reverts only its own change when undone after unrelated edits', () => {
    const workflow = seedWorkflow([
      makeGroup('g1', [makeTask('t1'), makeTask('t2')]),
      makeGroup('g2', [makeTask('t3'), makeTask('t4')]),
    ])

    const firstRemoval = removeTask(workflow.folderId, 't1')
    // Perform unrelated edits afterwards on other tasks and groups.
    const added = addTask(workflow.folderId, { after: 't3' }, makeWorker('extra'), {})
    setTaskOption(workflow.folderId, 't2', 'depth', '9')
    removeTask(workflow.folderId, 't4')

    // Reverting the earlier removal puts t1 back in g1 without disturbing later edits.
    firstRemoval?.undo()
    expect(workflow.groups[0]?.tasks.map((t) => t.id)).toEqual(['t1', 't2'])
    expect(workflow.groups[0]?.tasks[1]?.config.depth).toBe('9')
    expect(workflow.groups[1]?.tasks.map((t) => t.id)).toEqual(['t3'])
    expect(workflow.groups[1]?.tasks[0]?.groups[0]?.tasks.map((t) => t.id)).toEqual([added!.id])

    // And lastEdit still points to the later t4 removal in g2 and reverts it cleanly too.
    lastEdit.value?.undo()
    expect(workflow.groups[1]?.tasks.map((t) => t.id)).toEqual(['t3', 't4'])
  })

  it('reverts sequential removals in the same group in LIFO order via lastEdit', () => {
    const workflow = seedWorkflow([makeGroup('g1', [makeTask('t1'), makeTask('t2')])])
    const before = snapshotGroups(workflow.folderId)

    removeTask(workflow.folderId, 't1')
    removeTask(workflow.folderId, 't2')
    expect(workflow.groups).toEqual([])

    lastEdit.value?.undo()
    lastEdit.value?.undo()
    expect(workflow.groups).toEqual(before)
  })

  it('expires undo entries after UNDO_MS', async () => {
    const workflow = seedWorkflow([makeGroup('g1', [makeTask('t1'), makeTask('t2')])])
    removeTask(workflow.folderId, 't1')
    expect(lastEdit.value).not.toBeNull()

    await vi.advanceTimersByTimeAsync(UNDO_MS)
    expect(lastEdit.value).toBeNull()
  })

  it('refuses all edits on non-draft workflows and on workflows currently starting a run', async () => {
    const nonDraft = seedWorkflow(
      [makeGroup('g1', [makeTask('t1'), makeTask('t2')]), makeGroup('g2', [makeTask('t3')])],
      false,
    )
    const nonDraftBefore = snapshotGroups(nonDraft.folderId)

    expect(addTask(nonDraft.folderId, { after: null }, makeWorker('w'), {})).toBeNull()
    expect(removeTask(nonDraft.folderId, 't1')).toBeNull()
    expect(splitGroup(nonDraft.folderId, ['t1'])).toBeNull()
    expect(mergeGroups(nonDraft.folderId, ['g1', 'g2'])).toBeNull()
    setTaskOption(nonDraft.folderId, 't1', 'depth', '99')
    expect(nonDraft.groups).toEqual(nonDraftBefore)

    // Draft workflow whose run request is currently in flight also refuses all edits.
    const runningDraft = seedWorkflow([
      makeGroup('rg1', [makeTask('rt1'), makeTask('rt2')]),
      makeGroup('rg2', [makeTask('rt3')]),
    ])
    const runDeferred = createDeferred<WorkflowRecord>()
    vi.mocked(api.workflows.run).mockReturnValueOnce(runDeferred.promise)

    const runPromise = runWorkflow(runningDraft.folderId)
    await Promise.resolve()
    expect(workflowActivity(runningDraft.id).running).toBe(true)

    const runningBefore = snapshotGroups(runningDraft.folderId)
    expect(addTask(runningDraft.folderId, { after: null }, makeWorker('w'), {})).toBeNull()
    expect(removeTask(runningDraft.folderId, 'rt1')).toBeNull()
    expect(splitGroup(runningDraft.folderId, ['rt1'])).toBeNull()
    expect(mergeGroups(runningDraft.folderId, ['rg1', 'rg2'])).toBeNull()
    setTaskOption(runningDraft.folderId, 'rt1', 'depth', '99')
    expect(runningDraft.groups).toEqual(runningBefore)

    runDeferred.resolve({
      ...makeWorkflowRecord(runningDraft.id, runningDraft.folderId),
      tasks: [{ id: 1, uuid: 'rt1', display_name: 'Task rt1', status_short: 'PENDING' }],
    })
    await runPromise
    expect(api.workflows.saveSpec).not.toHaveBeenCalled()
  })
})

describe('draft save coalescing', () => {
  it('coalesces multiple edits within SAVE_DELAY_MS into a single saveSpec request', async () => {
    const workflow = seedWorkflow()

    const first = addTask(workflow.folderId, { after: null }, makeWorker('a'), { depth: '1' })
    await vi.advanceTimersByTimeAsync(250)
    expect(api.workflows.saveSpec).not.toHaveBeenCalled()

    const second = addTask(workflow.folderId, { beside: first!.id }, makeWorker('b'), {
      depth: '2',
    })
    await vi.advanceTimersByTimeAsync(400)
    // 650ms since first edit, 400ms since second: debounce reset, still not called.
    expect(api.workflows.saveSpec).not.toHaveBeenCalled()

    setTaskOption(workflow.folderId, second!.id, 'depth', '7')
    await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS - 1)
    expect(api.workflows.saveSpec).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1)
    expect(api.workflows.saveSpec).toHaveBeenCalledTimes(1)
    const savedSpec = vi.mocked(api.workflows.saveSpec).mock.calls[0]?.[2]
    expect(savedSpec?.workflow.tasks).toHaveLength(2)
    const secondSaved = savedSpec?.workflow.tasks[1]
    expect(
      secondSaved?.type === 'task'
        ? secondSaved.task_config.find((opt) => opt.name === 'depth')?.value
        : undefined,
    ).toBe('7')
  })

  it('queues exactly one follow-up saveSpec when edits arrive while a save is in flight', async () => {
    const workflow = seedWorkflow()
    const firstSave = createDeferred<WorkflowRecord>()
    const secondSave = createDeferred<WorkflowRecord>()

    vi.mocked(api.workflows.saveSpec)
      .mockReturnValueOnce(firstSave.promise)
      .mockReturnValueOnce(secondSave.promise)

    const taskA = addTask(workflow.folderId, { after: null }, makeWorker('a'), { depth: '1' })
    await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS)

    expect(api.workflows.saveSpec).toHaveBeenCalledTimes(1)
    expect(workflowActivity(workflow.id).saving).toBe(true)

    // Two edits arrive while the first saveSpec is still in flight, and the debounce timer fires.
    const taskB = addTask(workflow.folderId, { after: null }, makeWorker('b'), { depth: '2' })
    setTaskOption(workflow.folderId, taskA!.id, 'depth', '9')
    await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS)

    // Still waiting on the in-flight save — no overlapping request sent.
    expect(api.workflows.saveSpec).toHaveBeenCalledTimes(1)

    // Resolving the first save immediately kicks off a single follow-up save with both edits.
    firstSave.resolve(makeWorkflowRecord(workflow.id, workflow.folderId))
    await vi.advanceTimersByTimeAsync(0)

    expect(api.workflows.saveSpec).toHaveBeenCalledTimes(2)
    expect(workflowActivity(workflow.id).saving).toBe(true)
    const secondSpec = vi.mocked(api.workflows.saveSpec).mock.calls[1]?.[2]
    expect(secondSpec?.workflow.tasks.map((n) => (n.type === 'task' ? n.uuid : ''))).toEqual([
      taskA!.id,
      taskB!.id,
    ])

    secondSave.resolve(makeWorkflowRecord(workflow.id, workflow.folderId))
    await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS)

    expect(api.workflows.saveSpec).toHaveBeenCalledTimes(2)
    expect(workflowActivity(workflow.id).saving).toBe(false)
  })

  it('records saveError when saveSpec fails and recovers on retrySave', async () => {
    const workflow = seedWorkflow()
    vi.mocked(api.workflows.saveSpec)
      .mockRejectedValueOnce(
        new ApiError({ status: 500, statusText: 'Error', message: 'Disk full' }),
      )
      .mockResolvedValueOnce(makeWorkflowRecord(workflow.id, workflow.folderId))

    addTask(workflow.folderId, { after: null }, makeWorker('a'), {})
    await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS)

    expect(workflowActivity(workflow.id).saveError).toBe('Disk full')
    expect(workflowActivity(workflow.id).saving).toBe(false)

    // Unknown folder is a no-op; retrying the real folder clears saveError.
    retrySave(999_999)
    retrySave(workflow.folderId)
    await vi.advanceTimersByTimeAsync(0)

    expect(api.workflows.saveSpec).toHaveBeenCalledTimes(2)
    expect(workflowActivity(workflow.id).saveError).toBeNull()
  })
})

describe('createWorkflow, loadWorkflow, and renameWorkflow', () => {
  it('creates workflows from files or templates, populates stores, and marks caches fresh', async () => {
    const spec: WorkflowSpec = {
      workflow: {
        type: 'chain',
        isRoot: true,
        tasks: [
          {
            type: 'task',
            uuid: 'a'.repeat(32),
            task_name: 'worker.strings',
            queue_name: 'default',
            display_name: 'Strings',
            task_config: [],
            tasks: [],
          },
        ],
      },
    }
    vi.mocked(api.workflows.create).mockResolvedValueOnce({
      ...makeWorkflowRecord(80, 800),
      display_name: 'From Template',
      spec_json: JSON.stringify(spec),
    })

    const created = await createWorkflow(10, [1, 2], 5)
    expect(api.workflows.create).toHaveBeenCalledWith(10, [1, 2], 5)
    expect(created.name).toBe('From Template')
    expect(created.groups).toHaveLength(1)
    expect(useItemsStore().findFolder(800)?.workflowId).toBe(80)
    expect(queryState(workflowKeys.workflow(80)).status).toBe('success')
    expect(queryState(folderKeys.subfolders(800)).status).toBe('success')
    expect(queryState(folderKeys.files(800)).status).toBe('success')
  })

  it('loads workflows, invalidates folder files on new task outputs, and skips stale answers during edits', async () => {
    const folderId = 810
    const workflowId = 81
    const specJson = JSON.stringify({
      workflow: {
        type: 'chain',
        isRoot: true,
        tasks: [
          {
            type: 'task',
            uuid: 't-out',
            task_name: 'worker.strings',
            queue_name: 'default',
            display_name: 'Strings',
            task_config: [],
            tasks: [],
          },
        ],
      },
    } satisfies WorkflowSpec)

    // Initial load populates the workflow.
    vi.mocked(api.workflows.get).mockResolvedValueOnce({
      ...makeWorkflowRecord(workflowId, folderId),
      spec_json: specJson,
      tasks: [{ id: 1, uuid: 't-out', display_name: 'Strings', status_short: 'STARTED' }],
    })
    await loadWorkflow(folderId, workflowId)
    expect(useWorkflowsStore().workflowOf(folderId)?.groups[0]?.tasks[0]?.outputs).toEqual([])

    // Mark folder files fresh; when a forced reload brings a new output file, folder files get invalidated!
    markFresh(folderKeys.files(folderId))
    expect(queryState(folderKeys.files(folderId)).fetchedAt).toBeGreaterThan(0)

    vi.mocked(api.workflows.get).mockResolvedValueOnce({
      ...makeWorkflowRecord(workflowId, folderId),
      spec_json: specJson,
      tasks: [
        {
          id: 1,
          uuid: 't-out',
          display_name: 'Strings',
          status_short: 'SUCCESS',
          output_files: [{ id: 901, display_name: 'out.txt' }],
        },
      ],
    })
    await loadWorkflow(folderId, workflowId, { force: true })
    expect(useWorkflowsStore().workflowOf(folderId)?.groups[0]?.tasks[0]?.outputs).toEqual([901])
    expect(queryState(folderKeys.files(folderId)).fetchedAt).toBe(0)

    // Draft with unsaved local edits ignores server fetch so local edits are not overwritten.
    const draft = seedWorkflow()
    addTask(draft.folderId, { after: null }, makeWorker('local'), {})
    vi.mocked(api.workflows.get).mockResolvedValueOnce(makeWorkflowRecord(draft.id, draft.folderId))
    await loadWorkflow(draft.folderId, draft.id, { force: true })
    expect(draft.groups).toHaveLength(1)
  })

  it('renames workflow + folder together and surfaces folder rename errors', async () => {
    const workflow = seedWorkflow()
    useItemsStore().upsertItems([
      {
        id: workflow.folderId,
        parent: 1,
        kind: 'folder',
        name: workflow.name,
        owner: 'Alice',
        modified: '2026-11-01T00:00:00Z',
        workflowId: workflow.id,
      },
    ])

    // Guards against missing workflow or blank name.
    expect(await renameWorkflow(999_999, 'Valid')).toBe(false)
    expect(await renameWorkflow(workflow.folderId, '   ')).toBe(false)

    // Success updates both folder and workflow.
    vi.mocked(api.folders.renameFolder).mockResolvedValueOnce({
      id: workflow.folderId,
      uuid: `folder-${workflow.folderId}`,
      parent: null,
      display_name: 'Renamed Case',
    })
    vi.mocked(api.workflows.rename).mockResolvedValueOnce({
      ...makeWorkflowRecord(workflow.id, workflow.folderId),
      display_name: 'Renamed Case',
    })
    expect(await renameWorkflow(workflow.folderId, '  Renamed Case  ')).toBe(true)
    expect(useWorkflowsStore().workflowOf(workflow.folderId)?.name).toBe('Renamed Case')

    // Failure copies error to workflowActivity(id).error.
    vi.mocked(api.folders.renameFolder).mockRejectedValueOnce(
      new ApiError({ status: 403, statusText: 'Forbidden', message: 'No permission' }),
    )
    vi.mocked(api.workflows.rename).mockResolvedValue({
      ...makeWorkflowRecord(workflow.id, workflow.folderId),
      display_name: 'Renamed Case',
    })
    expect(await renameWorkflow(workflow.folderId, 'Blocked')).toBe(false)
    expect(workflowActivity(workflow.id).error).toContain('No permission')
  })
})

describe('runWorkflow, copyWorkflow, saveAsTemplate, discardWorkflow, and followWorkflow', () => {
  it('runs a draft with fresh UUIDs and recovers cleanly when run fails', async () => {
    const nonDraft = seedWorkflow([makeGroup('g1', [makeTask('t1')])], false)
    expect(await runWorkflow(nonDraft.folderId)).toBe(false)

    const draft = seedWorkflow([makeGroup('g1', [makeTask('orig-uuid')])])
    vi.mocked(api.workflows.run).mockRejectedValueOnce(
      new ApiError({ status: 503, statusText: 'Unavailable', message: 'No workers online' }),
    )

    // Failed run keeps workflow as draft, sets error, and schedules a save.
    expect(await runWorkflow(draft.folderId)).toBe(false)
    expect(workflowActivity(draft.id).error).toBe('Could not run: No workers online')
    expect(workflowActivity(draft.id).running).toBe(false)
    expect(useWorkflowsStore().workflowOf(draft.folderId)?.draft).toBe(true)

    await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS)
    expect(api.workflows.saveSpec).toHaveBeenCalledTimes(1)

    // Successful run sends fresh task UUIDs and marks workflow non-draft.
    vi.mocked(api.workflows.run).mockImplementationOnce(async (_fId, wId, spec) => {
      const sentTask = spec.workflow.tasks[0]
      const freshUuid = sentTask?.type === 'task' ? sentTask.uuid : 'fresh'
      expect(freshUuid).not.toBe('orig-uuid')
      return {
        ...makeWorkflowRecord(wId, draft.folderId),
        spec_json: JSON.stringify(spec),
        tasks: [{ id: 1, uuid: freshUuid, display_name: 'Task', status_short: 'STARTED' }],
      }
    })

    expect(await runWorkflow(draft.folderId)).toBe(true)
    expect(useWorkflowsStore().workflowOf(draft.folderId)?.draft).toBe(false)
    expect(workflowActivity(draft.id).error).toBeNull()
  })

  it('copies workflows, saves templates via askForText, and discards confirmed drafts', async () => {
    const workflow = seedWorkflow([makeGroup('g1', [makeTask('t1')])])

    // copyWorkflow requires folder with a non-null parent in items store.
    expect(await copyWorkflow(workflow.folderId)).toBeNull()

    useItemsStore().upsertItems([
      {
        id: workflow.folderId,
        parent: 10,
        kind: 'folder',
        name: workflow.name,
        owner: 'Alice',
        modified: '2026-11-01T00:00:00Z',
        workflowId: workflow.id,
      },
    ])

    vi.mocked(api.workflows.copy).mockRejectedValueOnce(
      new ApiError({ status: 500, statusText: 'Error', message: 'Copy failed' }),
    )
    expect(await copyWorkflow(workflow.folderId)).toBeNull()
    expect(workflowActivity(workflow.id).error).toBe('Could not copy: Copy failed')

    vi.mocked(api.workflows.copy).mockResolvedValueOnce({
      ...makeWorkflowRecord(95, 950),
      display_name: 'Copy of Workflow',
    })
    const copied = await copyWorkflow(workflow.folderId)
    expect(copied?.folderId).toBe(950)
    expect(useItemsStore().findFolder(950)?.parent).toBe(10)

    // saveAsTemplate: cancel vs success vs failure.
    expect(await saveAsTemplate(999_999)).toBeNull()

    const confirm = useConfirm()
    const cancelSave = saveAsTemplate(workflow.folderId)
    confirm.cancel()
    expect(await cancelSave).toBeNull()

    vi.mocked(api.workflows.createTemplate).mockRejectedValueOnce(
      new ApiError({ status: 400, statusText: 'Bad Request', message: 'Duplicate name' }),
    )
    const failSave = saveAsTemplate(workflow.folderId)
    confirm.text.value = 'Dup Template'
    confirm.accept()
    expect(await failSave).toBeNull()
    expect(workflowActivity(workflow.id).error).toBe('Could not save the template: Duplicate name')

    vi.mocked(api.workflows.createTemplate).mockResolvedValueOnce({
      id: 42,
      display_name: 'Saved Triage',
      spec_json: JSON.stringify({
        workflow: { type: 'chain', isRoot: true, tasks: [] },
      } satisfies WorkflowSpec),
      user_id: 1,
    })
    const okSave = saveAsTemplate(workflow.folderId)
    confirm.text.value = '  Saved Triage  '
    confirm.accept()
    expect(await okSave).toBe('Saved Triage')
    expect(useWorkflowTemplates().templates.value.some((t) => t.name === 'Saved Triage')).toBe(true)

    // discardWorkflow: cancel, delete failure, and confirmed delete.
    const cancelDiscard = discardWorkflow(workflow.folderId)
    confirm.cancel()
    expect(await cancelDiscard).toBe(false)

    vi.mocked(api.folders.deleteFolder).mockRejectedValueOnce(
      new ApiError({ status: 500, statusText: 'Error', message: 'Locked folder' }),
    )
    const failDiscard = discardWorkflow(workflow.folderId)
    confirm.accept()
    expect(await failDiscard).toBe(false)
    expect(workflowActivity(workflow.id).error).toContain('Locked folder')

    vi.mocked(api.folders.deleteFolder).mockResolvedValueOnce()
    const okDiscard = discardWorkflow(workflow.folderId)
    confirm.accept()
    expect(await okDiscard).toBe(true)
    expect(useWorkflowsStore().workflowOf(workflow.folderId)).toBeUndefined()
  })

  it('polls an active workflow via followWorkflow every POLL_MS until tasks finish or error', async () => {
    const active = seedWorkflow(
      [makeGroup('g1', [makeTask('run-t1', { status: 'running' })])],
      false,
    )
    const specJson = JSON.stringify({
      workflow: {
        type: 'chain',
        isRoot: true,
        tasks: [
          {
            type: 'task',
            uuid: 'run-t1',
            task_name: 'worker.strings',
            queue_name: 'default',
            display_name: 'Strings',
            task_config: [],
            tasks: [],
          },
        ],
      },
    } satisfies WorkflowSpec)

    vi.mocked(api.workflows.get)
      .mockResolvedValueOnce({
        ...makeWorkflowRecord(active.id, active.folderId),
        spec_json: specJson,
        tasks: [{ id: 1, uuid: 'run-t1', display_name: 'Strings', status_short: 'STARTED' }],
      })
      .mockResolvedValueOnce({
        ...makeWorkflowRecord(active.id, active.folderId),
        spec_json: specJson,
        tasks: [{ id: 1, uuid: 'run-t1', display_name: 'Strings', status_short: 'SUCCESS' }],
      })

    followWorkflow(active.folderId)
    // Duplicate followWorkflow call while already following is a no-op.
    followWorkflow(active.folderId)

    await vi.advanceTimersByTimeAsync(POLL_MS)
    expect(api.workflows.get).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(POLL_MS)
    expect(api.workflows.get).toHaveBeenCalledTimes(2)
    expect(useWorkflowsStore().workflowOf(active.folderId)?.groups[0]?.tasks[0]?.status).toBe(
      'success',
    )

    // Third tick sees !isActive(current) and stops polling.
    await vi.advanceTimersByTimeAsync(POLL_MS * 3)
    expect(api.workflows.get).toHaveBeenCalledTimes(2)

    // Also stops cleanly when get() rejects.
    const errWf = seedWorkflow(
      [makeGroup('g1', [makeTask('err-t1', { status: 'pending' })])],
      false,
    )
    vi.mocked(api.workflows.get).mockRejectedValueOnce(new Error('Network down'))
    followWorkflow(errWf.folderId)
    await vi.advanceTimersByTimeAsync(POLL_MS * 3)
    expect(api.workflows.get).toHaveBeenCalledTimes(3)
  })
})

describe('workflow race guards, sign-out cleanup, and edit/follow lifecycle', () => {
  it('does not send a follow-up saveSpec when runWorkflow drains a failing in-flight save', async () => {
    const workflow = seedWorkflow([makeGroup('g1', [makeTask('t1')])])
    const firstSave = createDeferred<WorkflowRecord>()
    vi.mocked(api.workflows.saveSpec).mockReturnValueOnce(firstSave.promise)
    vi.mocked(api.workflows.run).mockResolvedValueOnce({
      ...makeWorkflowRecord(workflow.id, workflow.folderId),
      tasks: [{ id: 1, uuid: 't1', display_name: 'Task t1', status_short: 'STARTED' }],
    })

    // First edit triggers the debounced save; a second edit while it is in flight queues a follow-up.
    setTaskOption(workflow.folderId, 't1', 'depth', '2')
    await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS)
    expect(api.workflows.saveSpec).toHaveBeenCalledTimes(1)

    setTaskOption(workflow.folderId, 't1', 'depth', '3')
    const running = runWorkflow(workflow.folderId)
    expect(workflowActivity(workflow.id).running).toBe(true)

    firstSave.reject(new Error('Transient failure'))
    expect(await running).toBe(true)

    // Queued save was aborted before calling saveSpec a second time, and run succeeded cleanly.
    expect(api.workflows.saveSpec).toHaveBeenCalledTimes(1)
    expect(api.workflows.run).toHaveBeenCalledTimes(1)
    expect(workflowActivity(workflow.id).saveError).toBeNull()
    expect(workflowActivity(workflow.id).running).toBe(false)
  })

  it('clears lastEdit when running starts and dismisses edits on run success or discard', async () => {
    const workflow = seedWorkflow([makeGroup('g1', [makeTask('t1')])])
    removeTask(workflow.folderId, 't1')
    expect(lastEdit.value).not.toBeNull()

    const runGate = createDeferred<WorkflowRecord>()
    vi.mocked(api.workflows.run).mockReturnValueOnce(runGate.promise)
    const runPromise = runWorkflow(workflow.folderId)
    // Hidden immediately while running so Undo is not offered mid-run.
    expect(lastEdit.value).toBeNull()

    runGate.resolve({
      ...makeWorkflowRecord(workflow.id, workflow.folderId),
      tasks: [{ id: 1, uuid: 't1', display_name: 'Task t1', status_short: 'STARTED' }],
    })
    expect(await runPromise).toBe(true)
    expect(lastEdit.value).toBeNull()

    // Discard also clears lastEdit and any run activity error.
    const draft2 = seedWorkflow([makeGroup('g2', [makeTask('t2')])])
    useItemsStore().upsertItems([
      {
        id: draft2.folderId,
        parent: null,
        kind: 'folder',
        name: draft2.name,
        owner: 'Alice',
        modified: '2026-11-01T00:00:00Z',
        workflowId: draft2.id,
      },
    ])
    vi.mocked(api.workflows.run).mockRejectedValueOnce(new Error('Run failed'))
    expect(await runWorkflow(draft2.folderId)).toBe(false)
    expect(workflowActivity(draft2.id).error).toContain('Run failed')

    removeTask(draft2.folderId, 't2')
    expect(lastEdit.value).not.toBeNull()

    vi.mocked(api.folders.deleteFolder).mockResolvedValueOnce(undefined)
    const confirm = useConfirm()
    const discarding = discardWorkflow(draft2.folderId)
    confirm.accept()
    expect(await discarding).toBe(true)
    expect(lastEdit.value).toBeNull()
    expect(workflowActivity(draft2.id).error).toBeNull()
  })

  it('guards createWorkflow, loadWorkflow, copyWorkflow, saveAsTemplate, discardWorkflow, and followWorkflow against clearWorkflowState mid-flight', async () => {
    const confirm = useConfirm()
    // 1. createWorkflow rejects cleanly and does not store the created workflow after sign-out.
    const createGate = createDeferred<WorkflowRecord>()
    vi.mocked(api.workflows.create).mockReturnValueOnce(createGate.promise)
    const createPromise = createWorkflow(500, [1])
    clearWorkflowState()
    createGate.resolve(makeWorkflowRecord(501, 502))
    await expect(createPromise).rejects.toMatchObject({ name: 'AbortError' })
    expect(useWorkflowsStore().workflowOf(502)).toBeUndefined()

    // 2. loadWorkflow ignores response that lands after sign-out.
    const getGate = createDeferred<WorkflowRecord>()
    vi.mocked(api.workflows.get).mockReturnValueOnce(getGate.promise)
    const loadPromise = loadWorkflow(601, 602)
    clearWorkflowState()
    getGate.resolve(makeWorkflowRecord(601, 602))
    await expect(loadPromise).resolves.toBeUndefined()
    expect(useWorkflowsStore().workflowOf(602)).toBeUndefined()

    // 3. copyWorkflow does not store the copied workflow after sign-out.
    const source = seedWorkflow([makeGroup('g1', [makeTask('t1')])], false)
    const copyGate = createDeferred<WorkflowRecord>()
    vi.mocked(api.workflows.copy).mockReturnValueOnce(copyGate.promise)
    const copyPromise = copyWorkflow(source.folderId)
    clearWorkflowState()
    copyGate.resolve(makeWorkflowRecord(source.id + 1, source.folderId + 1))
    expect(await copyPromise).toBeNull()
    expect(useWorkflowsStore().workflowOf(source.folderId + 1)).toBeUndefined()

    // 4. saveAsTemplate does not mutate templates after sign-out.
    const wfForTpl = seedWorkflow([makeGroup('g1', [makeTask('t1')])], false)
    const tplGate = createDeferred<{ id: number; display_name: string }>()
    vi.mocked(api.workflows.createTemplate).mockReturnValueOnce(tplGate.promise)
    const tplPromise = saveAsTemplate(wfForTpl.folderId)
    confirm.text.value = 'My Template'
    confirm.accept()
    await Promise.resolve()
    clearWorkflowState()
    tplGate.resolve({ id: 99, display_name: 'My Template' })
    expect(await tplPromise).toBeNull()
    expect(useWorkflowTemplates().templates.value.some((t) => t.id === 99)).toBe(false)

    // 5. discardWorkflow aborts before folders.deleteFolder if sign-out happens while confirming.
    const wfForDiscard = seedWorkflow([makeGroup('g1', [makeTask('t1')])], true)
    const discardPromise = discardWorkflow(wfForDiscard.folderId)
    clearWorkflowState()
    confirm.accept()
    expect(await discardPromise).toBe(false)
    expect(api.folders.deleteFolder).not.toHaveBeenCalled()

    // 6. followWorkflow stops polling when clearWorkflowState runs before timer fires.
    const active = seedWorkflow([makeGroup('g1', [makeTask('t1', { status: 'running' })])], false)
    const callsBeforeFollow = vi.mocked(api.workflows.get).mock.calls.length
    followWorkflow(active.folderId)
    clearWorkflowState()
    await vi.advanceTimersByTimeAsync(POLL_MS * 3)
    expect(vi.mocked(api.workflows.get).mock.calls.length).toBe(callsBeforeFollow)
  })

  it('ignores inactive workflows in followWorkflow and does not schedule a post-completion poll', async () => {
    const finished = seedWorkflow([makeGroup('g1', [makeTask('t1', { status: 'success' })])], false)
    const callsBefore = vi.mocked(api.workflows.get).mock.calls.length
    followWorkflow(finished.folderId)
    await vi.advanceTimersByTimeAsync(POLL_MS * 3)
    expect(vi.mocked(api.workflows.get).mock.calls.length).toBe(callsBefore)

    // One poll sees the task finish; no further poll is scheduled.
    const active = seedWorkflow([makeGroup('g1', [makeTask('t2', { status: 'running' })])], false)
    vi.mocked(api.workflows.get).mockResolvedValueOnce({
      ...makeWorkflowRecord(active.id, active.folderId),
      spec_json: JSON.stringify({
        workflow: {
          type: 'chain',
          isRoot: true,
          tasks: [
            {
              type: 'task',
              uuid: 't2',
              task_name: 'worker.strings',
              queue_name: 'default',
              display_name: 'Strings',
              task_config: [],
              tasks: [],
            },
          ],
        },
      } satisfies WorkflowSpec),
      tasks: [{ id: 1, uuid: 't2', display_name: 'Strings', status_short: 'SUCCESS' }],
    })
    followWorkflow(active.folderId)
    await vi.advanceTimersByTimeAsync(POLL_MS)
    expect(vi.mocked(api.workflows.get).mock.calls.length).toBe(callsBefore + 1)
    await vi.advanceTimersByTimeAsync(POLL_MS * 3)
    expect(vi.mocked(api.workflows.get).mock.calls.length).toBe(callsBefore + 1)
  })
})
