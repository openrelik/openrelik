/**
 * Finding text in a file's lines, and marking what was found in a row.
 */

export interface SearchOptions {
  caseSensitive: boolean
  /** The query is a regular expression rather than literal text. */
  regex: boolean
}

/** Where a line matches: `[start, end)` character offsets, in order. */
export type LineMatcher = (line: string, limit?: number) => [number, number][]

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * A matcher for `query`, or why the query is not a valid expression. Literal
 * text goes through a regular expression too, so ignoring case never shifts
 * an offset (lower-casing can change a string's length). Empty matches are
 * skipped: `a*` finds the runs of `a`, not every gap between characters.
 */
export function lineMatcher(
  query: string,
  options: SearchOptions,
): { matcher: LineMatcher } | { error: string } {
  let pattern: RegExp
  try {
    pattern = new RegExp(
      options.regex ? query : escapeRegExp(query),
      options.caseSensitive ? 'g' : 'gi',
    )
  } catch (err: unknown) {
    return { error: err instanceof Error ? err.message : 'Not a valid expression' }
  }
  return {
    matcher: (line, limit) => {
      const out: [number, number][] = []
      pattern.lastIndex = 0
      for (let match = pattern.exec(line); match; match = pattern.exec(line)) {
        if (limit !== undefined && out.length >= limit) break
        if (match[0].length === 0) {
          pattern.lastIndex++
          continue
        }
        out.push([match.index, match.index + match[0].length])
      }
      return out
    },
  }
}

/** A piece of a row: plain, a search hit, or the hit search is on. */
export interface RowSegment {
  text: string
  mark: 'none' | 'hit' | 'current'
}

/**
 * A row's text cut where hits begin and end. `start` is where the row starts
 * in its line; hits are the line's, in line offsets, so a hit running across
 * two rows is marked on both.
 */
export function rowSegments(
  text: string,
  start: number,
  hits: { start: number; end: number; current: boolean }[],
): RowSegment[] {
  const out: RowSegment[] = []
  let at = 0
  for (const hit of hits) {
    const from = Math.max(at, hit.start - start)
    const to = Math.min(text.length, hit.end - start)
    if (to <= from || from >= text.length) continue
    if (from > at) out.push({ text: text.slice(at, from), mark: 'none' })
    out.push({ text: text.slice(from, to), mark: hit.current ? 'current' : 'hit' })
    at = to
  }
  if (at < text.length || !out.length) out.push({ text: text.slice(at), mark: 'none' })
  return out
}
