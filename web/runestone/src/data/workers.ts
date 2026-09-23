import type { RegisteredTask, TaskConfigOption } from '@/api/types'

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

/** The form keeps every value as text; the spec converts checkboxes back (`utils/workflowSpec`). */
const optionValue = (value: unknown): string =>
  value === undefined || value === null ? '' : String(value)

export function mapOption(option: TaskConfigOption): WorkerOption {
  return {
    key: option.name,
    label: option.label || option.name,
    description: option.description,
    type: option.type || 'text',
    default: optionValue(option.value),
    required: option.required || undefined,
    items: option.items,
  }
}

export function mapRegisteredTask(task: RegisteredTask): Worker {
  return {
    id: task.task_name,
    name: task.display_name || task.task_name,
    queue: task.queue_name,
    description: task.description,
    options: (task.task_config ?? []).map(mapOption),
  }
}

/** Options with a required value still empty, by label. */
export const missingOptions = (options: WorkerOption[], config: Record<string, string>): string[] =>
  options.filter((o) => o.required && !config[o.key]?.trim()).map((o) => o.label)

/** The short name operators know a worker by: its queue without the common prefix. */
export const workerShortName = (queue: string): string => queue.replace(/^openrelik-worker-/, '')
