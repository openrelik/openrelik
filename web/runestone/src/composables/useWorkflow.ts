/**
 * Workflow Composable
 *
 * Creates, edits and runs workflows through the OpenRelik REST API and keeps
 * them in the workflow store (`data/workflows.ts`), by the folder they own.
 *
 * - Creating asks the server for a workflow over the chosen files; it makes
 *   the workflow's folder, which is written into the items store at once so
 *   opening it costs no request.
 * - A draft is edited locally first and saved behind the edit: changes are
 *   debounced, one save is in flight at a time, and what changed meanwhile is
 *   saved after it. `workflowActivity()` says what is in flight or failed.
 * - Running sends the spec with fresh task uuids and adopts the spec the
 *   server answers with, whose uuids its task records carry.
 *
 * State is module-scoped, so a save keeps going when the user moves on.
 */

import { computed, reactive, shallowRef, type Ref } from 'vue'

import { api, errorMessage, type WorkflowRecord } from '@/api'
import { folderKeys, mapFolderToItem } from '@/composables/useFolderLoader'
import { ensure, markFresh } from '@/composables/useQueryCache'
import { upsertItems } from '@/data/folders'
import type { Worker } from '@/data/workers'
import {
  allTasks,
  canChainAfter,
  canJoin,
  everyGroup,
  findTask,
  groupOf,
  isActive,
  upsertWorkflow,
  workflowOf,
  type Task,
  type Workflow,
} from '@/data/workflows'
import { count } from '@/utils/format'
import { hexId } from '@/utils/id'
import { parseSpec, specFromTasks, tasksFromSpec, withFreshUuids } from '@/utils/workflowSpec'

/** Query cache keys for workflow data. */
export const workflowKeys = {
  workflow: (id: number) => `workflow:${id}`,
}

/** Wait this long after the last edit before saving, so a burst of edits is one request. */
const SAVE_DELAY_MS = 600
/** How often a running workflow is asked for its tasks' progress. */
export const POLL_MS = 3000

export interface WorkflowActivity {
  saving: boolean
  saveError: string | null
  running: boolean
  /** Why the last run or rename failed. */
  error: string | null
}

const IDLE: WorkflowActivity = Object.freeze({
  saving: false,
  saveError: null,
  running: false,
  error: null,
})

const activity = reactive(new Map<number, WorkflowActivity>())
/** Workflows with edits the server has not got yet. */
const unsaved = new Set<number>()
const saveTimers = new Map<number, ReturnType<typeof setTimeout>>()
const saves = new Map<number, Promise<boolean>>()
/** Runs sent per workflow, so a load that overlapped one can tell. */
const runs = new Map<number, number>()

function activityFor(workflowId: number): WorkflowActivity {
  if (!activity.has(workflowId)) activity.set(workflowId, { ...IDLE })
  return activity.get(workflowId)!
}

/** What is in flight or failed for a workflow; reactive when read in a computed or template. */
export function workflowActivity(workflowId: number): Readonly<WorkflowActivity> {
  return activity.get(workflowId) ?? IDLE
}

export function mapWorkflow(record: WorkflowRecord): Workflow {
  return {
    id: record.id,
    folderId: record.folder.id,
    name: record.display_name,
    created: record.created_at ?? new Date().toISOString(),
    inputs: record.files.map((file) => ({
      id: file.id,
      name: file.display_name,
      dataType: file.data_type ?? undefined,
    })),
    ...tasksFromSpec(parseSpec(record.spec_json), record.tasks),
    draft: record.tasks.length === 0,
  }
}

async function fetchWorkflow(
  folderId: number,
  workflowId: number,
  signal: AbortSignal,
  background: boolean,
): Promise<void> {
  const runsBefore = runs.get(workflowId) ?? 0
  const record = await api.workflows.get(folderId, workflowId, { signal, background })
  // Edits the server has not got yet win over what it had.
  if (unsaved.has(workflowId) || saves.has(workflowId)) return
  // A run started or ended meanwhile: this answer may predate it (a refresh
  // on focus while the run was in flight) and would put the draft back.
  if (workflowActivity(workflowId).running || (runs.get(workflowId) ?? 0) !== runsBefore) return
  upsertWorkflow(mapWorkflow(record))
}

