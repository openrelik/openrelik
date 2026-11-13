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
 * Report priorities, as the workers set them (`openrelik_worker_common.reporting.Priority`):
 * 0–100, higher matters more. Named by the level they reach.
 */

export type PriorityLevel = 'critical' | 'high' | 'medium' | 'low' | 'info'

const LEVELS: [number, PriorityLevel][] = [
  [80, 'critical'],
  [40, 'high'],
  [20, 'medium'],
  [10, 'low'],
]

export const priorityLevel = (priority: number): PriorityLevel =>
  LEVELS.find(([floor]) => priority >= floor)?.[1] ?? 'info'

/** Tints and text, as every status in the system: only what needs attention gets a hue. */
export const PRIORITY_TONE: Record<PriorityLevel, string> = {
  critical: 'border-danger/40 bg-danger-tint text-danger',
  high: 'border-warning/40 bg-warning-tint text-warning',
  medium: 'border-border-strong bg-sunken text-ink-secondary',
  low: 'border-border bg-sunken text-ink-muted',
  info: 'border-border bg-sunken text-ink-muted',
}
