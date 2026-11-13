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

import { describe, expect, it } from 'vitest'

import {
  buildGraphEdges,
  buildGraphGhosts,
  buildGroupBesides,
  buildGroupBoxes,
  buildStackSummary,
  buildStackToggles,
  COL_GAP,
  computeGraphLayout,
  GROUP_PAD,
  NODE_H,
  NODE_W,
  nodeX,
  nodeY,
  PAD,
  ROW_GAP,
  stackStatus,
} from '@/components/workflow/graphLayout'
import type { Task, TaskGroup, Workflow } from '@/types/workflow'

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
    folderId: 100,
    name: 'Test workflow',
    created: '2026-11-01T00:00:00Z',
    inputs: [{ id: 1, name: 'disk.dd' }],
    groups: [],
    draft: false,
    ...overrides,
  }
}

describe('graphLayout', () => {
  it('lays out an empty draft with single input dimensions', () => {
    const wf = makeWorkflow({ draft: true, groups: [] })
    const layout = computeGraphLayout(wf, {
      editable: true,
      isStacked: () => false,
      inputSpan: NODE_H,
      inputPad: 0,
    })

    expect(layout.nodes).toHaveLength(1)
    expect(layout.nodes[0]?.key).toBe('input')
    expect(layout.nodes[0]?.top).toBe(PAD)
    expect(layout.width).toBe(PAD * 2 + NODE_W)
    expect(layout.height).toBe(PAD * 2 + NODE_H)
    expect(buildGraphEdges(layout, NODE_H, 0)).toEqual([])
    expect(buildGroupBoxes(layout)).toEqual([])
  })

  it('places wide fan-out groups without vertical overlap and builds boxes/toggles/besides', () => {
    const tasks = [1, 2, 3, 4].map((n) => makeTask(`t${n}`))
    const wf = makeWorkflow({
      draft: true,
      groups: [makeGroup('g-wide', tasks)],
    })
    const layout = computeGraphLayout(wf, {
      editable: true,
      isStacked: () => false,
      inputSpan: NODE_H,
      inputPad: 0,
    })

    const taskNodes = layout.nodes.filter((n) => n.task)
    expect(taskNodes).toHaveLength(4)
    for (let i = 1; i < taskNodes.length; i++) {
      expect(taskNodes[i]!.top - taskNodes[i - 1]!.top).toBe(NODE_H + ROW_GAP)
    }

    const boxes = buildGroupBoxes(layout)
    expect(boxes).toHaveLength(1)
    expect(boxes[0]!.width).toBe(NODE_W + GROUP_PAD * 2)

    const toggles = buildStackToggles(layout, () => false)
    expect(toggles).toHaveLength(1)
    expect(toggles[0]!.open).toBe(true)

    const ghosts = buildGraphGhosts(layout, NODE_H, 0)
    expect(ghosts).toHaveLength(1)
    expect(ghosts[0]!.at).toEqual({ join: 'g-wide' })

    const besides = buildGroupBesides(layout)
    expect(besides).toHaveLength(1)
    expect(besides[0]!.after.id).toBe('t4')
  })

  it('handles nested chords, header tasks with children, and downstream chains after joins', () => {
    const inner1 = makeTask('i1')
    const inner2 = makeTask('i2')
    const innerJoin = makeTask('ij')
    const headerA = makeTask('ha', {
      groups: [makeGroup('g-inner', [inner1, inner2], innerJoin)],
    })
    const headerB = makeTask('hb')
    const outerJoin = makeTask('oj')
    const afterOuter = makeTask('after')
    outerJoin.groups = [makeGroup('g-after', [afterOuter])]

    const wf = makeWorkflow({
      groups: [makeGroup('g-outer', [headerA, headerB], outerJoin)],
    })
    const layout = computeGraphLayout(wf, {
      editable: false,
      isStacked: () => false,
      inputSpan: NODE_H,
      inputPad: 0,
    })

    const byKey = new Map(layout.nodes.map((n) => [n.key, n]))
    expect(byKey.get('ha')?.depth).toBe(1)
    expect(byKey.get('i1')?.depth).toBe(2)
    expect(byKey.get('ij')?.depth).toBe(3)
    expect(byKey.get('oj')?.depth).toBe(4)
    expect(byKey.get('oj')?.waitsFor).toBe(2)
    expect(byKey.get('after')?.depth).toBe(5)
    expect(layout.width).toBe(PAD * 2 + 6 * NODE_W + 5 * COL_GAP)

    // Edges: 1 into outer box + 1 into inner box + 2 inner->ij + 2 outer tails (ij, hb)->oj + 1 oj->after = 7
    const edges = buildGraphEdges(layout, NODE_H, 0)
    expect(edges).toHaveLength(7)
    for (const node of layout.nodes) {
      expect(nodeX(node)).toBeGreaterThanOrEqual(PAD)
      expect(nodeY(node)).toBeGreaterThanOrEqual(PAD)
    }
  })

  it('folds stackable tasks beside chained tasks and creates joinAll fans for sibling groups', () => {
    const chained = makeTask('chained', { groups: [makeGroup('g-sub', [makeTask('sub')])] })
    const fold1 = makeTask('f1', { module: 'm.strings', name: 'Strings', status: 'failed' })
    const fold2 = makeTask('f2', { module: 'm.strings', name: 'Strings', status: 'running' })
    const wf = makeWorkflow({
      draft: true,
      groups: [makeGroup('g-mix', [chained, fold1, fold2])],
    })
    const stackedLayout = computeGraphLayout(wf, {
      editable: true,
      isStacked: (g) => g.id === 'g-mix',
      inputSpan: NODE_H,
      inputPad: 0,
    })
    expect(stackedLayout.nodes.some((n) => n.key === 'g-mix:stack')).toBe(true)
    expect(buildStackToggles(stackedLayout, () => true)[0]?.open).toBe(false)

    // Two free sibling groups produce a joinAll fan ghost.
    const fanWf = makeWorkflow({
      draft: true,
      groups: [makeGroup('sg1', [makeTask('a1')]), makeGroup('sg2', [makeTask('a2')])],
    })
    const fanLayout = computeGraphLayout(fanWf, {
      editable: true,
      isStacked: () => false,
      inputSpan: NODE_H,
      inputPad: 0,
    })
    const fanGhosts = buildGraphGhosts(fanLayout, NODE_H, 0)
    expect(fanGhosts).toHaveLength(1)
    expect(fanGhosts[0]?.at).toEqual({ joinAll: null })
  })

  it('computes stackStatus and buildStackSummary for homogeneous/mixed groups and draft needs', () => {
    const sameGroup = makeGroup('gs', [
      makeTask('s1', { module: 'm.a', name: 'A', status: 'failed' }),
      makeTask('s2', { module: 'm.a', name: 'A', status: 'skipped' }),
      makeTask('s3', { module: 'm.a', name: 'A', status: 'success' }),
    ])
    expect(stackStatus(sameGroup)).toBe('failed')
    expect(buildStackSummary(sameGroup, false)).toMatchObject({
      name: 'A',
      times: '×3',
      line: '1/3 done · 1 failed · 1 won’t run',
    })

    const mixedDraft = makeGroup('gm', [
      makeTask('m1', {
        module: 'm.a',
        options: [{ key: 'k', label: 'Key', type: 'text', default: '', required: true }],
        config: {},
      }),
      makeTask('m2', { module: 'm.b', status: 'pending' }),
    ])
    expect(stackStatus(mixedDraft)).toBe('pending')
    expect(buildStackSummary(mixedDraft, true)).toMatchObject({
      name: '2 workers',
      times: '',
      line: '1 need options',
    })
  })

  it('skips empty groups safely and curves ghost join links when the join sits lower than group middle', () => {
    // Empty groups should not crash layout or ghost generation.
    const withEmpty = makeWorkflow({
      draft: true,
      groups: [makeGroup('g-empty', []), makeGroup('g-real', [makeTask('r1'), makeTask('r2')])],
    })
    const emptySafe = computeGraphLayout(withEmpty, {
      editable: true,
      isStacked: () => false,
      inputSpan: NODE_H,
      inputPad: 0,
    })
    expect(emptySafe.groups).toHaveLength(1)
    expect(emptySafe.groups[0]?.group.id).toBe('g-real')

    // A preceding sibling's deeper branch occupies the join column past g-top's midpoint,
    // pushing g-top's ghost join downward so its link curves smoothly from the group's middle.
    const tallAbove = makeTask('a0', {
      groups: [
        makeGroup('g-ac', [
          makeTask('ac1'),
          makeTask('ac2'),
          makeTask('ac3'),
          makeTask('ac4'),
          makeTask('ac5'),
        ]),
      ],
    })
    const gTop = makeGroup('g-top', [makeTask('t1'), makeTask('t2')])
    const wf = makeWorkflow({
      draft: true,
      groups: [makeGroup('g-above', [tallAbove]), gTop],
    })
    const layout = computeGraphLayout(wf, {
      editable: true,
      isStacked: () => false,
      inputSpan: NODE_H,
      inputPad: 0,
    })
    const ghosts = buildGraphGhosts(layout, NODE_H, 0)
    const topGhost = ghosts.find((g) => 'join' in g.at && g.at.join === 'g-top')
    expect(topGhost).toBeDefined()
    // Cubic Bezier curve connects group midpoint y (168) to pushed-down join midpoint y (394).
    expect(topGhost!.link).toContain(' C ')
    expect(topGhost!.link).toMatch(/^M [\d.]+ 168 .* 394$/)
  })
})
