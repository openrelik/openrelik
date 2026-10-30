/**
 * The markdown workers write in their reports, parsed into blocks a component
 * renders: nothing is ever turned into HTML, so a report cannot inject any.
 *
 * Covers what `openrelik_worker_common.reporting` produces — headings, `*` / `-`
 * bullets nested by four spaces, numbered items, paragraphs, quotes, fenced
 * code, rules and pipe tables — and, inline, `code`, **bold**, *emphasis* and
 * http(s) links. Anything else stays literal text.
 */

export type Inline =
  | { type: 'text'; text: string }
  | { type: 'code'; text: string }
  | { type: 'strong'; text: string }
  | { type: 'em'; text: string }
  | { type: 'link'; text: string; href: string }

export type Block =
  | { type: 'heading'; level: number; inlines: Inline[] }
  | { type: 'paragraph'; inlines: Inline[] }
  | { type: 'list'; ordered: boolean; items: { depth: number; inlines: Inline[] }[] }
  | { type: 'quote'; inlines: Inline[] }
  | { type: 'code'; text: string }
  | { type: 'rule' }
  | { type: 'table'; head: Inline[][]; rows: Inline[][][] }

const INLINE =
  /`([^`]+)`|\*\*(.+?)\*\*|__(.+?)__|\*([^*\s][^*]*?)\*|_([^_\s][^_]*?)_|\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g

export function parseInline(text: string): Inline[] {
  const out: Inline[] = []
  let last = 0
  for (const match of text.matchAll(INLINE)) {
    if (match.index > last) out.push({ type: 'text', text: text.slice(last, match.index) })
    const [, code, strong, strong2, em, em2, label, href] = match
    if (code !== undefined) out.push({ type: 'code', text: code })
    else if (strong ?? strong2) out.push({ type: 'strong', text: (strong ?? strong2)! })
    else if (em ?? em2) out.push({ type: 'em', text: (em ?? em2)! })
    else out.push({ type: 'link', text: label!, href: href! })
    last = match.index + match[0].length
  }
  if (last < text.length) out.push({ type: 'text', text: text.slice(last) })
  return out
}

const BULLET = /^(\s*)([*+-]|\d+[.)])\s+(.*)$/
const cells = (row: string) =>
  row
    .trim()
    .replace(/^\||\|$/g, '')
    .split('|')
    .map((cell) => parseInline(cell.trim()))

export function parseMarkdown(source: string): Block[] {
  const lines = source.replace(/\r\n?/g, '\n').split('\n')
  const blocks: Block[] = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]!
    const trimmed = line.trim()
    if (!trimmed) {
      i++
      continue
    }
    if (trimmed.startsWith('```')) {
      const body: string[] = []
      for (i++; i < lines.length && !lines[i]!.trim().startsWith('```'); i++) body.push(lines[i]!)
      blocks.push({ type: 'code', text: body.join('\n') })
      i++
      continue
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(trimmed)
    if (heading) {
      blocks.push({ type: 'heading', level: heading[1]!.length, inlines: parseInline(heading[2]!) })
      i++
      continue
    }
    if (/^([-*_])(\s*\1){2,}$/.test(trimmed)) {
      blocks.push({ type: 'rule' })
      i++
      continue
    }
    // A table: a row of cells, then a separator row of dashes.
    if (trimmed.startsWith('|') && /^\|?\s*:?-{3,}/.test(lines[i + 1]?.trim() ?? '')) {
      const head = cells(trimmed)
      const rows: Inline[][][] = []
      for (i += 2; i < lines.length && lines[i]!.trim().startsWith('|'); i++) {
        rows.push(cells(lines[i]!))
      }
      blocks.push({ type: 'table', head, rows })
      continue
    }
    if (BULLET.test(line)) {
      const ordered = /^\s*\d/.test(line)
      const items: { depth: number; inlines: Inline[] }[] = []
      for (; i < lines.length; i++) {
        const item = BULLET.exec(lines[i]!)
        if (!item) break
        items.push({ depth: Math.floor(item[1]!.length / 4), inlines: parseInline(item[3]!) })
      }
      blocks.push({ type: 'list', ordered, items })
      continue
    }
    if (trimmed.startsWith('>')) {
      const body: string[] = []
      for (; i < lines.length && lines[i]!.trim().startsWith('>'); i++) {
        body.push(lines[i]!.trim().replace(/^>\s?/, ''))
      }
      blocks.push({ type: 'quote', inlines: parseInline(body.join(' ')) })
      continue
    }
    // A paragraph runs until a blank line or the start of another block.
    const body: string[] = []
    for (; i < lines.length; i++) {
      const next = lines[i]!.trim()
      if (!next || /^(#{1,6}\s|```|>|\|)/.test(next) || BULLET.test(lines[i]!)) break
      body.push(next)
    }
    blocks.push({ type: 'paragraph', inlines: parseInline(body.join(' ')) })
  }
  return blocks
}
