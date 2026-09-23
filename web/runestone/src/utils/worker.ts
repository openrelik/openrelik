import type { RegisteredTask, TaskConfigOption } from '@/api/types'
import type { Worker, WorkerOption } from '@/types/worker'

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
