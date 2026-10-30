/**
 * Converts between the task tree the UI edits and the spec the server runs.
 *
 * The spec is a root chain whose tasks run in parallel on the input files;
 * each task's `tasks` run on its output. A group with a join becomes a chord
 * (the group its header, the join its callback); the tasks of other groups
 * carry a `group` marker, so the grouping survives a reload. The server builds the
 * Celery job from it and answers any malformed spec with a 500, so
 * `runBlocker()` catches what it can before a run is sent.
 */

import type {
  SpecNode,
  ReportRecord,
  SpecTask,
  TaskConfigOption,
  WorkflowSpec,
  WorkflowTaskRecord,
} from '@/api/types'
import { mapOption, missingOptions } from '@/utils/worker'
import { allTasks } from '@/utils/workflow'
import type { Report, Task, TaskGroup, TaskStatus } from '@/types/workflow'
import { hexId } from '@/utils/id'

/** What runs on the inputs, or on a task's output. */
export interface Groups {
  groups: TaskGroup[]
}

export function specFromTasks({ groups }: Groups): WorkflowSpec {
  const toList = (list: TaskGroup[]): SpecNode[] =>
    list.flatMap(({ id, tasks, join }): SpecNode[] => {
      if (!join) return tasks.map((task) => toSpec(task, id))
      // A join with nothing to wait for is just the next task.
      if (!tasks.length) return [toSpec(join, id)]
      return [{ type: 'chord', tasks: tasks.map((task) => toSpec(task)), callback: toSpec(join) }]
    })
  const toSpec = (task: Task, group?: string): SpecTask => ({
    type: 'task',
    uuid: task.id,
    task_name: task.module,
    queue_name: task.queue,
    display_name: task.name,
    description: task.description,
    task_config: task.options.map((option) => ({
      name: option.key,
      label: option.label,
      description: option.description,
      type: option.type,
      required: option.required,
      items: option.items,
      value:
        option.type === 'checkbox' ? task.config[option.key] === 'true' : task.config[option.key],
    })),
    tasks: toList(task.groups),
    group,
  })
  return { workflow: { type: 'chain', isRoot: true, tasks: toList(groups) } }
}

/** The spec in `spec_json`, or null when there is none (a new workflow) or it cannot be read. */
export function parseSpec(json: string | null): WorkflowSpec | null {
  if (!json) return null
  try {
    const spec = JSON.parse(json) as Partial<WorkflowSpec> | null
    return Array.isArray(spec?.workflow?.tasks) ? (spec as WorkflowSpec) : null
  } catch {
    return null
  }
}

const STATUS: Record<string, TaskStatus> = {
  SUCCESS: 'success',
  FAILURE: 'failed',
  REVOKED: 'failed',
  REJECTED: 'failed',
  RECEIVED: 'running',
  STARTED: 'running',
  PROGRESS: 'running',
  RETRY: 'running',
}

const hex = (uuid: string) => uuid.replaceAll('-', '').toLowerCase()

/** A report with something in it, or undefined: the server sends empty ones as defaults. */
function reportOf(raw: ReportRecord | null | undefined): Report | undefined {
  if (!raw || (!raw.summary && !raw.markdown)) return undefined
  return { summary: raw.summary ?? '', priority: raw.priority ?? 0, markdown: raw.markdown ?? '' }
}

/**
 * The spec's tasks, with the status, timing and outputs of the server's task
 * records matched by uuid. Tasks without a record have not been queued.
 */
export function tasksFromSpec(spec: WorkflowSpec | null, records: WorkflowTaskRecord[]): Groups {
  const byUuid = new Map(
    records.filter((record) => record.uuid).map((record) => [hex(record.uuid!), record]),
  )
  const fromSpec = (node: SpecTask): Task => {
    const record = byUuid.get(hex(node.uuid ?? ''))
    // Older specs may hold a dict here; only the list form carries options.
    const config: TaskConfigOption[] = Array.isArray(node.task_config) ? node.task_config : []
    const options = config.map(mapOption)
    return {
      id: node.uuid,
      name: node.display_name || node.task_name,
      module: node.task_name,
      queue: node.queue_name || node.task_name.split('.')[0]!,
      description: node.description,
      status: STATUS[record?.status_short?.toUpperCase() ?? ''] ?? 'pending',
      started: record?.created_at,
      duration: record?.runtime ?? undefined,
      outputs: (record?.output_files ?? []).filter((file) => !file.is_deleted).map((f) => f.id),
      progress: record?.status_progress || record?.status_detail || undefined,
      error: record?.error_exception ?? undefined,
      traceback: record?.error_traceback ?? undefined,
      report: reportOf(record?.task_report),
      fileReports: (record?.file_reports ?? [])
        .flatMap((raw) => {
          const report = reportOf(raw)
          return report && raw.file
            ? [{ ...report, fileId: raw.file.id, fileName: raw.file.display_name }]
            : []
        })
        .sort((a, b) => b.priority - a.priority),
      options,
      config: Object.fromEntries(options.map((option) => [option.key, option.default])),
      groups: fromList(node.tasks ?? []),
    }
  }
  /**
   * Tasks with the same marker form a group, in the order they first appear;
   * unmarked ones (older specs, the original editor) form one group. A chord
   * is a group of its own, with its callback as the join.
   */
  const fromList = (nodes: SpecNode[]): TaskGroup[] => {
    const groups: TaskGroup[] = []
    const byMarker = new Map<string, TaskGroup>()
    const groupFor = (marker: string) => {
      let group = byMarker.get(marker)
      if (!group) {
        group = { id: marker || hexId(), tasks: [] }
        byMarker.set(marker, group)
        groups.push(group)
      }
      return group
    }
    for (const node of nodes) {
      if (node.type === 'task') {
        groupFor(node.group ?? '').tasks.push(fromSpec(node))
      } else if (node.type === 'chord') {
        const tasks = (node.tasks ?? []).filter((t) => t.type === 'task').map(fromSpec)
        const join = node.callback?.type === 'task' ? fromSpec(node.callback) : undefined
        if (!tasks.length && !join) continue
        // A chord without a header would only be its callback.
        groups.push(tasks.length ? { id: hexId(), tasks, join } : { id: hexId(), tasks: [join!] })
      }
    }
    return groups
  }
  return { groups: fromList(spec?.workflow.tasks ?? []) }
}

/** The same spec with a new uuid for every task, so no two runs share one. */
export function withFreshUuids(spec: WorkflowSpec): WorkflowSpec {
  const freshTask = (task: SpecTask): SpecTask => ({
    ...task,
    uuid: hexId(),
    tasks: task.tasks.map(fresh),
  })
  const fresh = (node: SpecNode): SpecNode =>
    node.type === 'chord'
      ? { ...node, tasks: node.tasks.map(freshTask), callback: freshTask(node.callback) }
      : freshTask(node)
  return { workflow: { ...spec.workflow, tasks: spec.workflow.tasks.map(fresh) } }
}

/**
 * Why the tasks cannot run yet, or null when they can. `available` is the
 * registry's task names; pass null while it is unknown.
 */
export function runBlocker({ groups }: Groups, available: Set<string> | null): string | null {
  if (!groups.length) return 'Add a worker first.'
  for (const task of allTasks(groups)) {
    const missing = missingOptions(task.options, task.config)
    if (missing.length) return `${task.name} needs ${missing.join(', ')}.`
    if (available && !available.has(task.module)) return `${task.name}: no worker is online for it.`
  }
  return null
}
