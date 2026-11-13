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

import { describe, expect, it } from 'vitest'

import {
  INLINE_MAX,
  LIST_DEPTH_MAX,
  TABLE_COLUMNS_MAX,
  parseInline,
  parseMarkdown,
  type Block,
  type Inline,
} from '@/utils/markdown'

const ALLOWED_BLOCK_TYPES = new Set([
  'heading',
  'paragraph',
  'list',
  'quote',
  'code',
  'rule',
  'table',
])

const ALLOWED_INLINE_TYPES = new Set(['text', 'code', 'strong', 'em', 'link', 'image', 'break'])

const RAW_HIDDEN_CHARS = /[\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/

interface WalkedAst {
  inlines: Inline[]
  strings: string[]
}

function walkInlines(inlines: readonly Inline[], out: WalkedAst): void {
  for (const inline of inlines) {
    expect(ALLOWED_INLINE_TYPES.has(inline.type)).toBe(true)
    switch (inline.type) {
      case 'text':
      case 'code':
      case 'strong':
      case 'em':
        out.strings.push(inline.text)
        break
      case 'link':
        out.strings.push(inline.text, inline.url)
        break
      case 'image':
        out.strings.push(inline.alt, inline.url)
        break
      case 'break':
        break
    }
    out.inlines.push(inline)
  }
}

function walkBlocks(blocks: readonly Block[]): WalkedAst {
  const out: WalkedAst = { inlines: [], strings: [] }
  for (const block of blocks) {
    expect(ALLOWED_BLOCK_TYPES.has(block.type)).toBe(true)
    switch (block.type) {
      case 'heading':
      case 'paragraph':
      case 'quote':
        walkInlines(block.inlines, out)
        break
      case 'list':
        for (const item of block.items) {
          walkInlines(item.inlines, out)
        }
        break
      case 'code':
        out.strings.push(block.text, block.lang)
        break
      case 'table':
        for (const cell of block.head) walkInlines(cell, out)
        for (const row of block.rows) {
          for (const cell of row) walkInlines(cell, out)
        }
        break
      case 'rule':
        break
    }
  }
  return out
}

describe('forensic safety', () => {
  it.each([
    '<script>alert(1)</script>',
    '<img src=x onerror=alert(1)>',
    '<a href="https://evil.com" onclick="pwn()">click here</a>',
    '<svg onload=alert(1)><style>body{display:none}</style></svg>',
    'prefix <iframe src="javascript:alert(1)"></iframe> suffix',
  ])('keeps raw HTML %s as literal text nodes without creating links or images', (payload) => {
    const blocks = parseMarkdown(payload)
    const walked = walkBlocks(blocks)

    expect(walked.inlines.every((node) => node.type === 'text')).toBe(true)
    expect(walked.inlines.map((node) => (node.type === 'text' ? node.text : '')).join('')).toBe(
      payload,
    )
  })

  it('keeps javascript: and data: Markdown links and images as inert AST records', () => {
    const source = [
      '[run](javascript:alert(1))',
      '<javascript:alert(2)>',
      '![payload](data:image/svg+xml,<svg/onload=alert(1)>)',
      '[<img src=x onerror=alert(1)>](data:text/html,hi)',
    ].join('\n\n')

    const walked = walkBlocks(parseMarkdown(source))
    expect(walked.inlines).toEqual([
      { type: 'link', text: 'run', url: 'javascript:alert(1)' },
      { type: 'link', text: 'javascript:alert(2)', url: 'javascript:alert(2)' },
      { type: 'image', alt: 'payload', url: 'data:image/svg+xml,<svg/onload=alert(1)>' },
      { type: 'link', text: '<img src=x onerror=alert(1)>', url: 'data:text/html,hi' },
    ])
  })

  it('reveals hidden bidi overrides, zero-width characters, and BOM across all blocks', () => {
    const source = [
      '\uFEFF# Heading\u200B',
      '',
      'invoice_\u202Egpj.exe and [\u2066label\u2069](https://example.com/\u200Fpath)',
      '',
      '```',
      'code\u202Eline',
      '```',
      '',
      '| col\u200B |',
      '| --- |',
      '| val\u202E |',
    ].join('\n')

    const walked = walkBlocks(parseMarkdown(source))
    for (const value of walked.strings) {
      expect(value).not.toMatch(RAW_HIDDEN_CHARS)
    }

    const joined = walked.strings.join(' ')
    expect(joined).toContain('‹U+FEFF›')
    expect(joined).toContain('‹U+200B›')
    expect(joined).toContain('‹U+202E›')
    expect(joined).toContain('‹U+2066›')
    expect(joined).toContain('‹U+2069›')
    expect(joined).toContain('‹U+200F›')
  })

  it('reveals Arabic Letter Mark, soft hyphen, word joiner, and C0/C1 control chars in both parseMarkdown and parseInline', () => {
    const hostile = 'a\u061Cb\u00ADc\u2060d\x00e\x1b[31mf\x7fg\x9bh'
    const blocks = parseMarkdown(hostile)
    const blockText = walkBlocks(blocks).strings.join('')
    const inlineText = parseInline(hostile)
      .map((n) => (n.type === 'text' ? n.text : ''))
      .join('')

    for (const rendered of [blockText, inlineText]) {
      expect(rendered).toContain('‹U+061C›')
      expect(rendered).toContain('‹U+00AD›')
      expect(rendered).toContain('‹U+2060›')
      expect(rendered).toContain('‹U+0000›')
      expect(rendered).toContain('‹U+001B›')
      expect(rendered).toContain('‹U+007F›')
      expect(rendered).toContain('‹U+009B›')
      expect(rendered).not.toMatch(
        /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u00AD\u061C\u2060]/,
      )
    }
  })
})

