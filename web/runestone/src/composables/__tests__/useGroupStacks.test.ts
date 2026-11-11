import { describe, expect, it } from 'vitest'

import { foldable, STACK_MIN, stackable, useGroupStacks } from '@/composables/useGroupStacks'
import type { Task, TaskGroup } from '@/types/workflow'

function makeTask(id: string, groups: TaskGroup[] = []): Task {
  return {
    id,
    name: `Task ${id}`,
    module: `worker.${id}`,
    queue: 'default',
    status: 'pending',
    outputs: [],
    fileReports: [],
    options: [],
    config: {},
    groups,
  }
}

describe('useGroupStacks', () => {
  it('identifies foldable leaf tasks and stackable groups (at least 2 foldable tasks)', () => {
    expect(STACK_MIN).toBe(3)

    const single: TaskGroup = { id: 'gs-single', tasks: [makeTask('t1')] }
    expect(foldable(single)).toHaveLength(1)
    expect(stackable(single)).toBe(false)

    const withDownstream: TaskGroup = {
      id: 'gs-downstream',
      tasks: [
        makeTask('t1', [{ id: 'child-1', tasks: [makeTask('c1')] }]),
        makeTask('t2', [{ id: 'child-2', tasks: [makeTask('c2')] }]),
        makeTask('t3'),
      ],
    }
    expect(foldable(withDownstream).map((t) => t.id)).toEqual(['t3'])
    expect(stackable(withDownstream)).toBe(false)

    const twoFoldable: TaskGroup = {
      id: 'gs-two',
      tasks: [makeTask('a'), makeTask('b')],
    }
    expect(foldable(twoFoldable)).toHaveLength(2)
    expect(stackable(twoFoldable)).toBe(true)
  })

  it('defaults groups >= STACK_MIN to stacked, smaller stackable groups to open, and remembers user toggles', () => {
    const stacks = useGroupStacks()
    const nonStackable: TaskGroup = { id: 'u-non-stackable', tasks: [makeTask('solo')] }
    const pairGroup: TaskGroup = { id: 'u-pair', tasks: [makeTask('p1'), makeTask('p2')] }
    const tripleGroup: TaskGroup = {
      id: 'u-triple',
      tasks: [makeTask('r1'), makeTask('r2'), makeTask('r3')],
    }

    expect(stacks.isStacked(nonStackable)).toBe(false)
    expect(stacks.isStacked(pairGroup)).toBe(false)
    expect(stacks.isStacked(tripleGroup)).toBe(true)

    // Explicit closeStack stacks a 2-task group, while non-stackable remains false.
    stacks.closeStack(pairGroup.id)
    stacks.closeStack(nonStackable.id)
    expect(stacks.isStacked(pairGroup)).toBe(true)
    expect(stacks.isStacked(nonStackable)).toBe(false)

    // openStack unfolds a 3-task group.
    stacks.openStack(tripleGroup.id)
    expect(stacks.isStacked(tripleGroup)).toBe(false)

    // stackAll folds all stackable groups; openAll unfolds all of them.
    const all = [nonStackable, pairGroup, tripleGroup]
    stacks.openAll(all)
    expect(stacks.isStacked(pairGroup)).toBe(false)
    expect(stacks.isStacked(tripleGroup)).toBe(false)

    stacks.stackAll(all)
    expect(stacks.isStacked(nonStackable)).toBe(false)
    expect(stacks.isStacked(pairGroup)).toBe(true)
    expect(stacks.isStacked(tripleGroup)).toBe(true)
  })

  it('tracks input-file stacking per workflow ID (stacked by default)', () => {
    const stacks = useGroupStacks()
    const workflowId = 404

    expect(stacks.inputsStacked(workflowId)).toBe(true)

    stacks.setInputsStacked(workflowId, false)
    expect(stacks.inputsStacked(workflowId)).toBe(false)

    stacks.setInputsStacked(workflowId, true)
    expect(stacks.inputsStacked(workflowId)).toBe(true)
  })
})