/**
 * Makes sure the workflow owning `folderId` is loaded. Fresh data costs no
 * request; `force` refetches (refresh, polling). Rejects with the fetch error.
 */
export function loadWorkflow(
  folderId: number,
  workflowId: number,
  options: { signal?: AbortSignal; force?: boolean; background?: boolean } = {},
): Promise<void> {
  return ensure(
    workflowKeys.workflow(workflowId),
    (signal) => fetchWorkflow(folderId, workflowId, signal, options.background ?? false),
    { signal: options.signal, force: options.force },
  )
}

/**
 * Creates an empty workflow over `fileIds`, in a new folder inside
 * `parentId`. Resolves with the workflow; rejects with the server's error.
 */
export async function createWorkflow(parentId: number, fileIds: number[]): Promise<Workflow> {
  const record = await api.workflows.create(parentId, fileIds)
  const workflow = mapWorkflow(record)
  upsertItems([
    mapFolderToItem(
      {
        id: record.folder.id,
        display_name: record.display_name,
        user: record.user,
        created_at: record.created_at,
        workflows: [{ id: record.id }],
      },
      parentId,
    ),
  ])
  upsertWorkflow(workflow)
  // All known without asking: the folder is new and empty.
  markFresh(workflowKeys.workflow(workflow.id))
  markFresh(folderKeys.subfolders(workflow.folderId))
  markFresh(folderKeys.files(workflow.folderId))
  return workflow
}

/**
 * Renames the workflow: the new name shows at once and goes back if the
 * server refuses it. Its folder keeps its own name.
 */
export async function renameWorkflow(folderId: number, name: string): Promise<boolean> {
  const workflow = workflowOf(folderId)
  const trimmed = name.trim()
  if (!workflow || !trimmed || trimmed === workflow.name) return false
  const before = workflow.name
  workflow.name = trimmed
  activityFor(workflow.id).error = null
  try {
    await api.workflows.rename(folderId, workflow.id, trimmed)
    return true
  } catch (err: unknown) {
    workflow.name = before
    activityFor(workflow.id).error = `Could not rename: ${errorMessage(err, 'request failed')}`
    return false
  }
}

// --- draft edits ---

/** The draft owning `folderId`, if it can still be edited. */
function editable(folderId: number): Workflow | undefined {
  const workflow = workflowOf(folderId)
  return workflow?.draft && !workflowActivity(workflow.id).running ? workflow : undefined
}

function scheduleSave(workflow: Workflow): void {
  unsaved.add(workflow.id)
  clearTimeout(saveTimers.get(workflow.id))
  saveTimers.set(
    workflow.id,
    setTimeout(() => saveDraft(workflow.folderId), SAVE_DELAY_MS),
  )
}

/** Where a new worker goes. */
export type AddAt =
  /** In a new group on this task's output, or on the inputs (null). */
  | { after: string | null }
  /** In this task's group, right after it: in parallel with it. */
  | { beside: string }
  /** As the join of this group: after all of its tasks, on all their outputs. */
  | { join: string }

/**
 * Adds `worker` to the draft. A join takes a free group (`canJoin`), and
 * nothing is chained after a task whose group has one (`canChainAfter`) —
 * more can still join that group. Resolves at once; the save follows.
 */
export function addTask(
  folderId: number,
  at: AddAt,
  worker: Worker,
  config: Record<string, string>,
): Task | null {
  const workflow = editable(folderId)
  if (!workflow) return null
  const task: Task = {
    id: hexId(),
    name: worker.name,
    module: worker.id,
    queue: worker.queue,
    description: worker.description,
    status: 'pending',
    outputs: [],
    options: worker.options,
    config: { ...config },
    groups: [],
  }

  if ('after' in at) {
    const parent = at.after === null ? workflow : findTask(workflow, at.after)
    if (!parent || (at.after !== null && !canChainAfter(workflow, at.after))) return null
    parent.groups.push({ id: hexId(), tasks: [task] })
  } else if ('beside' in at) {
    const group = groupOf(workflow, at.beside)?.group
    const index = group ? group.tasks.findIndex((t) => t.id === at.beside) : -1
    if (!group || index === -1) return null
    group.tasks.splice(index + 1, 0, task)
  } else {
    const group = everyGroup(workflow).find(({ group }) => group.id === at.join)?.group
    if (!group || !canJoin(group)) return null
    group.join = task
  }
  scheduleSave(workflow)
  return task
}