describe('block parsing', () => {
  it('parses ATX headings levels 1..6, strips closing hashes, and leaves 7 hashes as paragraph', () => {
    const blocks = parseMarkdown('# One\n### Three ###\n###### Six\n####### Not a heading')
    expect(blocks).toEqual([
      { type: 'heading', level: 1, inlines: [{ type: 'text', text: 'One' }], line: 1, end: 1 },
      { type: 'heading', level: 3, inlines: [{ type: 'text', text: 'Three' }], line: 2, end: 2 },
      { type: 'heading', level: 6, inlines: [{ type: 'text', text: 'Six' }], line: 3, end: 3 },
      {
        type: 'paragraph',
        inlines: [{ type: 'text', text: '####### Not a heading' }],
        line: 4,
        end: 4,
      },
    ])
  })

  it('parses setext headings (= and -) and standalone horizontal rules', () => {
    const source = [
      'Title One',
      '=========',
      '',
      'Title Two',
      '---------',
      '',
      '---',
      '',
      '***',
    ].join('\n')
    expect(parseMarkdown(source)).toEqual([
      {
        type: 'heading',
        level: 1,
        inlines: [{ type: 'text', text: 'Title One' }],
        line: 1,
        end: 2,
      },
      {
        type: 'heading',
        level: 2,
        inlines: [{ type: 'text', text: 'Title Two' }],
        line: 4,
        end: 5,
      },
      { type: 'rule', line: 7, end: 7 },
      { type: 'rule', line: 9, end: 9 },
    ])
  })

  it('joins soft-wrapped paragraph lines with spaces and emits hard breaks for two spaces or backslash', () => {
    const source = 'first line\nsecond line  \nthird line\\\nfourth line'
    expect(parseMarkdown(source)).toEqual([
      {
        type: 'paragraph',
        line: 1,
        end: 4,
        inlines: [
          { type: 'text', text: 'first line' },
          { type: 'text', text: ' ' },
          { type: 'text', text: 'second line' },
          { type: 'break' },
          { type: 'text', text: 'third line' },
          { type: 'break' },
          { type: 'text', text: 'fourth line' },
        ],
      },
    ])
  })

  it('parses backtick and tilde fenced code blocks as well as indented code blocks', () => {
    const source = [
      '  ```ts',
      '  const x = "**raw**"',
      '  ```',
      '',
      '~~~sh',
      'echo hi',
      '~~~',
      '',
      '    indented 1',
      '\tindented 2',
    ].join('\n')

    expect(parseMarkdown(source)).toEqual([
      { type: 'code', lang: 'ts', text: 'const x = "**raw**"', line: 1, end: 3 },
      { type: 'code', lang: 'sh', text: 'echo hi', line: 5, end: 7 },
      { type: 'code', lang: '', text: 'indented 1\nindented 2', line: 9, end: 10 },
    ])
  })

  it('parses nested, ordered, and task lists with continuation lines', () => {
    const source = [
      '- [ ] root unchecked',
      '  - [x] nested checked',
      '  - [X] nested uppercase checked',
      '    continued line',
      '1. first ordered',
      '2) second paren ordered',
    ].join('\n')

    const blocks = parseMarkdown(source)
    expect(blocks).toEqual([
      {
        type: 'list',
        line: 1,
        end: 6,
        items: [
          {
            depth: 0,
            marker: null,
            task: false,
            inlines: [{ type: 'text', text: 'root unchecked' }],
          },
          {
            depth: 1,
            marker: null,
            task: true,
            inlines: [{ type: 'text', text: 'nested checked' }],
          },
          {
            depth: 1,
            marker: null,
            task: true,
            inlines: [
              { type: 'text', text: 'nested uppercase checked' },
              { type: 'text', text: ' ' },
              { type: 'text', text: 'continued line' },
            ],
          },
          {
            depth: 0,
            marker: '1.',
            task: null,
            inlines: [{ type: 'text', text: 'first ordered' }],
          },
          {
            depth: 0,
            marker: '2.',
            task: null,
            inlines: [{ type: 'text', text: 'second paren ordered' }],
          },
        ],
      },
    ])
  })

  it('parses multi-line blockquotes and backslash hard breaks', () => {
    const blocks = parseMarkdown('> alpha **bold**\n> beta\\\n> gamma')
    expect(blocks).toEqual([
      {
        type: 'quote',
        line: 1,
        end: 3,
        inlines: [
          { type: 'text', text: 'alpha ' },
          { type: 'strong', text: 'bold' },
          { type: 'text', text: ' ' },
          { type: 'text', text: 'beta' },
          { type: 'break' },
          { type: 'text', text: 'gamma' },
        ],
      },
    ])
  })

  it('preserves two-space hard breaks inside blockquotes', () => {
    const blocks = parseMarkdown('> alpha **bold**  \n> beta')
    expect(blocks).toEqual([
      {
        type: 'quote',
        line: 1,
        end: 2,
        inlines: [
          { type: 'text', text: 'alpha ' },
          { type: 'strong', text: 'bold' },
          { type: 'break' },
          { type: 'text', text: 'beta' },
        ],
      },
    ])
  })

  it('parses pipe tables with alignment, escaped pipes, and ragged rows', () => {
    const source = [
      '| Left | Center | Right | None |',
      '| :--- | :---: | ---: | --- |',
      '| a \\| b | `c \\| d` | 10 |',
    ].join('\n')

    expect(parseMarkdown(source)).toEqual([
      {
        type: 'table',
        line: 1,
        end: 3,
        align: ['left', 'center', 'right', null],
        head: [
          [{ type: 'text', text: 'Left' }],
          [{ type: 'text', text: 'Center' }],
          [{ type: 'text', text: 'Right' }],
          [{ type: 'text', text: 'None' }],
        ],
        rows: [
          [
            [{ type: 'text', text: 'a | b' }],
            [{ type: 'code', text: 'c | d' }],
            [{ type: 'text', text: '10' }],
            [],
          ],
        ],
      },
    ])
  })
})

