/**
 * Text Search Composable
 *
 * Find in a text file's lines, as a browser's find does in a page: every hit
 * in the lines read so far, one of them current, stepped through with
 * next / previous (wrapping).
 *
 * - The query is followed after a short pause, not per keystroke.
 * - Lines are searched a slice at a time, yielding between slices, so a large
 *   file never freezes the page; a new query cancels the search in flight.
 * - Lines arriving later are searched as they come.
 * - At most `MAX_HITS` hits are kept: enough to step through, and a count
 *   that says "more than this" past it.
 * - A new query starts at the first hit at or below the line on screen.
 */

import { computed, onScopeDispose, ref, shallowRef, watch, type ComputedRef, type Ref } from 'vue'

import type { UseTextStreamReturn } from '@/composables/useTextStream'
import { lineMatcher, type LineMatcher, type SearchOptions } from '@/utils/textSearch'

export const MAX_HITS = 10_000
const SLICE_LINES = 20_000
const DEBOUNCE_MS = 150

/** A hit: line (0-based) and `[start, end)` in it. */
export interface TextHit {
  line: number
  start: number
  end: number
}

export interface UseTextSearchReturn {
  hits: Readonly<Ref<TextHit[]>>
  /** The current hit's place in `hits`; -1 for none. */
  current: Readonly<Ref<number>>
  /** More hits than `MAX_HITS`: the rest were not kept. */
  overflow: Readonly<Ref<boolean>>
  /** Lines are still being searched. */
  searching: Readonly<Ref<boolean>>
  /** Why the query is not a valid expression. */
  error: Readonly<Ref<string | null>>
  /** The query being searched for is not empty. */
  active: ComputedRef<boolean>
  /** Where `hits` has the hits of a line: `[first, end)`. */
  hitsOn: (line: number) => [number, number]
  next: () => void
  prev: () => void
}

export function useTextSearch(
  text: UseTextStreamReturn,
  query: () => string,
  options: () => SearchOptions,
  /** The first line on screen (0-based), where a new search starts. */
  topLine: () => number,
): UseTextSearchReturn {
  const hits = shallowRef<TextHit[]>([])
  const current = ref(-1)
  const overflow = ref(false)
  const searching = ref(false)
  const error = ref<string | null>(null)
  const searched = ref('')

  let matcher: LineMatcher | null = null
  /** Lines searched, all complete: the next search starts here. */
  let scanned = 0
  /** No hit picked yet for this query: the first one at or below `from` will be. */
  let picking = false
  let from = 0
  let run = 0
  let debounce: ReturnType<typeof setTimeout> | undefined

  function restart() {
    run++
    hits.value = []
    current.value = -1
    overflow.value = false
    error.value = null
    scanned = 0
    matcher = null
    searching.value = false
    searched.value = query()
    if (!searched.value) return
    const made = lineMatcher(searched.value, options())
    if ('error' in made) {
      error.value = made.error
      return
    }
    matcher = made.matcher
    picking = true
    from = topLine()
    void scan()
  }

  /** Searches the lines not searched yet, a slice at a time. */
  async function scan() {
    if (!matcher || searching.value) return
    const mine = run
    searching.value = true
    try {
      for (;;) {
        const index = text.index()
        // The last line may still be growing: it is searched again once it has ended.
        const end = index.lines.length - (index.open ? 1 : 0)
        if (scanned >= end || overflow.value) break
        const stop = Math.min(end, scanned + SLICE_LINES)
        const found = hits.value
        for (let line = scanned; line < stop; line++) {
          for (const [start, until] of matcher(index.lines[line]!)) {
            if (found.length >= MAX_HITS) {
              overflow.value = true
              break
            }
            found.push({ line, start, end: until })
          }
          if (overflow.value) break
        }
        scanned = stop
        hits.value = [...found]
        pick()
        await new Promise((resolve) => setTimeout(resolve, 0))
        if (mine !== run) return
      }
      if (picking && hits.value.length) {
        // Nothing below the line on screen: wrap to the first.
        current.value = 0
        picking = false
      }
    } finally {
      if (mine === run) searching.value = false
    }
  }

  function pick() {
    if (!picking) return
    const at = hits.value.findIndex((hit) => hit.line >= from)
    if (at < 0) return
    current.value = at
    picking = false
  }

  watch([query, () => JSON.stringify(options())], () => {
    clearTimeout(debounce)
    debounce = setTimeout(restart, DEBOUNCE_MS)
  })
  // Another file: start over at once.
  watch(text.index, restart)
  // More lines: search them too.
  watch(text.version, () => void scan())
  onScopeDispose(() => {
    clearTimeout(debounce)
    run++
  })

  /** The first hit on or after `line`. */
  function lowerBound(line: number): number {
    const list = hits.value
    let lo = 0
    let hi = list.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (list[mid]!.line < line) lo = mid + 1
      else hi = mid
    }
    return lo
  }

  function step(by: 1 | -1) {
    const count = hits.value.length
    if (!count) return
    if (current.value < 0) {
      // From the line on screen, as a new search does.
      const at = lowerBound(topLine())
      current.value = by === 1 ? at % count : (at - 1 + count) % count
    } else {
      current.value = (current.value + by + count) % count
    }
    picking = false
  }

  return {
    hits,
    current,
    overflow,
    searching,
    error,
    active: computed(() => !!searched.value && !error.value),
    hitsOn: (line) => [lowerBound(line), lowerBound(line + 1)],
    next: () => step(1),
    prev: () => step(-1),
  }
}