/** The last removal from a draft, while it can still be undone. */
export interface Removal {
  folderId: number
  /** "Strings", or "Strings and 3 after it". */
  label: string
  undo: () => void
}

/** How long after the last removal the recent ones can still be undone. */
const UNDO_MS = 10_000
/**
 * Recent removals, oldest first: after a node is removed the next slides
 * under the pointer, so two quick clicks remove two.
 */
const removals = shallowRef<Removal[]>([])
let removalTimer: ReturnType<typeof setTimeout> | undefined

/** The removal that undo puts back next, if any; reactive. */
export const lastRemoval: Readonly<Ref<Removal | null>> = computed(
  () => removals.value.at(-1) ?? null,
)

/** Where a removed task was, to put it back. */
interface Place {
  parentId: string | null
  groupId: string
  /** Where its group was among its parent's, should the group have gone with it. */
  groupIndex: number
  /** Its index in the group, or 'join'. */
  at: number | 'join'
  /** The join that became a plain task when the group's last task went. */
  unjoinedId?: string
}

/**
 * Removes a task from the draft, with the tasks that run on its output. A
 * group left empty goes too — unless it has a join, which then becomes a
 * group's only task. Returns the removal, which `undo()` puts back where it
 * was for a while.
 */
export function removeTask(folderId: number, taskId: string): Removal | null {
  const workflow = editable(folderId)
  const placed = workflow && groupOf(workflow, taskId)
  if (!workflow || !placed) return null
  const { group, parent } = placed
  const owner = parent ?? workflow
  const place: Place = {
    parentId: parent?.id ?? null,
    groupId: group.id,
    groupIndex: owner.groups.indexOf(group),
    at: 'join',
  }

  let task: Task
  if (group.join?.id === taskId) {
    task = group.join
    delete group.join
  } else {
    place.at = group.tasks.findIndex((t) => t.id === taskId)
    task = group.tasks.splice(place.at, 1)[0]!
    if (!group.tasks.length && group.join) {
      place.unjoinedId = group.join.id
      group.tasks.push(group.join)
      delete group.join
    } else if (!group.tasks.length) {
      owner.groups.splice(place.groupIndex, 1)
    }
  }
  scheduleSave(workflow)

  const after = allTasks(task.groups).length
  const done: Removal = {
    folderId,
    label: after ? `${task.name} and ${count(after, 'task')} after it` : task.name,
    undo: () => {
      removals.value = removals.value.filter((entry) => entry !== done)
      restore(folderId, place, task)
    },
  }
  removals.value = [...removals.value, done]
  clearTimeout(removalTimer)
  removalTimer = setTimeout(dismissRemovals, UNDO_MS)
  return done
}

/** Forgets the removals that could be undone. */
export function dismissRemovals(): void {
  clearTimeout(removalTimer)
  removals.value = []
}

/**
 * Puts a removed task back where it was. Looked up by id, so it still works
 * after the draft was reloaded; it does nothing when the place is gone (its
 * parent removed, a new join added meanwhile).
 */
function restore(folderId: number, place: Place, task: Task): void {
  const workflow = editable(folderId)
  const owner =
    workflow && (place.parentId === null ? workflow : findTask(workflow, place.parentId))
  if (!workflow || !owner) return
  const group = owner.groups.find((g) => g.id === place.groupId)
  if (place.at === 'join') {
    if (!group || group.join) return
    group.join = task
  } else if (!group) {
    // The group went with its last task: bring it back with it.
    const index = Math.min(place.groupIndex, owner.groups.length)
    owner.groups.splice(index, 0, { id: place.groupId, tasks: [task] })
  } else {
    const unjoined = place.unjoinedId ? group.tasks.findIndex((t) => t.id === place.unjoinedId) : -1
    if (unjoined !== -1 && !group.join) group.join = group.tasks.splice(unjoined, 1)[0]
    group.tasks.splice(Math.min(place.at, group.tasks.length), 0, task)
  }
  scheduleSave(workflow)
}

