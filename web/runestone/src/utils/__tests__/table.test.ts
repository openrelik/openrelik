import { describe, expect, it } from 'vitest'

import {
  cellText,
  compareKeys,
  csvParser,
  inferType,
  jsonlCells,
  jsonlParser,
  sniffDelimiter,
  sortKey,
  type ColumnType,
  type TableParser,
  type TableRow,
} from '@/utils/table'

interface ParsedTable {
  columns: string[]
  rows: TableRow[]
}

function runInChunks(parser: TableParser, chunks: readonly string[]): ParsedTable {
  const rows: TableRow[] = []
  for (const chunk of chunks) {
    rows.push(...parser.push(chunk))
  }
  rows.push(...parser.end())
  return { columns: [...parser.columns()], rows }
}

/**
 * Asserts that feeding the input in one piece yields the exact same rows and
 * columns as feeding 1 character at a time and splitting at every index 0..N.
 */
function assertSplitIndependent(makeParser: () => TableParser, input: string): ParsedTable {
  const whole = runInChunks(makeParser(), [input])

  const singleChars = Array.from({ length: input.length }, (_, i) => input.slice(i, i + 1))
  expect(runInChunks(makeParser(), singleChars)).toEqual(whole)

  for (let splitAt = 0; splitAt <= input.length; splitAt++) {
    const twoPart = runInChunks(makeParser(), [input.slice(0, splitAt), input.slice(splitAt)])
    expect(twoPart).toEqual(whole)
  }

  return whole
}

describe('split-independence across streaming chunks', () => {
  describe('CSV fixtures', () => {
    it.each([
      {
        name: 'escaped double quotes mid-token and at boundaries',
        delimiter: ',',
        input: 'id,quote\n1,"say ""hello"" now"\n2,"""wrapped"""\n3,""\n',
      },
      {
        name: 'CRLF line endings, blank CRLF lines, and CRLF inside quotes',
        delimiter: ',',
        input: 'col_a,col_b\r\n"line 1\r\nline 2",42\r\n\r\nplain,"a,b"\r\n',
      },
      {
        name: 'trailing empty cell and no final newline',
        delimiter: ',',
        input: 'h1,h2,h3\n"a,b",mid,\n1,2,',
      },
      {
        name: 'stray quote inside an unquoted cell and unclosed EOF quote',
        delimiter: '\t',
        input: 'k\tv\r\na"b\t"unclosed\tvalue',
      },
      {
        name: 'empty input',
        delimiter: ',',
        input: '',
      },
    ])('produces identical output for $name', ({ delimiter, input }) => {
      assertSplitIndependent(() => csvParser(delimiter), input)
    })
  })

  describe('JSONL fixtures', () => {
    it.each([
      {
        name: 'objects with growing keys, CRLF endings, and blank lines',
        input: '{"id":1,"msg":"hi"}\r\n\r\n{"id":2,"extra":[1,2]}\n{"third":true}',
      },
      {
        name: 'interleaved invalid JSON, primitives, and arrays',
        input: '{"ok":1}\n{broken json\r\n42\n["a","b"]\n   \n',
      },
      {
        name: 'empty input',
        input: '',
      },
    ])('produces identical output for $name', ({ input }) => {
      assertSplitIndependent(() => jsonlParser(), input)
    })
  })
})

