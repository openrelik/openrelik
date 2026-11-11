import { describe, expect, it } from 'vitest'

import { lineMatcher, rowSegments } from '@/utils/textSearch'

describe('lineMatcher', () => {
  it('escapes regex metacharacters in literal mode', () => {
    const result = lineMatcher('a.b*c+[d](e){1}^$f|g\\h', {
      caseSensitive: true,
      regex: false,
    })
    expect('matcher' in result).toBe(true)
    if (!('matcher' in result)) return

    expect(result.matcher('xx a.b*c+[d](e){1}^$f|g\\h yy')).toEqual([[3, 25]])
    expect(result.matcher('xx axbcccd(e)f yy')).toEqual([])
  })

  it('respects caseSensitivity without shifting offsets', () => {
    const insensitive = lineMatcher('foo', { caseSensitive: false, regex: false })
    const sensitive = lineMatcher('Foo', { caseSensitive: true, regex: false })
    if (!('matcher' in insensitive) || !('matcher' in sensitive)) {
      throw new Error('Expected matchers')
    }

    expect(insensitive.matcher('FOO bar Foo baz')).toEqual([
      [0, 3],
      [8, 11],
    ])
    expect(sensitive.matcher('FOO bar Foo baz')).toEqual([[8, 11]])
  })

  it('returns { error } for invalid regular expressions', () => {
    for (const bad of ['[unclosed', '(?invalid)', '*']) {
      const result = lineMatcher(bad, { caseSensitive: false, regex: true })
      expect('error' in result).toBe(true)
      if ('error' in result) expect(result.error.length).toBeGreaterThan(0)
    }
  })

  it('skips zero-width regex matches and advances cleanly without hanging', () => {
    const star = lineMatcher('a*', { caseSensitive: true, regex: true })
    const boundary = lineMatcher('\\b', { caseSensitive: true, regex: true })
    const empty = lineMatcher('', { caseSensitive: false, regex: false })
    if (!('matcher' in star) || !('matcher' in boundary) || !('matcher' in empty)) {
      throw new Error('Expected matchers')
    }

    expect(star.matcher('baaac')).toEqual([[1, 4]])
    expect(star.matcher('xyz')).toEqual([])
    expect(boundary.matcher('hello world')).toEqual([])
    expect(empty.matcher('anything')).toEqual([])
  })

  it('resets regex state across repeated line calls', () => {
    const hex = lineMatcher('0x[0-9a-f]+', { caseSensitive: false, regex: true })
    if (!('matcher' in hex)) throw new Error('Expected matcher')

    expect(hex.matcher('at 0x1a and 0xFF')).toEqual([
      [3, 7],
      [12, 16],
    ])
    expect(hex.matcher('next 0x00')).toEqual([[5, 9]])
  })
})

describe('rowSegments', () => {
  it('returns a single plain segment when there are no hits or text is empty', () => {
    expect(rowSegments('plain text', 0, [])).toEqual([{ text: 'plain text', mark: 'none' }])
    expect(rowSegments('', 0, [])).toEqual([{ text: '', mark: 'none' }])
  })

  it('marks hit and current segments and omits empty gaps', () => {
    const hits = [
      { start: 0, end: 2, current: false },
      { start: 2, end: 5, current: true },
      { start: 8, end: 10, current: false },
    ]
    expect(rowSegments('abcdefghij', 0, hits)).toEqual([
      { text: 'ab', mark: 'hit' },
      { text: 'cde', mark: 'current' },
      { text: 'fgh', mark: 'none' },
      { text: 'ij', mark: 'hit' },
    ])
  })

  it('splits a match spanning sub-row boundaries and ignores hits outside the row', () => {
    const hits = [
      { start: 1, end: 3, current: false },
      { start: 4, end: 14, current: true },
      { start: 16, end: 18, current: false },
    ]

    // Sub-row 0: [0, 6)
    expect(rowSegments('012345', 0, hits)).toEqual([
      { text: '0', mark: 'none' },
      { text: '12', mark: 'hit' },
      { text: '3', mark: 'none' },
      { text: '45', mark: 'current' },
    ])

    // Sub-row 1: [6, 12) — entirely covered by the spanning current hit
    expect(rowSegments('6789ab', 6, hits)).toEqual([{ text: '6789ab', mark: 'current' }])

    // Sub-row 2: [12, 18) — tail of the spanning hit plus a later hit on this row
    expect(rowSegments('cdefgh', 12, hits)).toEqual([
      { text: 'cd', mark: 'current' },
      { text: 'ef', mark: 'none' },
      { text: 'gh', mark: 'hit' },
    ])
  })
})
