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

import type { WorkerOption } from '@/types/worker'

/**
 * A workflow lives in a folder of its own: the tasks run on input files from
 * the parent folder, and what they produce lands in the workflow folder.
 *
 * What runs on the inputs, and on each task's output, is a list of groups.
 * Every task in every group runs in parallel on that output; a group only
 * matters for its `join`, which runs once all of the group's tasks have
 * finished, on everything they produced. The server calls that a chord: the
 * group is its header, the join its callback.
 *
 * Workflows are loaded from the server (`useWorkflow`) and kept by the folder
 * they own (`stores/workflows.ts`).
 */

/** `skipped` is never sent by the server: a queued task that a failure upstream rules out. */
export type TaskStatus = 'success' | 'running' | 'pending' | 'failed' | 'skipped'

export interface Task {
  /** The spec uuid: 32 hex digits, also the server's task record uuid after a run. */
  id: string
  /** Display name, as the worker registers it. */
  name: string
  /** The Celery task that does the work. */
  module: string
  queue: string
  description?: string
  status: TaskStatus
  started?: string
  /** Seconds. For a running task, time so far. */
  duration?: number
  /** File ids produced, in the workflow folder. */
  outputs: number[]
  /** While running: what the worker says it is doing ("40%", a stage). */
  progress?: string
  error?: string
  /** The full Python traceback behind `error`. */
  traceback?: string
  /** The worker's findings for the whole task. */
  report?: Report
  /** The worker's findings per file, highest priority first. */
  fileReports: FileReport[]
  /** What the worker can be configured with. */
  options: WorkerOption[]
  /** The values chosen, by option key. */
  config: Record<string, string>
  /** What runs on its output. */
  groups: TaskGroup[]
}

/** A worker's findings: a one-line summary, and markdown for the rest. */
export interface Report {
  summary: string
  /** 0–100, higher matters more: 80 critical, 40 high, 20 medium, 10 low, 5 info. */
  priority: number
  markdown: string
}

export interface FileReport extends Report {
  fileId: number
  fileName: string
}

/** Tasks that run side by side, and what waits for all of them. */
export interface TaskGroup {
  /** Stable key for the UI and the spec's `group` marker; not a server id. */
  id: string
  /** At least one. */
  tasks: Task[]
  /** Runs after every task in the group has finished, on all their outputs. */
  join?: Task
}

/** An input file, as the workflow knows it: its files may live in a folder not loaded yet. */
export interface WorkflowInput {
  id: number
  name: string
  dataType?: string
}

export interface Workflow {
  id: number
  /** The folder the workflow owns. */
  folderId: number
  name: string
  created: string
  /** The files the first tasks run on. */
  inputs: WorkflowInput[]
  /** What runs on the inputs. */
  groups: TaskGroup[]
  /** Not run yet: tasks can still be added, configured and removed. */
  draft: boolean
}

/** A group and what it runs on: a task, or the inputs (null). */
export interface PlacedGroup {
  group: TaskGroup
  /** The task whose output it runs on, or null for the inputs. */
  parent: Task | null
}

export interface RunStats {
  done: number
  failed: number
  running: number
  total: number
  /** Seconds. Wall time is the slowest chain: siblings overlap, a child waits for its parent. */
  elapsed: number
  /** A draft has not run: none of its tasks is queued, so it is not "pending". */
  state: Exclude<TaskStatus, 'skipped'> | 'draft'
}
