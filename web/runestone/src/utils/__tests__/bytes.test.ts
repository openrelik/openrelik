import { describe, expect, it } from 'vitest'

import {
  decodings,
  escapeControls,
  hex2,
  offsetLabel,
  offsetWidth,
  parseOffset,
  parseOffsetRange,
  printable,
  readings,
  toHex,
  type Reading,
} from '@/utils/bytes'

function byLabel(list: Reading[], label: string): Reading {
  const found = list.find((item) => item.label === label)
  if (!found) throw new Error(`Missing reading: ${label}`)
  return found
}

describe('parseOffset and parseOffsetRange', () => {
  it.each([
    ['0', 0],
    ['496', 496],
    ['0x1f0', 496],
    ['  0X1F0  ', 496],
    ['1f0h', 496],
    ['1F0H', 496],
    ['0h', 0],
  ])('parses offset %j as %d', (input, expected) => {
    expect(parseOffset(input)).toBe(expected)
  })

  it.each(['', '   ', '-1', '-0x1', '0x', 'h', '1f0', '0x1g', '12.5', '0xffffffffffffff'])(
    'returns null for invalid or unsafe offset %j',
    (input) => {
      expect(parseOffset(input)).toBeNull()
    },
  )

  it('parses single offsets and sorted ranges across hex and decimal forms', () => {
    expect(parseOffsetRange('0x1f0')).toEqual({ from: 496, to: 496 })
    expect(parseOffsetRange('0x1f3-0x2a0')).toEqual({ from: 0x1f3, to: 0x2a0 })
    expect(parseOffsetRange('0x2a0 - 0x1f3')).toEqual({ from: 0x1f3, to: 0x2a0 })
    expect(parseOffsetRange('500–1f0h')).toEqual({ from: 496, to: 500 })
    expect(parseOffsetRange('0x10-0x20-0x30')).toBeNull()
    expect(parseOffsetRange('0x10-')).toBeNull()
    expect(parseOffsetRange('bad-0x10')).toBeNull()
  })
})

describe('printable, escapeControls, hex2, offsetWidth, offsetLabel, and toHex', () => {
  it('renders printable ASCII literally and non-printable bytes as middle dots', () => {
    expect(printable(0x1f)).toBe('·')
    expect(printable(0x20)).toBe(' ')
    expect(printable(0x41)).toBe('A')
    expect(printable(0x7e)).toBe('~')
    expect(printable(0x7f)).toBe('·')
    expect(printable(0x00)).toBe('·')
    expect(printable(0xff)).toBe('·')
  })

  it('escapes C0, DEL, and C1 controls including tabs', () => {
    expect(escapeControls('hi\tthere\r\n\x00\x7f\u0085')).toBe('hi\\tthere\\r\\n\\x00\\x7f\\x85')
  })

  it('formats hex bytes and offset labels', () => {
    expect(hex2(0)).toBe('00')
    expect(hex2(0x1f)).toBe('1f')
    expect(offsetWidth(0)).toBe(8)
    expect(offsetWidth(0x1_0000_0000)).toBe(8)
    expect(offsetWidth(0x1_0000_0001)).toBe(9)
    expect(offsetLabel(0x1f0, 8)).toBe('000001f0')
    expect(toHex(new Uint8Array([]))).toBe('')
    expect(toHex(new Uint8Array([0x00, 0x0a, 0xff]))).toBe('00 0a ff')
  })
})

