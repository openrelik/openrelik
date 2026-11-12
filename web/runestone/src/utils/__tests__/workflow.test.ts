import { describe, expect, it } from 'vitest'

import type { WorkflowSpec, WorkflowTaskRecord } from '@/api/types'
import {
  STATUS_LABEL,
  allTasks,
  canChainAfter,
  canJoin,
  canJoinAll,
  everyGroup,
  everyTask,
  findTask,
  groupOf,
  isActive,
  mergeProblem,
  runStats,
  unchainable,
} from '@/utils/workflow'
import {
  parseSpec,
  runBlocker,
  specFromTasks,
  tasksFromSpec,
  withFreshUuids,
} from '@/utils/workflowSpec'
import type { WorkerOption } from '@/types/worker'
import type { Task, TaskGroup, Workflow } from '@/types/workflow'

function makeTask(id: string, overrides: Partial<Task> = {}): Task {
  return {
    id,
    name: `Worker ${id}`,
    module: `openrelik-worker-${id}.tasks.run`,
    queue: `openrelik-worker-${id}`,
    description: `Runs ${id}`,
    status: 'pending',
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

function makeWorkflow(groups: TaskGroup[], overrides: Partial<Workflow> = {}): Workflow {
  return {
    id: 1,
    folderId: 10,
    name: 'Disk triage',
    created: '2026-11-01T00:00:00Z',
    inputs: [{ id: 100, name: 'disk.raw' }],
    groups,
    draft: false,
    ...overrides,
  }
}

function makeRecord(
  uuid: string,
  statusShort: string | null,
  overrides: Partial<WorkflowTaskRecord> = {},
): WorkflowTaskRecord {
  return {
    id: 1,
    uuid,
    display_name: null,
    status_short: statusShort,
    ...overrides,
  }
}

describe('workflow tree traversal and labels', () => {
  it('maps every task status to its display label', () => {
    expect(STATUS_LABEL).toEqual({
      success: 'success',
      running: 'running',
      pending: 'queued',
      failed: 'failed',
      skipped: 'won’t run',
    })
  })

  it('walks tasks and groups depth-first including chord joins and tasks after joins', () => {
    const child = makeTask('child')
    const afterJoin = makeTask('after-join')
    const t1 = makeTask('t1', { groups: [makeGroup('g-child', [child])] })
    const t2 = makeTask('t2')
    const join = makeTask('join', { groups: [makeGroup('g-after-join', [afterJoin])] })
    const tail = makeTask('tail')
    const gChord = makeGroup('g-chord', [t1, t2], join)
    const gTail = makeGroup('g-tail', [tail])
    const workflow = makeWorkflow([gChord, gTail])

    expect(allTasks(workflow.groups).map((t) => t.id)).toEqual([
      't1',
      'child',
      't2',
      'join',
      'after-join',
      'tail',
    ])
    expect(everyTask(workflow).map((t) => t.id)).toEqual([
      't1',
      'child',
      't2',
      'join',
      'after-join',
      'tail',
    ])

    expect(findTask(workflow, 'join')).toBe(join)
    expect(findTask(workflow, 'after-join')).toBe(afterJoin)
    expect(findTask(workflow, 'missing')).toBeUndefined()

    const placed = everyGroup(workflow)
    expect(placed.map((p) => [p.group.id, p.parent?.id ?? null])).toEqual([
      ['g-chord', null],
      ['g-tail', null],
      ['g-child', 't1'],
      ['g-after-join', 'join'],
    ])

    expect(groupOf(workflow, 't2')).toEqual({ group: gChord, parent: null })
    expect(groupOf(workflow, 'join')).toEqual({ group: gChord, parent: null })
    expect(groupOf(workflow, 'child')).toEqual({ group: t1.groups[0], parent: t1 })
    expect(groupOf(workflow, 'missing')).toBeUndefined()
  })
})

describe('specFromTasks and tasksFromSpec', () => {
  it('round-trips groups, chord joins, options, checkbox booleans, and task ordering', () => {
    const options: WorkerOption[] = [
      {
        key: 'recursive',
        label: 'Recursive scan',
        description: 'Descend into archives',
        type: 'checkbox',
        default: 'false',
      },
      {
        key: 'verbose',
        label: 'Verbose',
        type: 'checkbox',
        default: 'true',
      },
      {
        key: 'min_length',
        label: 'Minimum length',
        type: 'text',
        default: '4',
        required: true,
      },
      {
        key: 'encoding',
        label: 'Encoding',
        type: 'select',
        default: 'utf-8',
        items: ['utf-8', 'utf-16le'],
      },
    ]

    const childA = makeTask('10000000000000000000000000000003')
    const childB = makeTask('10000000000000000000000000000004')
    const first = makeTask('10000000000000000000000000000001', {
      options,
      config: {
        recursive: 'true',
        verbose: 'false',
        min_length: '8',
        encoding: 'utf-16le',
      },
      groups: [makeGroup('g-nested', [childA, childB])],
    })
    const second = makeTask('10000000000000000000000000000002')

    const headerA = makeTask('20000000000000000000000000000001')
    const headerB = makeTask('20000000000000000000000000000002')
    const afterChord = makeTask('20000000000000000000000000000004')
    const chordJoin = makeTask('20000000000000000000000000000003', {
      groups: [makeGroup('g-post-join', [afterChord])],
    })

    const tail = makeTask('30000000000000000000000000000001')

    const originalGroups = [
      makeGroup('g-first', [first, second]),
      makeGroup('g-chord', [headerA, headerB], chordJoin),
      makeGroup('g-tail', [tail]),
    ]

    const spec = specFromTasks({ groups: originalGroups })
    expect(spec.workflow.type).toBe('chain')
    expect(spec.workflow.isRoot).toBe(true)

    // Checkbox values serialize as real booleans in the server spec.
    const firstSpecNode = spec.workflow.tasks[0]
    expect(firstSpecNode?.type).toBe('task')
    if (firstSpecNode?.type === 'task') {
      expect(firstSpecNode.task_config.map((opt) => [opt.name, opt.value])).toEqual([
        ['recursive', true],
        ['verbose', false],
        ['min_length', '8'],
        ['encoding', 'utf-16le'],
      ])
    }

    const chordSpecNode = spec.workflow.tasks[2]
    expect(chordSpecNode?.type).toBe('chord')

    const restored = tasksFromSpec(spec, [])
    expect(restored.groups).toHaveLength(3)

    const [restoredFirstGroup, restoredChordGroup, restoredTailGroup] = restored.groups
    expect(restoredFirstGroup?.id).toBe('g-first')
    expect(restoredFirstGroup?.tasks.map((t) => t.id)).toEqual([first.id, second.id])
    expect(restoredFirstGroup?.join).toBeUndefined()

    const restoredFirst = restoredFirstGroup?.tasks[0]
    expect(restoredFirst?.config).toEqual({
      recursive: 'true',
      verbose: 'false',
      min_length: '8',
      encoding: 'utf-16le',
    })
    expect(restoredFirst?.options).toEqual([
      {
        key: 'recursive',
        label: 'Recursive scan',
        description: 'Descend into archives',
        type: 'checkbox',
        default: 'true',
        required: undefined,
        items: undefined,
      },
      {
        key: 'verbose',
        label: 'Verbose',
        description: undefined,
        type: 'checkbox',
        default: 'false',
        required: undefined,
        items: undefined,
      },
      {
        key: 'min_length',
        label: 'Minimum length',
        description: undefined,
        type: 'text',
        default: '8',
        required: true,
        items: undefined,
      },
      {
        key: 'encoding',
        label: 'Encoding',
        description: undefined,
        type: 'select',
        default: 'utf-16le',
        required: undefined,
        items: ['utf-8', 'utf-16le'],
      },
    ])
    expect(restoredFirst?.groups).toHaveLength(1)
    expect(restoredFirst?.groups[0]?.id).toBe('g-nested')
    expect(restoredFirst?.groups[0]?.tasks.map((t) => t.id)).toEqual([childA.id, childB.id])

    expect(restoredChordGroup?.tasks.map((t) => t.id)).toEqual([headerA.id, headerB.id])
    expect(restoredChordGroup?.join?.id).toBe(chordJoin.id)
    expect(restoredChordGroup?.join?.groups[0]?.id).toBe('g-post-join')
    expect(restoredChordGroup?.join?.groups[0]?.tasks.map((t) => t.id)).toEqual([afterChord.id])

    expect(restoredTailGroup?.id).toBe('g-tail')
    expect(restoredTailGroup?.tasks.map((t) => t.id)).toEqual([tail.id])
  })

  it.each([
    ['SUCCESS', 'success'],
    ['FAILURE', 'failed'],
    ['REVOKED', 'failed'],
    ['REJECTED', 'failed'],
    ['RECEIVED', 'running'],
    ['STARTED', 'running'],
    ['started', 'running'],
    ['PROGRESS', 'running'],
    ['RETRY', 'running'],
    ['PENDING', 'pending'],
    [null, 'pending'],
  ] as const)('maps server status_short %s to %s', (statusShort, expected) => {
    const uuid = 'aabbccddeeff00112233445566778899'
    const spec = specFromTasks({ groups: [makeGroup('g1', [makeTask(uuid)])] })
    const dashedUuid = 'AABBCCDD-EEFF-0011-2233-445566778899'
    const { groups } = tasksFromSpec(spec, [makeRecord(dashedUuid, statusShort)])
    expect(groups[0]?.tasks[0]?.status).toBe(expected)
  })

  it('maps task runtime, non-deleted outputs, reports, and sorted file reports', () => {
    const uuid = '11112222333344445555666677778888'
    const spec = specFromTasks({ groups: [makeGroup('g1', [makeTask(uuid)])] })
    const { groups } = tasksFromSpec(spec, [
      makeRecord(uuid, 'SUCCESS', {
        created_at: '2026-11-01T01:00:00Z',
        runtime: 12.5,
        status_progress: '100%',
        output_files: [
          { id: 10, display_name: 'out.txt', is_deleted: false },
          { id: 11, display_name: 'gone.txt', is_deleted: true },
        ],
        task_report: { summary: 'Found hits', priority: 40, markdown: 'Details' },
        file_reports: [
          { summary: 'Low', priority: 10, markdown: 'low', file: { id: 10, display_name: 'a' } },
          { summary: 'High', priority: 80, markdown: 'high', file: { id: 12, display_name: 'b' } },
          { summary: '', markdown: '', file: { id: 13, display_name: 'empty' } },
        ],
      }),
    ])
    const task = groups[0]?.tasks[0]
    expect(task?.duration).toBe(12.5)
    expect(task?.outputs).toEqual([10])
    expect(task?.report).toEqual({ summary: 'Found hits', priority: 40, markdown: 'Details' })
    expect(task?.fileReports.map((r) => [r.fileId, r.priority])).toEqual([
      [12, 80],
      [10, 10],
    ])
  })

  it('marks tasks chained after a FAILURE and chord joins waiting on a failed header as skipped', () => {
    const grandchild = makeTask('grandchild')
    const child = makeTask('child', { groups: [makeGroup('g-grand', [grandchild])] })
    const failedRoot = makeTask('failed-root', { groups: [makeGroup('g-child', [child])] })

    const chordOk = makeTask('chord-ok')
    const chordFail = makeTask('chord-fail')
    const afterJoin = makeTask('after-join')
    const chordJoin = makeTask('chord-join', { groups: [makeGroup('g-after', [afterJoin])] })

    const unaffected = makeTask('unaffected')

    const spec = specFromTasks({
      groups: [
        makeGroup('g-chain', [failedRoot]),
        makeGroup('g-chord', [chordOk, chordFail], chordJoin),
        makeGroup('g-live', [unaffected]),
      ],
    })

    const { groups } = tasksFromSpec(spec, [
      makeRecord('failed-root', 'FAILURE', { error_exception: 'Boom' }),
      makeRecord('chord-ok', 'SUCCESS'),
      makeRecord('chord-fail', 'FAILURE'),
      makeRecord('chord-join', 'PENDING'),
    ])

    const byId = new Map(allTasks(groups).map((t) => [t.id, t.status]))
    expect(byId.get('failed-root')).toBe('failed')
    expect(byId.get('child')).toBe('skipped')
    expect(byId.get('grandchild')).toBe('skipped')
    expect(byId.get('chord-ok')).toBe('success')
    expect(byId.get('chord-fail')).toBe('failed')
    expect(byId.get('chord-join')).toBe('skipped')
    expect(byId.get('after-join')).toBe('skipped')
    expect(byId.get('unaffected')).toBe('pending')
  })
})

describe('parseSpec', () => {
  it.each([
    ['null input', null],
    ['empty string', ''],
    ['malformed JSON', '{not valid json'],
    ['JSON null', 'null'],
    ['JSON primitive', '42'],
    ['JSON array', '[]'],
    ['empty object', '{}'],
    ['missing tasks array', '{"workflow":{"type":"chain","isRoot":true}}'],
    ['non-array tasks', '{"workflow":{"type":"chain","isRoot":true,"tasks":{}}}'],
  ] as const)('returns null for %s', (_label, raw) => {
    expect(parseSpec(raw)).toBeNull()
  })

  it('parses a valid workflow spec JSON string', () => {
    const spec: WorkflowSpec = specFromTasks({
      groups: [makeGroup('g1', [makeTask('t1')])],
    })
    expect(parseSpec(JSON.stringify(spec))).toEqual(spec)
  })
})

describe('withFreshUuids', () => {
  it('replaces every task and chord callback uuid while preserving structure and config', () => {
    const nested = makeTask('00000000000000000000000000000002', {
      options: [{ key: 'k', label: 'Key', type: 'text', default: 'v' }],
      config: { k: 'v' },
    })
    const rootTask = makeTask('00000000000000000000000000000001', {
      groups: [makeGroup('g-nested', [nested])],
    })
    const chordA = makeTask('00000000000000000000000000000003')
    const chordB = makeTask('00000000000000000000000000000004')
    const afterCallback = makeTask('00000000000000000000000000000006')
    const callback = makeTask('00000000000000000000000000000005', {
      groups: [makeGroup('g-cb', [afterCallback])],
    })

    const original = specFromTasks({
      groups: [makeGroup('g-root', [rootTask]), makeGroup('g-chord', [chordA, chordB], callback)],
    })
    const snapshot = JSON.stringify(original)

    const refreshed = withFreshUuids(original)

    // Input spec is not mutated.
    expect(JSON.stringify(original)).toBe(snapshot)

    const originalIds = new Set(allTasks(tasksFromSpec(original, []).groups).map((t) => t.id))
    const refreshedTasks = allTasks(tasksFromSpec(refreshed, []).groups)
    const refreshedIds = refreshedTasks.map((t) => t.id)

    expect(refreshedIds).toHaveLength(6)
    expect(new Set(refreshedIds).size).toBe(6)
    for (const id of refreshedIds) {
      expect(id).toMatch(/^[0-9a-f]{32}$/)
      expect(originalIds.has(id)).toBe(false)
    }

    // Structure, module names, group markers, and config survive unchanged.
    expect(refreshedTasks.map((t) => [t.module, t.config])).toEqual(
      allTasks(tasksFromSpec(original, []).groups).map((t) => [t.module, t.config]),
    )
    const firstRefreshed = refreshed.workflow.tasks[0]
    expect(firstRefreshed?.type === 'task' ? firstRefreshed.group : undefined).toBe('g-root')
  })
})

describe('runBlocker', () => {
  it('blocks when no groups exist', () => {
    expect(runBlocker({ groups: [] }, null)).toBe('Add a worker first.')
  })

  it('blocks when a required option is empty or whitespace', () => {
    const task = makeTask('yara', {
      name: 'YARA',
      options: [
        { key: 'rules', label: 'YARA rules', type: 'textarea', default: '', required: true },
        { key: 'note', label: 'Note', type: 'text', default: '' },
      ],
      config: { rules: '   ', note: '' },
    })
    expect(runBlocker({ groups: [makeGroup('g1', [task])] }, null)).toBe('YARA needs YARA rules.')
  })

  it('blocks when a task worker is offline and allows running when online or availability is unknown', () => {
    const strings = makeTask('strings', {
      name: 'Strings',
      module: 'openrelik-worker-strings.tasks.strings',
      options: [{ key: 'min', label: 'Min length', type: 'text', default: '4', required: true }],
      config: { min: '6' },
    })
    const groups = [makeGroup('g1', [strings])]

    expect(runBlocker({ groups }, new Set(['openrelik-worker-other.tasks.run']))).toBe(
      'Strings: no worker is online for it.',
    )
    expect(runBlocker({ groups }, null)).toBeNull()
    expect(runBlocker({ groups }, new Set(['openrelik-worker-strings.tasks.strings']))).toBeNull()
  })
})

describe('group, join, merge, and chaining predicates', () => {
  it('evaluates canJoin for single, free, joined, and chained groups', () => {
    const free = makeGroup('free', [makeTask('a'), makeTask('b')])
    const single = makeGroup('single', [makeTask('a')])
    const alreadyJoined = makeGroup('joined', [makeTask('a'), makeTask('b')], makeTask('j'))
    const withChild = makeGroup('chained', [
      makeTask('a', { groups: [makeGroup('c', [makeTask('after')])] }),
      makeTask('b'),
    ])

    expect(canJoin(free)).toBe(true)
    expect(canJoin(single)).toBe(false)
    expect(canJoin(alreadyJoined)).toBe(false)
    expect(canJoin(withChild)).toBe(false)
  })

  it('evaluates canJoinAll across sibling groups', () => {
    const g1 = makeGroup('g1', [makeTask('a')])
    const g2 = makeGroup('g2', [makeTask('b')])
    const joined = makeGroup('gj', [makeTask('c'), makeTask('d')], makeTask('j'))
    const chained = makeGroup('gc', [
      makeTask('e', { groups: [makeGroup('sub', [makeTask('f')])] }),
    ])

    expect(canJoinAll([g1, g2])).toBe(true)
    expect(canJoinAll([g1])).toBe(false)
    expect(canJoinAll([])).toBe(false)
    expect(canJoinAll([g1, joined])).toBe(false)
    expect(canJoinAll([g1, chained])).toBe(false)
  })

  it('reports mergeProblem reasons and returns null for valid merges', () => {
    const plainA = makeGroup('a', [makeTask('t1')])
    const plainB = makeGroup('b', [makeTask('t2')])
    const joinedA = makeGroup('ja', [makeTask('t3'), makeTask('t4')], makeTask('j1'))
    const joinedB = makeGroup('jb', [makeTask('t5'), makeTask('t6')], makeTask('j2'))
    const withDownstream = makeGroup('down', [
      makeTask('t7', { groups: [makeGroup('sub', [makeTask('t8')])] }),
    ])

    expect(mergeProblem([plainA])).toBe('Pick two or more groups.')
    expect(mergeProblem([joinedA, joinedB])).toContain('more than one of these groups')
    expect(mergeProblem([joinedA, withDownstream])).toContain(
      'one group has workers after its tasks',
    )

    expect(mergeProblem([plainA, plainB])).toBeNull()
    expect(mergeProblem([joinedA, plainA])).toBeNull()
    expect(mergeProblem([plainA, withDownstream])).toBeNull()
  })

  it('marks chord header tasks unchainable while allowing chaining after joins and plain tasks', () => {
    const h1 = makeTask('h1')
    const h2 = makeTask('h2')
    const join = makeTask('join')
    const plain = makeTask('plain')
    const workflow = makeWorkflow([
      makeGroup('g-chord', [h1, h2], join),
      makeGroup('g-plain', [plain]),
    ])

    expect(unchainable(workflow)).toEqual(new Set(['h1', 'h2']))
    expect(canChainAfter(workflow, 'h1')).toBe(false)
    expect(canChainAfter(workflow, 'h2')).toBe(false)
    expect(canChainAfter(workflow, 'join')).toBe(true)
    expect(canChainAfter(workflow, 'plain')).toBe(true)
  })
})

describe('isActive and runStats across workflow lifecycles', () => {
  it('treats draft workflows as inactive with state draft', () => {
    const workflow = makeWorkflow([makeGroup('g1', [makeTask('t1', { status: 'pending' })])], {
      draft: true,
    })

    expect(isActive(workflow)).toBe(false)
    expect(runStats(workflow)).toEqual({
      done: 0,
      failed: 0,
      running: 0,
      total: 1,
      elapsed: 0,
      state: 'draft',
    })
  })

  it('reports pending state for a non-draft workflow with zero tasks', () => {
    const workflow = makeWorkflow([], { draft: false })
    expect(isActive(workflow)).toBe(false)
    expect(runStats(workflow).state).toBe('pending')
  })

  it('tracks active running chains and computes slowest-path elapsed time', () => {
    const childRunning = makeTask('child', { status: 'running', duration: 4 })
    const fastBranch = makeTask('fast', { status: 'success', duration: 6 })
    const parentDone = makeTask('parent', {
      status: 'success',
      duration: 5,
      groups: [makeGroup('g-child', [childRunning])],
    })
    const chordJoinPending = makeTask('join', { status: 'pending' })
    const chordA = makeTask('ca', { status: 'success', duration: 3 })
    const chordB = makeTask('cb', { status: 'success', duration: 7 })

    const workflow = makeWorkflow([
      makeGroup('g1', [parentDone, fastBranch]),
      makeGroup('g2', [chordA, chordB], chordJoinPending),
    ])

    expect(isActive(workflow)).toBe(true)
    // Group 1 slowest line: max(5 + 4, 6) = 9. Group 2 slowest line: max(3, 7) + 0 = 7.
    expect(runStats(workflow)).toEqual({
      done: 4,
      failed: 0,
      running: 1,
      total: 6,
      elapsed: 9,
      state: 'running',
    })
  })

  it('stops treating failed chains and failed chords as active once live siblings finish', () => {
    const downstreamQueued = makeTask('downstream', { status: 'pending' })
    const failedRoot = makeTask('failed-root', {
      status: 'failed',
      duration: 2,
      groups: [makeGroup('g-down', [downstreamQueued])],
    })
    const chordOk = makeTask('chord-ok', { status: 'success', duration: 4 })
    const chordFailed = makeTask('chord-failed', { status: 'failed', duration: 1 })
    const blockedJoin = makeTask('blocked-join', { status: 'pending' })

    const settledFailure = makeWorkflow([
      makeGroup('g1', [failedRoot]),
      makeGroup('g2', [chordOk, chordFailed], blockedJoin),
    ])

    expect(isActive(settledFailure)).toBe(false)
    expect(runStats(settledFailure)).toEqual({
      done: 1,
      failed: 2,
      running: 0,
      total: 5,
      elapsed: 4,
      state: 'failed',
    })

    // While an independent branch is still running, the workflow remains active.
    const withLiveBranch = makeWorkflow([
      ...settledFailure.groups,
      makeGroup('g3', [makeTask('still-running', { status: 'running', duration: 10 })]),
    ])
    expect(isActive(withLiveBranch)).toBe(true)
    expect(runStats(withLiveBranch).state).toBe('running')
  })

  it('reports success and full chain duration for a completed workflow', () => {
    const postJoin = makeTask('post-join', { status: 'success', duration: 2 })
    const join = makeTask('join', {
      status: 'success',
      duration: 3,
      groups: [makeGroup('g-post', [postJoin])],
    })
    const h1 = makeTask('h1', { status: 'success', duration: 4 })
    const h2 = makeTask('h2', { status: 'success', duration: 8 })
    const workflow = makeWorkflow([makeGroup('g-chord', [h1, h2], join)])

    expect(isActive(workflow)).toBe(false)
    // Elapsed: max(4, 8) + (3 + 2) = 13.
    expect(runStats(workflow)).toEqual({
      done: 4,
      failed: 0,
      running: 0,
      total: 4,
      elapsed: 13,
      state: 'success',
    })
  })

  it('handles spec edge cases: missing queue_name/uuid, empty/callback-only chords, and empty-header groups', () => {
    const fallbackSpec: WorkflowSpec = {
      workflow: {
        type: 'chain',
        isRoot: true,
        tasks: [
          {
            type: 'task',
            uuid: '',
            task_name: 'openrelik-worker-yara.tasks.scan',
            queue_name: '',
            display_name: '',
            task_config: [],
            tasks: [],
          },
          {
            type: 'chord',
            // Empty chord with no tasks or callback is skipped cleanly.
          },
          {
            type: 'chord',
            callback: {
              type: 'task',
              uuid: 'cb-uuid',
              task_name: 'openrelik-worker-merge.tasks.merge',
              queue_name: 'merge-q',
              display_name: 'Merge',
              task_config: [],
              tasks: [],
            },
          },
        ],
      },
    }

    const records: WorkflowTaskRecord[] = [
      { id: 1, uuid: null, display_name: 'Ignored', status_short: 'SUCCESS' },
      { id: 2, uuid: 'cb-uuid', display_name: 'Merge', status_short: 'SUCCESS' },
    ]
    const parsed = tasksFromSpec(fallbackSpec, records)
    expect(parsed.groups).toHaveLength(2)
    expect(parsed.groups[0]?.tasks[0]?.id).toMatch(/^[0-9a-f]+$/)
    expect(parsed.groups[0]?.tasks[0]?.queue).toBe('openrelik-worker-yara')
    expect(parsed.groups[0]?.tasks[0]?.name).toBe('openrelik-worker-yara.tasks.scan')
    expect(parsed.groups[1]?.tasks[0]?.id).toBe('cb-uuid')
    expect(parsed.groups[1]?.tasks[0]?.status).toBe('success')

    // specFromTasks skips groups whose tasks array is empty.
    const wf = makeWorkflow([makeGroup('empty', []), makeGroup('real', [makeTask('t1')])])
    const serialized = specFromTasks(wf)
    expect(serialized.workflow.tasks).toHaveLength(1)
  })
})
