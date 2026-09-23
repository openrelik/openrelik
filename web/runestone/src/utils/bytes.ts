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

export interface Reading {
  label: string
  value: string
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

function utc(ms: number): string {
  if (!Number.isFinite(ms) || ms < -8.64e15 || ms > 8.64e15) return '–'
  return new Date(ms)
    .toISOString()
    .replace('T', ' ')
    .replace(/\.000Z$|Z$/, '')
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
  return Date.UTC(year, month - 1, day, hours, minutes, seconds)
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
   * `zero`: the format's zero, in ms since 1970; a value within a second of it
   * reads as "no value". `from`: the earliest the format can mean (its zero,
   * unless it counts back before it, as Apple's does).
   */
  const time = (
    size: number,
    label: string,
    ms: () => number,
    zero: number,
    from: number = zero,
  ) => {
    if (n < size) return
    const value = ms()
    out.push({
      label,
      value: utc(value),
      plausible:
        Number.isFinite(value) && value >= from && value <= now && Math.abs(value - zero) >= 1000,
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
  time(4, 'unix time', () => view.getUint32(0, littleEndian) * 1000, UNIX_ZERO)
  time(8, 'unix time (64)', () => Number(view.getBigInt64(0, littleEndian)) * 1000, UNIX_ZERO)
  time(8, 'unix ms', () => Number(view.getBigInt64(0, littleEndian)), UNIX_ZERO)
  // DOS starts in 1980; fields out of range (month 13, hour 25) read as not a time at all.
  time(
    4,
    'dos date/time',
    () => dosTime(view.getUint16(0, littleEndian), view.getUint16(2, littleEndian)),
    Date.UTC(1980, 0, 1),
  )
  time(
    8,
    'FILETIME',
    () => {
      const ticks = view.getBigUint64(0, littleEndian)
      return Number((ticks - FILETIME_EPOCH) / 10000n)
    },
    FILETIME_ZERO,
  )
  // WebKit/Chrome: microseconds since 1601 (history, cookies).
  time(
    8,
    'webkit time',
    () => {
      const micros = view.getBigInt64(0, littleEndian)
      return Number((micros * 10n - FILETIME_EPOCH) / 10000n)
    },
    FILETIME_ZERO,
  )
  time(4, 'hfs+ time', () => (view.getUint32(0, littleEndian) - HFS_EPOCH_S) * 1000, HFS_ZERO)
  // Apple Cocoa / Core Data: seconds since 2001, as a double (iOS and macOS databases).
  // Apple counts back before 2001 with negative values, as far as FILETIME's start.
  time(
    8,
    'apple time',
    () => (view.getFloat64(0, littleEndian) + COCOA_EPOCH_S) * 1000,
    COCOA_ZERO,
    FILETIME_ZERO,
  )
  return out
}

/** The bytes decoded as text, control characters written out; replacement marks where they are not valid. */
export function decodings(bytes: Uint8Array): Reading[] {
  const ascii = Array.from(bytes, (b) => (b < 0x80 ? String.fromCharCode(b) : '�')).join('')
  return [
    { label: 'ascii', value: escapeControls(ascii) },
    { label: 'utf-8', value: escapeControls(new TextDecoder('utf-8').decode(bytes)) },
    { label: 'utf-16le', value: escapeControls(new TextDecoder('utf-16le').decode(bytes)) },
  ]
}

/** The bytes as space-separated hex pairs, for copying. */
export const toHex = (bytes: Uint8Array): string => Array.from(bytes, hex2).join(' ')