describe('csvParser', () => {
  it('keeps delimiters inside quoted cells without splitting', () => {
    const result = runInChunks(csvParser(','), ['host,command\nws01,"cmd /c ""echo a,b,c"""\n'])
    expect(result.columns).toEqual(['host', 'command'])
    expect(result.rows).toEqual([{ cells: ['ws01', 'cmd /c "echo a,b,c"'] }])
  })

  it('unescapes doubled quotes inside quoted fields', () => {
    const result = runInChunks(csvParser(','), ['val\n""""\n"a""""b"\n'])
    expect(result.rows).toEqual([{ cells: ['"'] }, { cells: ['a""b'] }])
  })

  it('preserves LF and CRLF newlines inside quoted cells', () => {
    const result = runInChunks(csvParser(','), [
      'id,body\n1,"first\nsecond"\r\n2,"alpha\r\nbeta"\r\n',
    ])
    expect(result.rows).toEqual([
      { cells: ['1', 'first\nsecond'] },
      { cells: ['2', 'alpha\r\nbeta'] },
    ])
  })

  it('produces identical rows for LF vs CRLF and trailing newline vs none', () => {
    const lfTrailing = runInChunks(csvParser(','), ['a,b\n1,2\n3,4\n'])
    const crlfTrailing = runInChunks(csvParser(','), ['a,b\r\n1,2\r\n3,4\r\n'])
    const lfNoTrailing = runInChunks(csvParser(','), ['a,b\n1,2\n3,4'])
    const crlfNoTrailing = runInChunks(csvParser(','), ['a,b\r\n1,2\r\n3,4'])

    expect(crlfTrailing).toEqual(lfTrailing)
    expect(lfNoTrailing).toEqual(lfTrailing)
    expect(crlfNoTrailing).toEqual(lfTrailing)
  })

  it('skips blank lines while keeping multi-cell empty rows', () => {
    const result = runInChunks(csvParser(','), ['\n\r\na,b\n\n,\r\n1,2\n\n'])
    expect(result.columns).toEqual(['a', 'b'])
    expect(result.rows).toEqual([{ cells: ['', ''] }, { cells: ['1', '2'] }])
  })

  it('preserves ragged rows with fewer or more cells than the header', () => {
    const result = runInChunks(csvParser(','), ['a,b,c\nonly_one\n1,2,3,4,5\n'])
    expect(result.columns).toEqual(['a', 'b', 'c'])
    expect(result.rows).toEqual([{ cells: ['only_one'] }, { cells: ['1', '2', '3', '4', '5'] }])
  })

  it('falls back to column N for empty header cells', () => {
    const result = runInChunks(csvParser(','), [',ts,,hash\n1,2026-01-01,x,abc\n'])
    expect(result.columns).toEqual(['column 1', 'ts', 'column 3', 'hash'])
  })

  it('emits the first row as data when firstRowIsHeader is false', () => {
    const result = runInChunks(csvParser(',', false), ['alice,admin\nbob,viewer\n'])
    expect(result.rows).toEqual([{ cells: ['alice', 'admin'] }, { cells: ['bob', 'viewer'] }])
  })

  it('synthesizes column N names from the widest row when firstRowIsHeader is false', () => {
    const result = runInChunks(csvParser(',', false), ['alice,admin\nbob,viewer,active\n'])
    expect(result.columns).toEqual(['column 1', 'column 2', 'column 3'])
  })

  it('returns empty rows and columns on empty input', () => {
    expect(runInChunks(csvParser(','), [''])).toEqual({ columns: [], rows: [] })
  })
})

describe('sniffDelimiter', () => {
  it.each([
    ['comma', 'id,name,size\n1,report.txt,120\n2,image.dd,4096\n', ','],
    ['semicolon', 'id;name;size\n1;report.txt;120\n2;image.dd;4096\n', ';'],
    ['tab', 'id\tname\tsize\n1\treport.txt\t120\n2\timage.dd\t4096\n', '\t'],
    ['pipe', 'id|name|size\n1|report.txt|120\n2|image.dd|4096\n', '|'],
  ])('detects %s delimiter', (_label, sample, expected) => {
    expect(sniffDelimiter(sample)).toBe(expected)
  })

  it('ignores candidate delimiters inside double-quoted fields', () => {
    const sample = '"a;b;c|d",10\n"e;f;g|h",20\n"i;j;k|l",30\n'
    expect(sniffDelimiter(sample)).toBe(',')
  })

  it.each([
    ['empty sample', ''],
    ['single column with no delimiters', 'alpha\nbeta\ngamma\n'],
    ['tied delimiter counts default to comma', 'a,b;c\n1,2;3\n'],
  ])('falls back to comma for %s', (_label, sample) => {
    expect(sniffDelimiter(sample)).toBe(',')
  })
})

describe('jsonlParser, jsonlCells, and cellText', () => {
  it('parses valid objects and grows columns() in first-seen key order', () => {
    const parser = jsonlParser()
    const firstBatch = parser.push('{"ts":"2026-01-01","user":"root"}\n')
    expect(parser.columns()).toEqual(['ts', 'user'])

    const secondBatch = [
      ...parser.push('{"user":"daemon","pid":42,"meta":{"ok":true}}\n'),
      ...parser.end(),
    ]
    expect(parser.columns()).toEqual(['ts', 'user', 'pid', 'meta'])

    const allRows = [...firstBatch, ...secondBatch]
    expect(allRows.map((row) => jsonlCells(row, parser.columns()))).toEqual([
      ['2026-01-01', 'root', '', ''],
      ['', 'daemon', '42', '{"ok":true}'],
    ])
  })

  it('retains invalid JSON lines with error and raw without stopping', () => {
    const result = runInChunks(jsonlParser(), ['{"a":1,"b":2}\n{truncated\n{"a":3,"b":4}\n'])
    expect(result.columns).toEqual(['a', 'b'])
    expect(result.rows).toHaveLength(3)

    const bad = result.rows[1]
    expect(bad).toBeDefined()
    if (!bad) return
    expect(bad.record).toBeUndefined()
    expect(bad.raw).toBe('{truncated')
    expect(bad.error).toBeTruthy()
    expect(result.rows.map((row) => jsonlCells(row, result.columns))).toEqual([
      ['1', '2'],
      ['{truncated', ''],
      ['3', '4'],
    ])
  })

  it('ignores blank and whitespace-only lines', () => {
    const result = runInChunks(jsonlParser(), ['\n   \r\n{"k":"v"}\r\n\t  \n'])
    expect(result.rows).toHaveLength(1)
    expect(result.rows[0]?.record).toEqual({ k: 'v' })
  })

  it('wraps top-level primitives and arrays as { value }', () => {
    const result = runInChunks(jsonlParser(), ['42\n"hello"\ntrue\nnull\n[1,2]\n'])
    expect(result.columns).toEqual(['value'])
    expect(result.rows.map((row) => row.record)).toEqual([
      { value: 42 },
      { value: 'hello' },
      { value: true },
      { value: null },
      { value: [1, 2] },
    ])
    expect(result.rows.map((row) => jsonlCells(row, result.columns))).toEqual([
      ['42'],
      ['hello'],
      ['true'],
      [''],
      ['[1,2]'],
    ])
  })

  it.each([
    [null, ''],
    [undefined, ''],
    ['plain text', 'plain text'],
    ['', ''],
    [0, '0'],
    [-12.5, '-12.5'],
    [false, 'false'],
    [{ nested: [1, 'x'] }, '{"nested":[1,"x"]}'],
    [['a', 2], '["a",2]'],
  ])('formats cellText(%j) as %j', (input, expected) => {
    expect(cellText(input)).toBe(expected)
  })
})

