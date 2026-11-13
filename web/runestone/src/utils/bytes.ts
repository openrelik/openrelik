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

/**
 * Byte helpers for the hex viewer: how bytes are written, and what a run of
 * bytes reads as. Pure; nothing here touches the page.
 */

/** Two hex digits. */
export const hex2 = (byte: number): string => byte.toString(16).padStart(2, '0')

/** Hex digits needed for any offset in a file of `size` bytes (at least 8). */
export const offsetWidth = (size: number): number =>
  Math.max(8, Math.max(0, size - 1).toString(16).length)

export const offsetLabel = (offset: number, width: number): string =>
  offset.toString(16).padStart(width, '0')

/** Printable ASCII shows as itself; everything else as a dot, so nothing in a file can pass for markup or control text. */
export const printable = (byte: number): string =>
  byte >= 0x20 && byte <= 0x7e ? String.fromCharCode(byte) : '·'

/** Control characters written out, so a decoded string can be shown and copied as it is. */
export function escapeControls(text: string): string {
  return text.replace(/[\u0000-\u001f\u007f-\u009f]/g, (char) => {
    const escapes: Record<string, string> = { '\n': '\\n', '\r': '\\r', '\t': '\\t' }
    return escapes[char] ?? `\\x${hex2(char.charCodeAt(0))}`
  })
}

/** Parses an offset typed as `0x1f0`, `1f0h` or `496`; null when it is none of those. */
export function parseOffset(input: string): number | null {
  const text = input.trim().toLowerCase()
  const value = /^0x[0-9a-f]+$/.test(text)
    ? parseInt(text.slice(2), 16)
    : /^[0-9a-f]+h$/.test(text)
      ? parseInt(text.slice(0, -1), 16)
      : /^\d+$/.test(text)
        ? parseInt(text, 10)
        : NaN
  return Number.isSafeInteger(value) ? value : null
}

/** An offset, or a range of them as `0x1f3-0x2a0` (either form on each side); sorted. */
export function parseOffsetRange(input: string): { from: number; to: number } | null {
  const parts = input.split(/\s*[-–]\s*/)
  if (parts.length > 2) return null
  const a = parseOffset(parts[0]!)
  const b = parts.length === 2 ? parseOffset(parts[1]!) : a
  if (a === null || b === null) return null
  return { from: Math.min(a, b), to: Math.max(a, b) }
}

export interface Reading {
  label: string
  value: string
  /** Said beside the value, not copied with it: a time's zone when it is not UTC. */
  note?: string
  /** An integer that could be an offset: the viewer offers to go there. */
  offset?: number
  /**
   * A timestamp: false when the format cannot mean it — before the format's
   * own start, in the future, or exactly its zero ("no value").
   */
  plausible?: boolean
}

/** 100 ns ticks between 1601-01-01 (FILETIME, WebKit's epoch) and 1970-01-01 (Unix). */
const FILETIME_EPOCH = 116444736000000000n
/** Seconds from 1904-01-01 (HFS+) to 1970. */
const HFS_EPOCH_S = 2082844800
/** Seconds from 1970 to 2001-01-01 (Apple's Cocoa / Core Data time). */
const COCOA_EPOCH_S = 978307200

/**
 * A time written to its format's precision: `digits` places of a second, every
 * one of them, since a run of zeros is evidence too (a time set by hand rather
 * than by a clock). `fraction`: the places exactly, for formats finer than a
 * millisecond; otherwise they come from `ms`.
 */
function utc(ms: number, digits: number, fraction?: bigint): string {
  if (!Number.isFinite(ms) || ms < -8.64e15 || ms > 8.64e15) return '–'
  // Rounded down, so a time before 1970 with a fraction keeps its second (Date rounds toward zero).
  return new Date(Math.floor(ms))
    .toISOString()
    .replace('T', ' ')
    .replace(/\.(\d{3})Z$/, (_, millis: string) =>
      digits === 0
        ? ''
        : `.${fraction === undefined ? millis : fraction.toString().padStart(digits, '0')}`,
    )
}

/** A count of `perSecond` ticks since 1970 as whole ms and the ticks past the second (both rounded down). */
function ticksSince1970(ticks: bigint, perSecond: bigint): { ms: number; fraction: bigint } {
  const fraction = ((ticks % perSecond) + perSecond) % perSecond
  return { ms: Number(((ticks - fraction) / perSecond) * 1000n), fraction }
}

