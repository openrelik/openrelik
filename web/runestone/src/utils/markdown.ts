/**
 * Markdown — files and the reports workers write — parsed into blocks a
 * component renders.
 *
 * Safe by construction, not by filtering:
 * - Nothing is ever turned into HTML. The output is a typed tree whose text
 *   reaches the page only as text (Vue's `{{ }}`), so raw HTML in the source
 *   (`<script>`, `<img onerror>`, `<style>`) stays literal text.
 * - Nothing from the source becomes an attribute. Links and images keep
 *   their URL as text, to be shown, never followed or fetched: a file cannot
 *   make the page reach out, nor learn that it was opened.
 * - Characters that hide or reorder text (bidi overrides, zero-width
 *   characters) are written out (`‹U+202E›`), so text shows what it is.
 * - The work is bounded: long lines are not parsed inline, tables and lists
 *   are capped, and every pattern stops at its own delimiter.
 *
 * Covers headings (`#` and underlined), paragraphs, `*` / `-` / `+` and
 * numbered lists (nested by indent, task boxes), quotes, fenced and indented
 * code, rules and pipe tables (with alignment); inline, `code`, **bold**,
 * *emphasis*, links, images, autolinks, backslash escapes and hard breaks.
 * Anything else stays literal text.
 */

export type Inline =
  | { type: 'text'; text: string }
  | { type: 'code'; text: string }
  | { type: 'strong'; text: string }
  | { type: 'em'; text: string }
  | { type: 'link'; text: string; url: string }
  | { type: 'image'; alt: string; url: string }
  | { type: 'break' }

export type Align = 'left' | 'center' | 'right' | null

export interface ListItem {
  depth: number
  /** As written: `•` for a bullet (drawn by depth), or the number, `3.`. */
  marker: string | null
  /** A task box: checked, unchecked, or none. */
  task: boolean | null
  inlines: Inline[]
}

/** A block, and the lines (1-based, inclusive) it spans in the source. */
export type Block = { line: number; end: number } & BlockBody

export type BlockBody =
  | { type: 'heading'; level: number; inlines: Inline[] }
  | { type: 'paragraph'; inlines: Inline[] }
  | { type: 'list'; items: ListItem[] }
  | { type: 'quote'; inlines: Inline[] }
  | { type: 'code'; text: string; lang: string }
  | { type: 'rule' }
  | { type: 'table'; head: Inline[][]; align: Align[]; rows: Inline[][][] }

/** Lines longer than this are not parsed inline: they stay plain text. */
export const INLINE_MAX = 4000
/** Columns past this are dropped from a table. */
export const TABLE_COLUMNS_MAX = 100
/** List items deeper than this are drawn at this depth. */
export const LIST_DEPTH_MAX = 8

/** Characters that hide or reorder text: bidi controls, zero-width, the BOM. */
const HIDDEN = /[​-‏‪-‮⁦-⁩﻿]/g
const reveal = (text: string) =>
  text.replace(
    HIDDEN,
    (char) => `‹U+${char.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0')}›`,
  )

// A URL may hold one level of parentheses: `(x)` in `https://…/Foo_(bar)`.
const URL_PART = String.raw`((?:[^\s()]|\([^\s()]*\))+)(?:\s+"[^"]*")?`
/**
 * One inline span. Each alternative stops at its own delimiter or the next
 * opener (a label at the next `[`), so a line costs about its length, however
 * many openers it holds unclosed; lines are capped at `INLINE_MAX` as well.
 */
const INLINE = new RegExp(
  [
    String.raw`\\([!-/:-@[-\x60{-~])`, // an escaped punctuation character
    '``(.+?)``|`([^`]+)`', // code
    String.raw`!\[([^[\]]*)\]\(${URL_PART}\)`, // image
    String.raw`\[([^[\]]+)\]\(${URL_PART}\)`, // link
    '<([a-z][a-z0-9+.-]{1,31}:[^\\s<>]+)>', // autolink
    // strong, then emphasis; `_` only at word edges, so snake_case stays text
    String.raw`\*\*(.+?)\*\*|(?<![\p{L}\p{N}_])__([^_]+)__(?![\p{L}\p{N}_])`,
    String.raw`\*([^*\s][^*]*?)\*|(?<![\p{L}\p{N}_])_([^_\s][^_]*?)_(?![\p{L}\p{N}_])`,
  ].join('|'),
  'giu',
)

