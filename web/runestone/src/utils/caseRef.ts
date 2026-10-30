/**
 * Case references, normalized the way the server does it
 * (`datastores/sql/crud/folder.py`, `normalize_case_ref`), so the UI can show
 * what a reference will be saved as and refuse one the server would refuse.
 */

const MAX_LENGTH = 255
const PATTERN = /^[a-z0-9._/-]+$/
const ALNUM = /[a-z0-9]/

export type CaseRefCheck = { ok: true; value: string } | { ok: false; reason: string }

/** "CASE 123", "case-123" and " case-123 " are all `case-123`. */
export function normalizeCaseRef(input: string): CaseRefCheck {
  const value = input.trim().toLowerCase().replace(/\s+/g, '-')
  if (!value) return { ok: false, reason: 'enter a case reference' }
  if (value.length > MAX_LENGTH) return { ok: false, reason: `at most ${MAX_LENGTH} characters` }
  if (!PATTERN.test(value)) return { ok: false, reason: 'only a–z, 0–9 and - _ . / are allowed' }
  if (!ALNUM.test(value[0]!) || !ALNUM.test(value.at(-1)!)) {
    return { ok: false, reason: 'must start and end with a letter or digit' }
  }
  if (value.split('/').some((part) => part === '' || part === '.' || part === '..')) {
    return { ok: false, reason: "no '//', and no '.' or '..' between slashes" }
  }
  return { ok: true, value }
}

/**
 * The folder a 409 names, from its detail: `Case x already exists: folder 12
 * "ACME", owned by jdoe.` Null when the user may not see it (no folder named).
 */
export function takenByFolderId(detail: string | undefined): number | null {
  const match = detail?.match(/already exists: folder (\d+) /)
  return match ? Number(match[1]) : null
}
