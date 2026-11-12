/**
 * Chart helpers: where the axis ticks go and how they read. Pure.
 */

/** Round numbers for a value axis from 0 (or below) to `max`: about `count` of them. */
export function niceTicks(min: number, max: number, count = 4): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [0, 1]
  const steps = Math.max(1, Math.floor(count))
  const low = Math.min(0, min)
  const high = max > low ? max : low + 1
  const raw = (high - low) / steps
  const magnitude = 10 ** Math.floor(Math.log10(raw))
  const step =
    [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((candidate) => candidate >= raw) ??
    10 * magnitude
  const ticks: number[] = []
  for (let value = Math.floor(low / step) * step; value <= high + step * 1e-9; value += step) {
    ticks.push(Number(value.toPrecision(12)))
  }
  const last = ticks[ticks.length - 1]
  if (last !== undefined && last < high) ticks.push(Number((last + step).toPrecision(12)))
  return ticks.length ? ticks : [0, 1]
}

/** A value as an axis or tooltip shows it: whole numbers plain, others to two places, large ones short. */
export function formatValue(value: number): string {
  const abs = Math.abs(value)
  if (abs >= 1e6) return `${(value / 1e6).toFixed(abs >= 1e7 ? 0 : 1)}M`
  if (abs >= 1e4) return `${(value / 1e3).toFixed(abs >= 1e5 ? 0 : 1)}k`
  return Number.isInteger(value) ? String(value) : value.toFixed(2)
}

const TIME_STEPS = [
  15e3,
  30e3,
  60e3,
  5 * 60e3,
  15 * 60e3,
  30 * 60e3,
  3600e3,
  3 * 3600e3,
  6 * 3600e3,
  12 * 3600e3,
  86400e3,
  2 * 86400e3,
  7 * 86400e3,
  30 * 86400e3,
]

/** Round times between `start` and `end` (ms) for a time axis: about `count` of them. */
export function timeTicks(start: number, end: number, count = 5): number[] {
  if (!Number.isFinite(start) || !Number.isFinite(end) || count <= 0) return []
  const span = Math.max(1, end - start)
  const step = TIME_STEPS.find((candidate) => span / candidate <= count) ?? span / count
  const ticks: number[] = []
  // Aligned to the step in local time, so ticks land on :00, midnight and so on.
  const offset = new Date(start).getTimezoneOffset() * 60e3
  for (let t = Math.ceil((start - offset) / step) * step + offset; t <= end; t += step)
    ticks.push(t)
  return ticks
}

const pad = (n: number) => String(n).padStart(2, '0')

/** A time on the axis: the clock within a day, the date across days. */
export function formatTime(ms: number, span: number): string {
  const date = new Date(ms)
  const clock = `${pad(date.getHours())}:${pad(date.getMinutes())}`
  const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
  if (span <= 86400e3) return clock
  if (span <= 3 * 86400e3) return `${day.slice(5)} ${clock}`
  return day
}

/** A time in full, for the tooltip. */
export function formatMoment(ms: number): string {
  const date = new Date(ms)
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}