export function parseInline(text: string): Inline[] {
  if (text.length > INLINE_MAX) return [{ type: 'text', text }]
  const out: Inline[] = []
  const push = (value: string) => {
    if (!value) return
    const prev = out[out.length - 1]
    if (prev?.type === 'text') prev.text += value
    else out.push({ type: 'text', text: value })
  }
  let last = 0
  for (const match of text.matchAll(INLINE)) {
    push(text.slice(last, match.index))
    const [, escaped, code2, code, alt, imageUrl, label, linkUrl, auto, s1, s2, e1, e2] = match
    if (escaped !== undefined) push(escaped)
    else if ((code2 ?? code) !== undefined) out.push({ type: 'code', text: (code2 ?? code)! })
    else if (imageUrl !== undefined) out.push({ type: 'image', alt: alt ?? '', url: imageUrl })
    else if (linkUrl !== undefined) out.push({ type: 'link', text: label!, url: linkUrl })
    else if (auto !== undefined) out.push({ type: 'link', text: auto, url: auto })
    else if ((s1 ?? s2) !== undefined) out.push({ type: 'strong', text: (s1 ?? s2)! })
    else out.push({ type: 'em', text: (e1 ?? e2)! })
    last = match.index + match[0].length
  }
  push(text.slice(last))
  return out
}

/** A paragraph's lines, joined: a line ending in two spaces or `\` breaks. */
function paragraphInlines(lines: string[]): Inline[] {
  const out: Inline[] = []
  lines.forEach((line, i) => {
    const hard = / {2,}$|\\$/.test(line)
    out.push(...parseInline(line.trim().replace(/\\$/, '')))
    if (i < lines.length - 1) out.push(hard ? { type: 'break' } : { type: 'text', text: ' ' })
  })
  return out
}

const BULLET = /^( *)([*+-]|\d{1,9}[.)])(?:[ \t]+(.*))?$/
const FENCE = /^( {0,3})(`{3,}|~{3,})\s*([^`\s]*)/
const ATX = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/
const RULE = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/
const TABLE_RULE = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/

/** A table row's cells: split on unescaped pipes, the outer ones dropped. */
function splitRow(row: string): string[] {
  const cells = row.trim().split(/(?<!\\)\|/)
  if (cells[0]?.trim() === '') cells.shift()
  if (cells.length && cells[cells.length - 1]!.trim() === '') cells.pop()
  return cells.map((cell) => cell.trim().replace(/\\\|/g, '|'))
}

/** Whether lines `i` and `i + 1` start a table: a row, then a rule of dashes. */
const tableAt = (lines: string[], i: number) =>
  lines[i]!.includes('|') &&
  TABLE_RULE.test(lines[i + 1] ?? '') &&
  (lines[i + 1]!.includes('|') || lines[i]!.trim().startsWith('|'))

/** Whether a line starts a block that ends a paragraph. */
const interrupts = (lines: string[], i: number) => {
  const line = lines[i]!
  return (
    ATX.test(line) ||
    FENCE.test(line) ||
    RULE.test(line) ||
    /^ {0,3}>/.test(line) ||
    BULLET.test(line) ||
    tableAt(lines, i)
  )
}

const indentOf = (line: string) => line.length - line.trimStart().length