describe('inferType, sortKey, and compareKeys', () => {
  describe('inferType', () => {
    it('enforces the 95% threshold across non-empty values', () => {
      const nineteenNumbers = Array.from({ length: 19 }, (_, i) => String(i))
      expect(inferType([...nineteenNumbers, 'N/A'])).toBe('number')
      expect(inferType([...nineteenNumbers.slice(0, 18), 'N/A', 'ERR'])).toBe('text')

      const nineteenDates = Array.from({ length: 19 }, () => '2026-11-11T00:41:26Z')
      expect(inferType([...nineteenDates, 'unknown'])).toBe('date')
      expect(inferType([...nineteenDates.slice(0, 18), 'unknown', 'bad'])).toBe('text')

      const nineteenBooleans = Array.from({ length: 19 }, (_, i) =>
        i % 2 === 0 ? 'true' : 'FALSE',
      )
      expect(inferType([...nineteenBooleans, 'maybe'])).toBe('boolean')
      expect(inferType([...nineteenBooleans.slice(0, 18), 'maybe', '2'])).toBe('text')
    })

    it.each<[string, string[], ColumnType]>([
      ['empty sample', [], 'text'],
      ['whitespace-only sample', ['', '   ', '\t'], 'text'],
      ['numbers with blank cells ignored', [' -3.14 ', '.5', '1e6', '+42', '', '  '], 'number'],
      [
        'ISO dates with T, space, fractional seconds, and offsets',
        ['2026-11-11', '2026-11-11 12:30:00', '2026-11-11T12:30:00.123+02:00', ''],
        'date',
      ],
      ['case-insensitive booleans', ['true', 'False', 'TRUE', ''], 'boolean'],
      ['free-form text', ['alpha', 'beta', 'gamma'], 'text'],
    ])('infers %s as %s', (_label, sample, expected) => {
      expect(inferType(sample)).toBe(expected)
    })
  })

  describe('sortKey', () => {
    it.each<[ColumnType, string, number | string | null]>([
      ['number', '', null],
      ['date', '', null],
      ['boolean', '', null],
      ['text', '', null],
      ['number', '-42.5', -42.5],
      ['number', '1e3', 1000],
      ['number', 'not-a-number', null],
      ['date', '2026-11-11T00:00:00Z', Date.parse('2026-11-11T00:00:00Z')],
      ['date', '2026-11-11 00:00:00Z', Date.parse('2026-11-11T00:00:00Z')],
      ['date', 'not-a-date', null],
      ['boolean', 'true', 'true'],
      ['text', 'file10.txt', 'file10.txt'],
    ])('computes sortKey for %s cell %j', (type, value, expected) => {
      expect(sortKey(value, type)).toBe(expected)
    })
  })

  describe('compareKeys', () => {
    it('sorts numbers numerically and strings with natural numeric collation', () => {
      const numbers = [10, -3, 2, 0].sort(compareKeys)
      expect(numbers).toEqual([-3, 0, 2, 10])

      const names = ['part10.dd', 'part2.dd', 'part1.dd'].sort(compareKeys)
      expect(names).toEqual(['part1.dd', 'part2.dd', 'part10.dd'])
    })

    it('places null empty keys last regardless of peer type', () => {
      expect(compareKeys(null, null)).toBe(0)
      expect(compareKeys(null, -999)).toBeGreaterThan(0)
      expect(compareKeys(-999, null)).toBeLessThan(0)
      expect(compareKeys(null, 'a')).toBeGreaterThan(0)
      expect(compareKeys('a', null)).toBeLessThan(0)

      const mixed: (number | null)[] = [null, 20, null, 3, -1]
      expect(mixed.sort(compareKeys)).toEqual([-1, 3, 20, null, null])
    })
  })
})
