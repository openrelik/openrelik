import { reactive } from 'vue'
import { ITEMS, type Item } from '@/data/folders'

/**
 * A workflow lives in a folder of its own: the tasks run on input files from
 * the parent folder, and what they produce lands in the workflow folder.
 *
 * A task's children run on its output, and siblings run in parallel — so a
 * plain tree is the whole graph, with no edges to draw.
 */

export type TaskStatus = 'success' | 'running' | 'pending' | 'failed'

export interface Task {
  id: string
  /** Display name, as the worker registers it. */
  name: string
  /** The Celery task that does the work. */
  module: string
  queue: string
  status: TaskStatus
  started?: string
  /** Seconds. For a running task, time so far. */
  duration?: number
  /** File ids produced, in the workflow folder. */
  outputs: number[]
  error?: string
  config: Record<string, string>
  children: Task[]
}

export interface Workflow {
  id: number
  /** The folder the workflow owns. */
  folderId: number
  name: string
  created: string
  /** File ids the first tasks run on. */
  inputs: number[]
  tasks: Task[]
}

export const WORKFLOWS: Workflow[] = reactive<Workflow[]>([])

export const workflowOf = (folderId: number): Workflow | undefined =>
  WORKFLOWS.find((workflow) => workflow.folderId === folderId)

/** Every task, depth first. */
export function allTasks(tasks: Task[]): Task[] {
  return tasks.flatMap((task) => [task, ...allTasks(task.children)])
}

export interface RunStats {
  done: number
  failed: number
  running: number
  total: number
  /** Seconds. Wall time is the slowest chain: siblings overlap, a child waits for its parent. */
  elapsed: number
  state: TaskStatus
}

export function runStats(workflow: Workflow): RunStats {
  const tasks = allTasks(workflow.tasks)
  const by = (status: TaskStatus) => tasks.filter((task) => task.status === status).length
  const chain = (list: Task[]): number =>
    Math.max(0, ...list.map((task) => (task.duration ?? 0) + chain(task.children)))
  const done = by('success')
  const failed = by('failed')
  const running = by('running')
  return {
    done,
    failed,
    running,
    total: tasks.length,
    elapsed: chain(workflow.tasks),
    state: running ? 'running' : failed ? 'failed' : tasks.length === 0 ? 'pending' : 'success',
  }
}

export interface WorkflowTemplate {
  id: string
  name: string
  description: string
  tasks: () => Task[]
}

export function cloneTasks(tasks: Task[], prefix: string = ''): Task[] {
  return tasks.map((t) => {
    const newId = prefix ? `${prefix}-${t.id}` : `${t.id}-${Math.random().toString(36).slice(2, 6)}`
    return {
      ...t,
      id: newId,
      outputs: [],
      status: t.status === 'failed' ? 'failed' : t.status === 'running' ? 'running' : 'pending',
      duration: t.status === 'running' ? 0 : t.duration,
      children: cloneTasks(t.children, prefix),
    }
  })
}

export const WORKFLOW_TEMPLATES: WorkflowTemplate[] = []

export function createWorkflow(options: {
  folderId: number
  files: Item[]
  templateId?: string
}): number {
  const nextId = Math.max(0, ...ITEMS.map((item) => item.id)) + 1
  const template = options.templateId
    ? WORKFLOW_TEMPLATES.find((t) => t.id === options.templateId)
    : undefined
  const name = template ? template.name : 'Untitled workflow'
  const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z')

  ITEMS.push({
    id: nextId,
    parent: options.folderId,
    kind: 'folder',
    name,
    owner: 'jbn',
    created: now,
    modified: now,
  })

  const tasks = template ? template.tasks() : []
  WORKFLOWS.push({
    id: 1000 + nextId,
    folderId: nextId,
    name,
    created: now,
    inputs: options.files.map((file) => file.id),
    tasks,
  })

  return nextId
}

/** Renames a workflow without modifying the underlying folder. */
export function renameWorkflow(id: number, newName: string): boolean {
  const workflow = WORKFLOWS.find((w) => w.id === id)
  if (!workflow) return false
  const trimmed = newName.trim()
  if (!trimmed) return false
  workflow.name = trimmed
  return true
}