describe('readings', () => {
  const NOW = Date.UTC(2026, 4, 1, 0, 0, 0)
  const TARGET_MS = Date.UTC(2024, 5, 15, 12, 30, 45)
  const TARGET_S = TARGET_MS / 1000
  const FILETIME_EPOCH = 116_444_736_000_000_000n
  const HFS_EPOCH_S = 2_082_844_800
  const COCOA_EPOCH_S = 978_307_200

  it('emits only readings supported by the available byte length and respects subarray offsets', () => {
    expect(readings(new Uint8Array([]), true, NOW)).toEqual([])
    expect(readings(new Uint8Array([0xff]), true, NOW)).toEqual([
      { label: 'uint8', value: '255', offset: 255 },
      { label: 'int8', value: '-1', offset: undefined },
    ])

    const backing = new Uint8Array([0x99, 0x34, 0x12])
    const sub = backing.subarray(1)
    expect(byLabel(readings(sub, true, NOW), 'uint16')).toEqual({
      label: 'uint16',
      value: String(0x1234),
      offset: 0x1234,
    })
    expect(byLabel(readings(sub, false, NOW), 'uint16')).toEqual({
      label: 'uint16',
      value: String(0x3412),
      offset: 0x3412,
    })
  })

  it.each([true, false])('reads integers and floats in littleEndian=%s', (le) => {
    const buf = new Uint8Array(8)
    const view = new DataView(buf.buffer)
    view.setInt32(0, -42, le)
    const neg = readings(buf, le, NOW)
    expect(byLabel(neg, 'int32')).toEqual({ label: 'int32', value: '-42', offset: undefined })
    expect(byLabel(neg, 'uint32').offset).toBe(0xffff_ffd6)

    view.setBigUint64(0, 0x0100_0000_0000_0000n, le)
    expect(byLabel(readings(buf, le, NOW), 'uint64').offset).toBeUndefined()

    view.setFloat32(0, 1.5, le)
    expect(byLabel(readings(buf, le, NOW), 'float32').value).toBe('1.5')

    view.setFloat64(0, -3.25, le)
    expect(byLabel(readings(buf, le, NOW), 'float64').value).toBe('-3.25')
  })

  it.each([true, false])(
    'decodes forensic timestamps and plausibility in littleEndian=%s',
    (le) => {
      const buf = new Uint8Array(8)
      const view = new DataView(buf.buffer)

      // 32-bit Unix seconds & HFS+ seconds
      view.setUint32(0, TARGET_S, le)
      expect(byLabel(readings(buf, le, NOW), 'unix time')).toEqual({
        label: 'unix time',
        value: '2024-06-15 12:30:45',
        note: undefined,
        plausible: true,
      })

      view.setUint32(0, TARGET_S + HFS_EPOCH_S, le)
      expect(byLabel(readings(buf, le, NOW), 'hfs+ time')).toEqual({
        label: 'hfs+ time',
        value: '2024-06-15 12:30:45',
        note: undefined,
        plausible: true,
      })

      // 64-bit Unix seconds and milliseconds
      view.setBigInt64(0, BigInt(TARGET_S), le)
      expect(byLabel(readings(buf, le, NOW), 'unix time (64)')).toEqual({
        label: 'unix time (64)',
        value: '2024-06-15 12:30:45',
        note: undefined,
        plausible: true,
      })

      view.setBigInt64(0, BigInt(TARGET_MS) + 123n, le)
      expect(byLabel(readings(buf, le, NOW), 'unix ms')).toEqual({
        label: 'unix ms',
        value: '2024-06-15 12:30:45.123',
        note: undefined,
        plausible: true,
      })

      // DOS date/time: 2024-06-15 12:30:44 local (2s steps)
      const dosTimeWord = (12 << 11) | (30 << 5) | 22
      const dosDateWord = ((2024 - 1980) << 9) | (6 << 5) | 15
      view.setUint16(0, dosTimeWord, le)
      view.setUint16(2, dosDateWord, le)
      expect(byLabel(readings(buf, le, NOW), 'dos date/time')).toEqual({
        label: 'dos date/time',
        value: '2024-06-15 12:30:44',
        note: 'local',
        plausible: true,
      })

      // FILETIME: 7 fractional digits preserved
      const filetimeTicks = FILETIME_EPOCH + BigInt(TARGET_S) * 10_000_000n + 1_234_567n
      view.setBigUint64(0, filetimeTicks, le)
      expect(byLabel(readings(buf, le, NOW), 'FILETIME')).toEqual({
        label: 'FILETIME',
        value: '2024-06-15 12:30:45.1234567',
        note: undefined,
        plausible: true,
      })

      // WebKit: 6 fractional digits preserved
      const webkitTicks = FILETIME_EPOCH / 10n + BigInt(TARGET_S) * 1_000_000n + 654_321n
      view.setBigInt64(0, webkitTicks, le)
      expect(byLabel(readings(buf, le, NOW), 'webkit time')).toEqual({
        label: 'webkit time',
        value: '2024-06-15 12:30:45.654321',
        note: undefined,
        plausible: true,
      })

      // Apple Cocoa / Core Data: positive post-2001 and negative pre-2001 are both plausible
      view.setFloat64(0, TARGET_S - COCOA_EPOCH_S + 0.5, le)
      expect(byLabel(readings(buf, le, NOW), 'apple time')).toEqual({
        label: 'apple time',
        value: '2024-06-15 12:30:45.500',
        note: undefined,
        plausible: true,
      })

      const pre2001S = Date.UTC(1995, 0, 1, 0, 0, 0) / 1000
      view.setFloat64(0, pre2001S - COCOA_EPOCH_S, le)
      expect(byLabel(readings(buf, le, NOW), 'apple time')).toEqual({
        label: 'apple time',
        value: '1995-01-01 00:00:00.000',
        note: undefined,
        plausible: true,
      })

      // All-zero buffer marks every timestamp implausible (epoch zero or invalid DOS month/day)
      const zeros = readings(new Uint8Array(8), le, NOW)
      for (const label of [
        'unix time',
        'unix time (64)',
        'unix ms',
        'dos date/time',
        'FILETIME',
        'webkit time',
        'hfs+ time',
        'apple time',
      ]) {
        expect(byLabel(zeros, label).plausible).toBe(false)
      }
      expect(byLabel(zeros, 'dos date/time').value).toBe('–')

      // Pre-epoch negative Unix (64) and future timestamps are implausible
      view.setBigInt64(0, -10n, le)
      expect(byLabel(readings(buf, le, NOW), 'unix time (64)')).toEqual({
        label: 'unix time (64)',
        value: '1969-12-31 23:59:50',
        note: undefined,
        plausible: false,
      })

      const futureS = NOW / 1000 + 3600
      view.setUint32(0, futureS, le)
      expect(byLabel(readings(buf, le, NOW), 'unix time').plausible).toBe(false)
    },
  )
})

