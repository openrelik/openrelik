import { describe, expect, it } from 'vitest'

import { PRIORITY_TONE, priorityLevel, type PriorityLevel } from '@/utils/report'

describe('utils/report', () => {
  it.each<[number, PriorityLevel]>([
    [100, 'critical'],
    [80, 'critical'],
    [79, 'high'],
    [40, 'high'],
    [39, 'medium'],
    [20, 'medium'],
    [19, 'low'],
    [10, 'low'],
    [9, 'info'],
    [0, 'info'],
    [-5, 'info'],
  ])('maps numeric priority %d to %s', (score, expected) => {
    expect(priorityLevel(score)).toBe(expected)
    expect(PRIORITY_TONE[priorityLevel(score)]).toBeTruthy()
  })
})
