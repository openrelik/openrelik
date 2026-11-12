import { describe, expect, it } from 'vitest'

import { formatMoment, formatTime, formatValue, niceTicks, timeTicks } from '@/utils/chart'

describe('niceTicks', () => {
  it('starts at 0 for positive ranges and covers max with round steps', () => {
    const ticks = niceTicks(10, 95, 4)
    expect(ticks[0]).toBe(0)
    expect(ticks.at(-1)).toBeGreaterThanOrEqual(95)
    expect(ticks).toEqual([0, 25, 50, 75, 100])
  })

  it('appends a top tick when max exceeds the last loop step', () => {
    const ticks = niceTicks(0, 7, 4)
    expect(ticks[0]).toBe(0)
    expect(ticks.at(-1)).toBe(8)
  })

  it('includes negative ticks when min is below 0', () => {
    const ticks = niceTicks(-18, 35, 5)
    expect(ticks[0]).toBeLessThanOrEqual(-18)
    expect(ticks.at(-1)).toBeGreaterThanOrEqual(35)
    expect(ticks).toContain(0)
  })

  it('handles flat or zero ranges without NaN or infinite loops', () => {
    const ticks = niceTicks(0, 0)
    expect(ticks[0]).toBe(0)
    expect(ticks.at(-1)).toBe(1)
    expect(ticks.length).toBeGreaterThanOrEqual(2)
  })

  it('guards non-finite bounds and non-positive tick counts', () => {
    expect(niceTicks(Number.NaN, 10)).toEqual([0, 1])
    expect(niceTicks(0, Number.POSITIVE_INFINITY)).toEqual([0, 1])
    expect(niceTicks(0, 5, 0)).toEqual([0, 5])
  })
})

describe('formatValue', () => {
  it.each([
    [0, '0'],
    [42, '42'],
    [-7, '-7'],
    [3.14159, '3.14'],
    [-0.5, '-0.50'],
    [12_300, '12.3k'],
    [250_000, '250k'],
    [-15_400, '-15.4k'],
    [2_500_000, '2.5M'],
    [15_000_000, '15M'],
    [-25_000_000, '-25M'],
  ])('formats %d as %s', (input, expected) => {
    expect(formatValue(input)).toBe(expected)
  })
})

describe('timeTicks', () => {
  it('returns aligned ticks within [start, end] across short and multi-day spans', () => {
    const start = new Date(2026, 2, 10, 12, 1, 0).getTime()
    const end = new Date(2026, 2, 10, 13, 1, 0).getTime()
    const ticks = timeTicks(start, end, 5)

    expect(ticks.length).toBeGreaterThan(0)
    expect(ticks[0]).toBeGreaterThanOrEqual(start)
    expect(ticks.at(-1)).toBeLessThanOrEqual(end)
  })

  it('falls back to span / count for spans larger than the predefined step table', () => {
    const start = new Date(2020, 0, 1).getTime()
    const end = new Date(2026, 0, 1).getTime()
    const ticks = timeTicks(start, end, 4)

    expect(ticks.length).toBeGreaterThanOrEqual(3)
    expect(ticks[0]).toBeGreaterThanOrEqual(start)
    expect(ticks.at(-1)).toBeLessThanOrEqual(end)
  })

  it('handles zero-length spans cleanly', () => {
    const instant = new Date(2026, 2, 10, 12, 0, 0).getTime()
    const ticks = timeTicks(instant, instant, 5)
    expect(Array.isArray(ticks)).toBe(true)
  })

  it('returns empty array for non-finite bounds or non-positive count', () => {
    expect(timeTicks(Number.NaN, 1000, 5)).toEqual([])
    expect(timeTicks(0, Number.POSITIVE_INFINITY, 5)).toEqual([])
    expect(timeTicks(0, 60_000, 0)).toEqual([])
  })
})

describe('formatTime and formatMoment', () => {
  const sample = new Date(2026, 3, 5, 9, 7, 4).getTime()

  it('shows HH:MM for spans up to 1 day', () => {
    expect(formatTime(sample, 3600e3)).toBe('09:07')
    expect(formatTime(sample, 86400e3)).toBe('09:07')
  })

  it('shows MM-DD HH:MM for spans between 1 and 3 days', () => {
    expect(formatTime(sample, 2 * 86400e3)).toBe('04-05 09:07')
    expect(formatTime(sample, 3 * 86400e3)).toBe('04-05 09:07')
  })

  it('shows YYYY-MM-DD for spans longer than 3 days', () => {
    expect(formatTime(sample, 7 * 86400e3)).toBe('2026-04-05')
  })

  it('formats full tooltip moments with seconds', () => {
    expect(formatMoment(sample)).toBe('2026-04-05 09:07:04')
  })
})
