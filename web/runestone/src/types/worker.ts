/**
 * The workers the server can queue, as the picker shows them. They come from
 * the task registry of the workers that are online (`useWorkers`).
 */

export interface WorkerOption {
  key: string
  label: string
  description?: string
  /** How to ask for it: `text`, `textarea`, `checkbox` or `select`. */
  type: string
  default: string
  /** Must be filled in before the worker can run. */
  required?: boolean
  /** The choices of a `select`. */
  items?: string[]
}

export interface Worker {
  /** The Celery task name, e.g. `openrelik-worker-strings.tasks.strings`. */
  id: string
  name: string
  queue: string
  description?: string
  options: WorkerOption[]
}
