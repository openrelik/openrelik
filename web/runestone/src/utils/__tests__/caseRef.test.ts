import { describe, expect, it } from 'vitest'

import { normalizeCaseRef, takenByFolderId } from '@/utils/caseRef'

describe('normalizeCaseRef', () => {
  it.each([
    ['CASE 123', 'case-123'],
    ['  case-123  ', 'case-123'],
    ['IR   2026 / 007', 'ir-2026-/-007'],
    ['ir-2026/host_01/v1.2', 'ir-2026/host_01/v1.2'],
    ['a/.hidden/b', 'a/.hidden/b'],
    ['9', '9'],
    ['a'.repeat(255), 'a'.repeat(255)],
  ])('normalizes valid input %j to %j', (input, expected) => {
    expect(normalizeCaseRef(input)).toEqual({ ok: true, value: expected })
  })

  it('rejects empty or whitespace-only input', () => {
    expect(normalizeCaseRef('')).toEqual({ ok: false, reason: 'enter a case reference' })
    expect(normalizeCaseRef('   \t\n  ')).toEqual({ ok: false, reason: 'enter a case reference' })
  })

  it('rejects references longer than 255 characters', () => {
    expect(normalizeCaseRef('a'.repeat(256))).toEqual({
      ok: false,
      reason: 'at most 255 characters',
    })
  })

  it.each(['case#1', 'case@acme', 'case:123', 'case?x', 'café'])(
    'rejects disallowed characters in %j',
    (input) => {
      expect(normalizeCaseRef(input)).toEqual({
        ok: false,
        reason: 'only a–z, 0–9 and - _ . / are allowed',
      })
    },
  )

  it.each(['-case', 'case-', '/case', 'case/', '.case', 'case.', '_case', 'case_'])(
    'rejects references not starting and ending with alphanumeric: %j',
    (input) => {
      expect(normalizeCaseRef(input)).toEqual({
        ok: false,
        reason: 'must start and end with a letter or digit',
      })
    },
  )

  it.each(['ir//007', 'ir/./007', 'ir/../007'])(
    'rejects empty or dot path segments between slashes in %j',
    (input) => {
      expect(normalizeCaseRef(input)).toEqual({
        ok: false,
        reason: "no '//', and no '.' or '..' between slashes",
      })
    },
  )
})

describe('takenByFolderId', () => {
  it('extracts the folder id from a 409 detail message when visible to the user', () => {
    expect(takenByFolderId('Case ir-2026 already exists: folder 42 "ACME", owned by jdoe.')).toBe(
      42,
    )
  })

  it('returns null when no folder is named or detail is absent', () => {
    expect(takenByFolderId('Case ir-2026 already exists.')).toBeNull()
    expect(takenByFolderId('')).toBeNull()
    expect(takenByFolderId(undefined)).toBeNull()
  })
})