describe('inline parsing', () => {
  it('parses strong and emphasis while leaving snake_case untouched', () => {
    expect(parseInline('**bold** __also__ *em* _edge_ and my_var_name_2')).toEqual([
      { type: 'strong', text: 'bold' },
      { type: 'text', text: ' ' },
      { type: 'strong', text: 'also' },
      { type: 'text', text: ' ' },
      { type: 'em', text: 'em' },
      { type: 'text', text: ' ' },
      { type: 'em', text: 'edge' },
      { type: 'text', text: ' and my_var_name_2' },
    ])
  })

  it('keeps inner Markdown syntax literal inside single and double backtick code spans', () => {
    expect(parseInline('`**not bold** [x](y)` and ``use `backtick` here``')).toEqual([
      { type: 'code', text: '**not bold** [x](y)' },
      { type: 'text', text: ' and ' },
      { type: 'code', text: 'use `backtick` here' },
    ])
  })

  it('parses links (including balanced parentheses and optional titles), images, and autolinks', () => {
    const text =
      '[Wiki](https://en.wikipedia.org/wiki/Disk_(storage) "title") ![shot](https://example.com/a.png) <https://openrelik.org>'
    expect(parseInline(text)).toEqual([
      { type: 'link', text: 'Wiki', url: 'https://en.wikipedia.org/wiki/Disk_(storage)' },
      { type: 'text', text: ' ' },
      { type: 'image', alt: 'shot', url: 'https://example.com/a.png' },
      { type: 'text', text: ' ' },
      { type: 'link', text: 'https://openrelik.org', url: 'https://openrelik.org' },
    ])
  })

  it('honors backslash escapes on punctuation delimiters', () => {
    expect(parseInline('\\*literal\\* \\[no link\\](https://example.com) \\\\')).toEqual([
      { type: 'text', text: '*literal* [no link](https://example.com) \\' },
    ])
  })
})

