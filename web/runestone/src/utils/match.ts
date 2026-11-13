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

export interface PathMatch {
  score: number
  /** Positions in the text that matched, for highlighting. */
  hits: number[]
}

const BOUNDARY = '/_-. '

/**
 * The query as one unbroken run, anywhere in the path, ignoring case — the
 * whole string or nothing. Scattered letters are not a match: `repo` must not
 * find `wo·r·kflow/…_jupyter.jso·n` just because the letters appear in order.
 *
 * Ranking: a run inside the last segment beats one in the folders above it
 * (`ntu` → `…/NTUSER.DAT` before `…/ntu/…`), a run starting at a word boundary
 * beats one mid-word, and shorter paths win ties.
 */
export function matchPath(query: string, text: string): PathMatch | null {
  const q = query.toLowerCase()
  const t = text.toLowerCase()
  if (!q) return { score: 0, hits: [] }

  const trimmed = t.replace(/\/$/, '')
  const base = trimmed.lastIndexOf('/') + 1
  const baseAt = trimmed.indexOf(q, base)
  const at = baseAt >= 0 ? baseAt : t.indexOf(q)
  if (at < 0) return null

  const inBase = at >= base ? 200 : 100
  const boundary = at === 0 || BOUNDARY.includes(t[at - 1]!) ? 10 : 0
  return {
    score: inBase + boundary - text.length * 0.05,
    hits: Array.from({ length: q.length }, (_, i) => at + i),
  }
}

/** Split a text into runs of matched and unmatched characters. */
export function highlight(text: string, hits: number[]): { text: string; hit: boolean }[] {
  const set = new Set(hits)
  const runs: { text: string; hit: boolean }[] = []
  for (let i = 0; i < text.length; i++) {
    const hit = set.has(i)
    const last = runs.at(-1)
    if (last && last.hit === hit) last.text += text[i]
    else runs.push({ text: text[i]!, hit })
  }
  return runs
}