/** DOS date and time (FAT, ZIP): a 16-bit time then a 16-bit date, local time with 2 s steps. */
function dosTime(time: number, date: number): number {
  const year = 1980 + (date >> 9)
  const month = (date >> 5) & 0xf
  const day = date & 0x1f
  const hours = time >> 11
  const minutes = (time >> 5) & 0x3f
  const seconds = (time & 0x1f) * 2
  if (month < 1 || month > 12 || day < 1 || hours > 23 || minutes > 59 || seconds > 59) return NaN
  const ms = Date.UTC(year, month - 1, day, hours, minutes, seconds)
  const check = new Date(ms)
  if (check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return NaN
  return ms
}

/** Each format's zero, in ms since 1970: where it starts, and what "no value" reads as. */
const UNIX_ZERO = 0
const FILETIME_ZERO = Date.UTC(1601, 0, 1)
const HFS_ZERO = -HFS_EPOCH_S * 1000
const COCOA_ZERO = COCOA_EPOCH_S * 1000

/**
 * What the bytes at the cursor read as: integers (each a possible offset),
 * floats, and the timestamps forensic work meets most, each only when there
 * are enough bytes for it.
 *
 * A time is flagged only when the format cannot mean it: before the format's
 * own start, in the future, or its zero. Whether a possible date is a likely
 * one (1979 can be real: an old archive, a placeholder, a back-dated file) is
 * the examiner's call, not a rule here.
 */
export function readings(bytes: Uint8Array, littleEndian: boolean, now = Date.now()): Reading[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const n = bytes.length
  const out: Reading[] = []
  const int = (size: number, label: string, read: () => number | bigint) => {
    if (n < size) return
    const value = read()
    const asNumber = Number(value)
    out.push({
      label,
      value: String(value),
      offset: asNumber >= 0 && Number.isSafeInteger(asNumber) ? asNumber : undefined,
    })
  }
  /**
   * `read`: ms since 1970, or for formats finer than a millisecond, whole ms
   * and the ticks past the second. `zero`: the format's zero, in ms since
   * 1970; a value within a second of it reads as "no value". `from`: the
   * earliest the format can mean (its zero, unless it counts back before it,
   * as Apple's does). `digits`: places of a second the format keeps. `note`:
   * the zone, when the format's is not UTC.
   */
  const time = (
    size: number,
    label: string,
    read: () => number | { ms: number; fraction: bigint },
    format: { zero: number; from?: number; digits: number; note?: string },
  ) => {
    if (n < size) return
    const result = read()
    const { ms, fraction } =
      typeof result === 'number' ? { ms: result, fraction: undefined } : result
    const from = format.from ?? format.zero
    out.push({
      label,
      value: utc(ms, format.digits, fraction),
      note: format.note,
      plausible:
        Number.isFinite(ms) && ms >= from && ms <= now && Math.abs(ms - format.zero) >= 1000,
    })
  }
  int(1, 'uint8', () => view.getUint8(0))
  int(1, 'int8', () => view.getInt8(0))
  int(2, 'uint16', () => view.getUint16(0, littleEndian))
  int(2, 'int16', () => view.getInt16(0, littleEndian))
  int(4, 'uint32', () => view.getUint32(0, littleEndian))
  int(4, 'int32', () => view.getInt32(0, littleEndian))
  int(8, 'uint64', () => view.getBigUint64(0, littleEndian))
  int(8, 'int64', () => view.getBigInt64(0, littleEndian))
  if (n >= 4) out.push({ label: 'float32', value: String(view.getFloat32(0, littleEndian)) })
  if (n >= 8) out.push({ label: 'float64', value: String(view.getFloat64(0, littleEndian)) })
  const unix = { zero: UNIX_ZERO, digits: 0 }
  time(4, 'unix time', () => view.getUint32(0, littleEndian) * 1000, unix)
  time(8, 'unix time (64)', () => Number(view.getBigInt64(0, littleEndian)) * 1000, unix)
  time(8, 'unix ms', () => Number(view.getBigInt64(0, littleEndian)), { ...unix, digits: 3 })
  // DOS starts in 1980; fields out of range (month 13, hour 25) read as not a time at all.
  // It keeps no zone: the time is the writing machine's clock, shown as it is.
  time(
    4,
    'dos date/time',
    () => dosTime(view.getUint16(0, littleEndian), view.getUint16(2, littleEndian)),
    { zero: Date.UTC(1980, 0, 1), digits: 0, note: 'local' },
  )
  // FILETIME: 100 ns ticks since 1601, all seven places kept (MFT, registry, LNK).
  time(
    8,
    'FILETIME',
    () => ticksSince1970(view.getBigUint64(0, littleEndian) - FILETIME_EPOCH, 10_000_000n),
    { zero: FILETIME_ZERO, digits: 7 },
  )
  // WebKit/Chrome: microseconds since 1601 (history, cookies).
  time(
    8,
    'webkit time',
    () => ticksSince1970(view.getBigInt64(0, littleEndian) - FILETIME_EPOCH / 10n, 1_000_000n),
    { zero: FILETIME_ZERO, digits: 6 },
  )
  time(4, 'hfs+ time', () => (view.getUint32(0, littleEndian) - HFS_EPOCH_S) * 1000, {
    zero: HFS_ZERO,
    digits: 0,
  })
  // Apple Cocoa / Core Data: seconds since 2001, as a double (iOS and macOS databases).
  // Apple counts back before 2001 with negative values, as far as FILETIME's start.
  time(8, 'apple time', () => (view.getFloat64(0, littleEndian) + COCOA_EPOCH_S) * 1000, {
    zero: COCOA_ZERO,
    from: FILETIME_ZERO,
    digits: 3,
  })
  return out
}

const SHORT_ESCAPES: Record<number, string> = { 0x0a: '\\n', 0x0d: '\\r', 0x09: '\\t' }

/** A byte that is not text, as `\xNN`: its value stays readable, where a replacement mark would hide it. */
const byteEscape = (byte: number): string => SHORT_ESCAPES[byte] ?? `\\x${hex2(byte)}`

/** Bytes as ASCII: printable characters as themselves, every other byte written out. */
function asciiEscaped(bytes: Uint8Array): string {
  return Array.from(bytes, (b) =>
    b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : byteEscape(b),
  ).join('')
}

/**
 * The length of the UTF-8 sequence starting at `i`, or 0 when it is not a
 * valid one (a stray continuation, an overlong form, a surrogate, past
 * U+10FFFF, or cut short).
 */
function utf8Length(bytes: Uint8Array, i: number): number {
  const lead = bytes[i]!
  if (lead < 0x80) return 1
  const length =
    lead >= 0xc2 && lead <= 0xdf
      ? 2
      : lead >= 0xe0 && lead <= 0xef
        ? 3
        : lead >= 0xf0 && lead <= 0xf4
          ? 4
          : 0
  if (length === 0 || i + length > bytes.length) return 0
  for (let k = 1; k < length; k++) if ((bytes[i + k]! & 0xc0) !== 0x80) return 0
  const second = bytes[i + 1]!
  if (lead === 0xe0 && second < 0xa0) return 0 // overlong
  if (lead === 0xed && second > 0x9f) return 0 // surrogate
  if (lead === 0xf0 && second < 0x90) return 0 // overlong
  if (lead === 0xf4 && second > 0x8f) return 0 // past U+10FFFF
  return length
}

/**
 * Bytes as UTF-8: valid characters as themselves, each byte of an invalid
 * sequence written out as `\xNN`. Control characters are written out too:
 * C0 ones as their byte, C1 ones (two bytes in UTF-8) as `\u0085`, so an
 * escape always says which bytes are there.
 */
function utf8Escaped(bytes: Uint8Array): string {
  const decoder = new TextDecoder('utf-8')
  let out = ''
  for (let i = 0; i < bytes.length;) {
    const length = utf8Length(bytes, i)
    if (length === 0) {
      out += byteEscape(bytes[i]!)
      i++
      continue
    }
    const char = decoder.decode(bytes.subarray(i, i + length))
    const code = char.codePointAt(0)!
    out +=
      code < 0x20 || code === 0x7f
        ? byteEscape(code)
        : code >= 0x80 && code <= 0x9f
          ? `\\u00${hex2(code)}`
          : char
    i += length
  }
  return out
}

/**
 * The bytes decoded as text, control characters written out. ASCII and UTF-8
 * write every byte they cannot decode as `\xNN`; UTF-16 shows a replacement
 * mark for an unpaired surrogate or a trailing odd byte.
 */
export function decodings(bytes: Uint8Array): Reading[] {
  return [
    { label: 'ascii', value: asciiEscaped(bytes) },
    { label: 'utf-8', value: utf8Escaped(bytes) },
    { label: 'utf-16le', value: escapeControls(new TextDecoder('utf-16le').decode(bytes)) },
  ]
}

/** The bytes as space-separated hex pairs, for copying. */
export const toHex = (bytes: Uint8Array): string => Array.from(bytes, hex2).join(' ')