/** Sets one option of a draft task. */
export function setTaskOption(folderId: number, taskId: string, key: string, value: string): void {
  const workflow = editable(folderId)
  const task = workflow && findTask(workflow, taskId)
  if (!workflow || !task || task.config[key] === value) return
  task.config[key] = value
  scheduleSave(workflow)
}

/**
 * Saves the draft now. Waits for a save in flight and then saves what changed
 * meanwhile. Resolves with whether the server has the latest edits.
 */
function saveDraft(folderId: number): Promise<boolean> {
  const workflow = workflowOf(folderId)
  if (!workflow?.draft) return Promise.resolve(true)
  const id = workflow.id
  clearTimeout(saveTimers.get(id))
  saveTimers.delete(id)

  const inFlight = saves.get(id)
  if (inFlight) return inFlight.then(() => saveDraft(folderId))
  if (!unsaved.has(id)) return Promise.resolve(!workflowActivity(id).saveError)

  const state = activityFor(id)
  unsaved.delete(id)
  state.saving = true
  state.saveError = null
  const save = api.workflows
    .saveSpec(folderId, id, specFromTasks(workflow))
    .then(() => {
      markFresh(workflowKeys.workflow(id))
      return true
    })
    .catch((err: unknown) => {
      unsaved.add(id)
      state.saveError = errorMessage(err, 'request failed')
      return false
    })
    .finally(() => {
      state.saving = false
      saves.delete(id)
    })
  saves.set(id, save)
  return save
}

/** Retries a failed save. */
export function retrySave(folderId: number): void {
  const workflow = workflowOf(folderId)
  if (!workflow) return
  unsaved.add(workflow.id)
  saveDraft(folderId)
}

// --- run ---

/**
 * Runs the draft: sends its spec with a fresh uuid for every task and adopts
 * the workflow the server answers with. Resolves with whether it started;
 * why not is in `workflowActivity().error`.
 */
export async function runWorkflow(folderId: number): Promise<boolean> {
  const workflow = workflowOf(folderId)
  if (!workflow?.draft) return false
  const id = workflow.id
  const state = activityFor(id)
  if (state.running) return false
  state.running = true
  runs.set(id, (runs.get(id) ?? 0) + 1)
  state.error = null

  // The run stores the spec itself; a save landing after it would overwrite
  // the spec with uuids no task record has.
  clearTimeout(saveTimers.get(id))
  saveTimers.delete(id)
  unsaved.delete(id)
  await saves.get(id)

  try {
    const spec = withFreshUuids(specFromTasks(workflow))
    const record = await api.workflows.run(folderId, id, spec)
    upsertWorkflow({ ...mapWorkflow(record), draft: false })
    state.saveError = null
    markFresh(workflowKeys.workflow(id))
    return true
  } catch (err: unknown) {
    state.error = `Could not run: ${errorMessage(err, 'request failed')}`
    // Still a draft: keep the server's copy of it current.
    scheduleSave(workflow)
    return false
  } finally {
    state.running = false
  }
}

const followed = new Set<number>()

/**
 * Keeps a started workflow current while it runs, wherever the user is: a
 * quick run starts one from the folder above it, whose row shows its state.
 * Stops when it is done, on an error, or on sign-out (the store is cleared).
 */
export function followWorkflow(folderId: number): void {
  const workflow = workflowOf(folderId)
  if (!workflow || followed.has(workflow.id)) return
  const id = workflow.id
  followed.add(id)
  const tick = () => {
    const current = workflowOf(folderId)
    if (!current || !isActive(current)) {
      followed.delete(id)
      return
    }
    loadWorkflow(folderId, id, { force: true, background: true }).then(
      () => setTimeout(tick, POLL_MS),
      () => followed.delete(id),
    )
  }
  setTimeout(tick, POLL_MS)
}