describe('bounds and pathological inputs', () => {
  it('skips inline parsing when a line exceeds INLINE_MAX', () => {
    const withinLimit = `**bold** ${'a'.repeat(INLINE_MAX - 9)}`
    expect(withinLimit).toHaveLength(INLINE_MAX)
    expect(parseInline(withinLimit)[0]).toEqual({ type: 'strong', text: 'bold' })

    const overLimit = `${withinLimit}z`
    expect(overLimit).toHaveLength(INLINE_MAX + 1)
    expect(parseInline(overLimit)).toEqual([{ type: 'text', text: overLimit }])
  })

  it('drops table columns past TABLE_COLUMNS_MAX', () => {
    const totalCols = TABLE_COLUMNS_MAX + 25
    const headRow = `| ${Array.from({ length: totalCols }, (_, i) => `h${i}`).join(' | ')} |`
    const ruleRow = `| ${Array.from({ length: totalCols }, () => ':---:').join(' | ')} |`
    const bodyRow = `| ${Array.from({ length: totalCols }, (_, i) => `c${i}`).join(' | ')} |`

    const blocks = parseMarkdown(`${headRow}\n${ruleRow}\n${bodyRow}`)
    const table = blocks[0]
    expect(table?.type).toBe('table')
    if (table?.type !== 'table') return
    expect(table.head).toHaveLength(TABLE_COLUMNS_MAX)
    expect(table.align).toHaveLength(TABLE_COLUMNS_MAX)
    expect(table.rows[0]).toHaveLength(TABLE_COLUMNS_MAX)
  })

  it('clamps list nesting depth at LIST_DEPTH_MAX', () => {
    const totalLevels = LIST_DEPTH_MAX + 5
    const source = Array.from(
      { length: totalLevels },
      (_, level) => `${'  '.repeat(level)}- item ${level}`,
    ).join('\n')

    const block = parseMarkdown(source)[0]
    expect(block?.type).toBe('list')
    if (block?.type !== 'list') return
    expect(block.items).toHaveLength(totalLevels)
    expect(block.items[totalLevels - 1]?.depth).toBe(LIST_DEPTH_MAX)
    expect(Math.max(...block.items.map((item) => item.depth))).toBe(LIST_DEPTH_MAX)
  })

  it('does not treat a backtick inline span with backticks in the rest of the line as a code fence or an empty pipe row as a table', () => {
    const blocks = parseMarkdown('```foo`bar`\n\nfollowing paragraph\n\n|\n| --- |')
    expect(blocks[0]?.type).toBe('paragraph')
    expect(blocks[1]).toEqual({
      type: 'paragraph',
      inlines: [{ type: 'text', text: 'following paragraph' }],
      line: 3,
      end: 3,
    })
    expect(blocks.some((b) => b.type === 'table')).toBe(false)
  })

  it.each([
    ['10k asterisks', '*'.repeat(10_000)],
    ['just-under-INLINE_MAX asterisks', '*'.repeat(INLINE_MAX - 1)],
    ['10k unclosed brackets', '['.repeat(10_000)],
    ['just-under-INLINE_MAX unclosed link openers', '[a]('.repeat(Math.floor(INLINE_MAX / 4))],
    ['10k blank lines inside a list', `- first\n${'\n'.repeat(10_000)}- second`],
    ['table rule with 20k trailing spaces before mismatch', `| a |\n| ---${' '.repeat(20_000)}x`],
  ])('finishes pathological %s in under 200ms', (_label, hostile) => {
    const start = performance.now()
    const blocks = parseMarkdown(hostile)
    const elapsedMs = performance.now() - start

    expect(blocks.length).toBeGreaterThan(0)
    expect(elapsedMs).toBeLessThan(200)
  })
})
