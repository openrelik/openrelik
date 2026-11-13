import { describe, expect, it } from 'vitest'

import { count, formatDuration, formatSize, stamp } from '@/utils/format'

describe('stamp', () => {
  it.each([
    ['2026-04-29T15:00:50.123456Z', '2026-04-29 15:00:50'],
    ['2026-04-29T15:00:50.5Z', '2026-04-29 15:00:50'],
    ['2026-04-29T15:00:50Z', '2026-04-29 15:00:50'],
    ['2026-04-29T15:00:50.987654+02:00', '2026-04-29 15:00:50'],
    ['2026-04-29T15:00:50-05:30', '2026-04-29 15:00:50'],
    ['  2026-04-29 15:00:50  ', '2026-04-29 15:00:50'],
    ['', ''],
  ])('formats %j as %j', (input, expected) => {
    expect(stamp(input)).toBe(expected)
  })
})

describe('formatSize', () => {
  it.each([
    [0, '0 B'],
    [1, '1 B'],
    [999, '999 B'],
    [1000, '1.00 kB'],
    [297_720, '297.72 kB'],
    [1_000_000, '1.00 MB'],
    [1_500_000, '1.50 MB'],
    [1_000_000_000, '1.00 GB'],
    [2_345_000_000, '2.35 GB'],
    [1_000_000_000_000, '1.00 TB'],
    [1_500_000_000_000_000, '1500.00 TB'],
  ])('formats %d bytes as %s', (bytes, expected) => {
    expect(formatSize(bytes)).toBe(expected)
  })
})

describe('count', () => {
  it.each([
    [0, 'dir', undefined, '0 dirs'],
    [1, 'dir', undefined, '1 dir'],
    [3, 'dir', undefined, '3 dirs'],
    [0, 'match', 'matches', '0 matches'],
    [1, 'match', 'matches', '1 match'],
    [2, 'match', 'matches', '2 matches'],
  ])('formats (%d, %j, %j) as %j', (n, noun, plural, expected) => {
    expect(count(n, noun, plural)).toBe(expected)
  })
})

describe('formatDuration', () => {
  it.each([
    [0, '0s'],
    [0.04, '0s'],
    [2.4, '2.4s'],
    [2.0, '2s'],
    [59.4, '59.4s'],
    [59.96, '1m 00s'],
    [60, '1m 00s'],
    [65, '1m 05s'],
    [72, '1m 12s'],
    [125.4, '2m 05s'],
    [3661, '61m 01s'],
  ])('formats %d seconds as %s', (seconds, expected) => {
    expect(formatDuration(seconds)).toBe(expected)
  })

  it('carries a rounded 60s remainder into the next minute', () => {
    expect(formatDuration(119.6)).toBe('2m 00s')
  })
})
