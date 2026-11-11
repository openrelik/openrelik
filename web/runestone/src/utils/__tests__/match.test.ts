import { describe, expect, it } from 'vitest'

import { highlight, matchPath } from '@/utils/match'

describe('matchPath', () => {
  it('returns zero score and empty hits for an empty query', () => {
    expect(matchPath('', 'cases/ntuser.dat')).toEqual({ score: 0, hits: [] })
  })

  it('returns null when query does not appear as a contiguous substring', () => {
    expect(matchPath('repo', 'workflow/12_jupyter.json')).toBeNull()
    expect(matchPath('xyz', 'cases/evidence.raw')).toBeNull()
  })

  it('ranks basename matches above directory matches and word boundaries above mid-word', () => {
    const inBasename = matchPath('ntu', 'cases/host/NTUSER.DAT')
    const inFolder = matchPath('ntu', 'cases/ntu/other.dat')
    expect(inBasename).not.toBeNull()
    expect(inFolder).not.toBeNull()
    expect(inBasename!.score).toBeGreaterThan(inFolder!.score)
    expect(inBasename!.hits).toEqual([11, 12, 13])

    const atBoundary = matchPath('log', 'var/auth_log.txt')
    const midWord = matchPath('log', 'var/prologue.txt')
    expect(atBoundary!.score).toBeGreaterThan(midWord!.score)
  })

  it('treats the last segment of a trailing-slash folder path as its basename', () => {
    const folderMatch = matchPath('hosts', 'ir-2026/hosts/')
    expect(folderMatch).not.toBeNull()
    expect(folderMatch!.hits).toEqual([8, 9, 10, 11, 12])
  })

  it('prefers shorter paths on otherwise equal matches', () => {
    const shorter = matchPath('sam', 'sam.hive')
    const longer = matchPath('sam', 'sam_extended_backup.hive')
    expect(shorter!.score).toBeGreaterThan(longer!.score)
  })
})

describe('highlight', () => {
  it('handles empty text and empty hit lists', () => {
    expect(highlight('', [0, 1])).toEqual([])
    expect(highlight('syslog', [])).toEqual([{ text: 'syslog', hit: false }])
  })

  it('coalesces contiguous hit and non-hit characters into runs', () => {
    expect(highlight('cases/NTUSER.DAT', [6, 7, 8])).toEqual([
      { text: 'cases/', hit: false },
      { text: 'NTU', hit: true },
      { text: 'SER.DAT', hit: false },
    ])
  })
})