export function parseMarkdown(source: string): Block[] {
  const lines = reveal(source)
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/^\t+/, (tabs) => '    '.repeat(tabs.length)))
  const blocks: ({ line: number } & BlockBody)[] = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]!
    const start = i + 1
    if (!line.trim()) {
      i++
      continue
    }

    const fence = FENCE.exec(line)
    if (fence) {
      const [, indent, open, lang] = fence
      const close = new RegExp(`^ {0,3}${open![0] === '`' ? '`' : '~'}{${open!.length},}\\s*$`)
      const body: string[] = []
      for (i++; i < lines.length && !close.test(lines[i]!); i++) {
        body.push(lines[i]!.replace(new RegExp(`^ {0,${indent!.length}}`), ''))
      }
      blocks.push({ type: 'code', text: body.join('\n'), lang: lang ?? '', line: start })
      i++ // the closing fence; past the end when there is none
      continue
    }

    if (indentOf(line) >= 4) {
      const body: string[] = []
      for (; i < lines.length && (!lines[i]!.trim() || indentOf(lines[i]!) >= 4); i++) {
        body.push(lines[i]!.slice(4))
      }
      while (body.length && !body[body.length - 1]!.trim()) body.pop()
      blocks.push({ type: 'code', text: body.join('\n'), lang: '', line: start })
      continue
    }

    const heading = ATX.exec(line)
    if (heading) {
      const inlines = parseInline(heading[2] ?? '')
      blocks.push({ type: 'heading', level: heading[1]!.length, inlines, line: start })
      i++
      continue
    }

    if (RULE.test(line)) {
      blocks.push({ type: 'rule', line: start })
      i++
      continue
    }

    if (tableAt(lines, i)) {
      const head = splitRow(line).slice(0, TABLE_COLUMNS_MAX)
      const align = splitRow(lines[i + 1]!)
        .slice(0, head.length)
        .map((cell): Align => {
          const left = cell.startsWith(':')
          const right = cell.endsWith(':')
          return left && right ? 'center' : right ? 'right' : left ? 'left' : null
        })
      while (align.length < head.length) align.push(null)
      const rows: Inline[][][] = []
      for (i += 2; i < lines.length && lines[i]!.trim() && lines[i]!.includes('|'); i++) {
        const cells = splitRow(lines[i]!).slice(0, head.length)
        while (cells.length < head.length) cells.push('')
        rows.push(cells.map(parseInline))
      }
      blocks.push({ type: 'table', head: head.map(parseInline), align, rows, line: start })
      continue
    }

    if (BULLET.test(line)) {
      const items: ListItem[] = []
      const indents: number[] = []
      for (; i < lines.length; i++) {
        const item = BULLET.exec(lines[i]!)
        if (!item) {
          const next = lines[i]!
          // A blank line between items keeps the list going.
          if (!next.trim()) {
            const after = lines.slice(i + 1).find((l) => l.trim())
            if (after && BULLET.test(after)) continue
            break
          }
          // An indented line goes on with the item above.
          if (indentOf(next) >= 2 && items.length) {
            items[items.length - 1]!.inlines.push({ type: 'text', text: ' ' })
            items[items.length - 1]!.inlines.push(...parseInline(next.trim()))
            continue
          }
          break
        }
        const indent = item[1]!.length
        while (indents.length && indent < indents[indents.length - 1]!) indents.pop()
        if (!indents.length || indent > indents[indents.length - 1]!) indents.push(indent)
        let text = item[3] ?? ''
        let task: boolean | null = null
        const box = /^\[([ xX])\]\s+/.exec(text)
        if (box) {
          task = box[1] !== ' '
          text = text.slice(box[0].length)
        }
        const marker = /\d/.test(item[2]!) ? item[2]!.replace(')', '.') : null
        const depth = Math.min(indents.length - 1, LIST_DEPTH_MAX)
        items.push({ depth, marker, task, inlines: parseInline(text) })
      }
      blocks.push({ type: 'list', items, line: start })
      continue
    }

    if (/^ {0,3}>/.test(line)) {
      const body: string[] = []
      for (; i < lines.length && /^ {0,3}>/.test(lines[i]!); i++) {
        body.push(lines[i]!.trim().replace(/^>\s?/, ''))
      }
      blocks.push({ type: 'quote', inlines: paragraphInlines(body), line: start })
      continue
    }

    // A paragraph runs until a blank line or the start of another block; a
    // line of `=` or `-` under it makes it a heading.
    const body: string[] = [line]
    let level = 0
    for (i++; i < lines.length; i++) {
      const next = lines[i]!
      if (/^ {0,3}=+\s*$/.test(next) || /^ {0,3}-+\s*$/.test(next)) {
        level = next.trim()[0] === '=' ? 1 : 2
        i++
        break
      }
      if (!next.trim() || interrupts(lines, i)) break
      body.push(next)
    }
    blocks.push(
      level
        ? { type: 'heading', level, inlines: paragraphInlines(body), line: start }
        : { type: 'paragraph', inlines: paragraphInlines(body), line: start },
    )
  }
  // A block ends where the next begins, less the blank lines between them.
  return blocks.map((block, k) => {
    let end = (blocks[k + 1]?.line ?? lines.length + 1) - 1
    while (end > block.line && !lines[end - 1]!.trim()) end--
    return { ...block, end }
  })
}