describe('decodings', () => {
  it('decodes printable ASCII and escapes controls and high bytes in ascii mode', () => {
    const bytes = new Uint8Array([0x41, 0x09, 0x0a, 0x0d, 0x00, 0x7f, 0x80, 0xff])
    expect(byLabel(decodings(bytes), 'ascii').value).toBe('A\\t\\n\\r\\x00\\x7f\\x80\\xff')
  })

  it('decodes valid UTF-8, escapes C1 controls as \\u00XX, and escapes invalid UTF-8 bytes as \\xNN', () => {
    // 'é' (c3 a9), '€' (e2 82 ac), '🔍' (f0 9f 94 8d)
    const valid = new TextEncoder().encode('é€🔍\n\x00')
    expect(byLabel(decodings(valid), 'utf-8').value).toBe('é€🔍\\n\\x00')

    // C1 controls U+0080 (c2 80) and U+0085 (c2 85) vs U+00A0 NBSP (c2 a0)
    const c1 = new Uint8Array([0xc2, 0x80, 0xc2, 0x85, 0xc2, 0xa0])
    expect(byLabel(decodings(c1), 'utf-8').value).toBe('\\u0080\\u0085\u00a0')

    // Invalid sequences:
    // - stray continuation: 0x80
    // - 2-byte overlong '/': 0xc0 0xaf
    // - 3-byte overlong: 0xe0 0x80 0xaf
    // - UTF-16 surrogate U+D800: 0xed 0xa0 0x80
    // - 4-byte overlong: 0xf0 0x80 0x80 0xaf
    // - past U+10FFFF: 0xf4 0x90 0x80 0x80
    // - interrupted lead followed by 'A' (0xc3 0x41) and truncated tail (0xe2 0x82)
    const invalid = new Uint8Array([
      0x80, 0xc0, 0xaf, 0xe0, 0x80, 0xaf, 0xed, 0xa0, 0x80, 0xf0, 0x80, 0x80, 0xaf, 0xf4, 0x90,
      0x80, 0x80, 0xc3, 0x41, 0xe2, 0x82,
    ])
    expect(byLabel(decodings(invalid), 'utf-8').value).toBe(
      '\\x80\\xc0\\xaf\\xe0\\x80\\xaf\\xed\\xa0\\x80\\xf0\\x80\\x80\\xaf\\xf4\\x90\\x80\\x80\\xc3A\\xe2\\x82',
    )
  })

  it('decodes UTF-16LE with escaped controls and replacement marks for invalid tails', () => {
    const valid = new Uint8Array([0x48, 0x00, 0x69, 0x00, 0x09, 0x00, 0x00, 0x00])
    expect(byLabel(decodings(valid), 'utf-16le').value).toBe('Hi\\t\\x00')

    const oddTail = new Uint8Array([0x41, 0x00, 0xff])
    expect(byLabel(decodings(oddTail), 'utf-16le').value).toBe('A\ufffd')
  })
})
