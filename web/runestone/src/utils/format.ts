/**
 * "2026-04-29T15:00:50.123456Z" → "2026-04-29 15:00:50". Kept in UTC, as the
 * source is, and cut to whole seconds: the server's microseconds are noise in
 * a listing, and they used to overflow the column.
 */
export const stamp = (iso: string) =>
  iso
    .replace('T', ' ')
    .replace(/\.\d+/, '')
    .replace(/(Z|[+-]\d{2}:\d{2})$/, '')
    .trim()

const UNITS = ['B', 'kB', 'MB', 'GB', 'TB']

/** Decimal units, as the live instance shows them: 297720 → "297.72 kB". */
export function formatSize(bytes: number): string {
  let value = bytes
  let unit = 0
  while (value >= 1000 && unit < UNITS.length - 1) {
    value /= 1000
    unit++
  }
  return `${unit === 0 ? value : value.toFixed(2)} ${UNITS[unit]}`
}

/** `count(1, 'dir')` → "1 dir", `count(3, 'dir')` → "3 dirs",
 *  `count(2, 'match', 'matches')` → "2 matches". */
export const count = (n: number, noun: string, plural = `${noun}s`) =>
  `${n} ${n === 1 ? noun : plural}`

/** 2.4 → "2.4s", 72 → "1m 12s". */
export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Number(seconds.toFixed(1))}s`
  const total = Math.round(seconds)
  const minutes = Math.floor(total / 60)
  return `${minutes}m ${String(total % 60).padStart(2, '0')}s`
}
