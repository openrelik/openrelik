/**
 * Workflow Composable
 *
 * Creates, edits and runs workflows through the OpenRelik REST API and keeps
 * them in the workflow store (`stores/workflows.ts`), by the folder they own.
 *
 * - Creating asks the server for a workflow over the chosen files; it makes
 *   the workflow's folder, which is written into the items store at once so
 *   opening it costs no request.
 * - A draft is edited locally first and saved behind the edit: changes are
 *   debounced, one save is in flight at a time, and what changed meanwhile is
 *   saved after it. `workflowActivity()` says what is in flight or failed.
 * - Running sends the spec with fresh task uuids and adopts the spec the
 *   server answers with, whose uuids its task records carry.
 * - Discarding a draft deletes its folder, which takes the workflow with it.
 * - A workflow that has run can be copied (a new draft over the same inputs,
 *   in a folder of its own) or saved as a template.
 *
 * State is module-scoped, so a save keeps going when the user moves on.
 */

import { computed, reactive, shallowRef, type Ref } from 'vue'

import { api, errorMessage, type WorkflowRecord } from '@/api'
import { folderKeys, mapFolderToItem } from '@/composables/useFolderLoader'
import { askForText, confirmAction } from '@/composables/useConfirm'
import { useFolderActions } from '@/composables/useFolderActions'
import { addTemplate } from '@/composables/useWorkflowTemplates'
import { refreshAll } from '@/composables/useAutoRefresh'
import { ensure, forget, invalidate, markFresh } from '@/composables/useQueryCache'
import { useItemsStore } from '@/stores/items'
import type { Worker } from '@/types/worker'
import {
  allTasks,
  canChainAfter,
  canJoin,
  canJoinAll,
  everyGroup,
  everyTask,
  findTask,
  groupOf,
  isActive,
  mergeProblem,
} from '@/utils/workflow'
import { useWorkflowsStore } from '@/stores/workflows'
import type { Task, TaskGroup, Workflow } from '@/types/workflow'
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
  const workflowsStore = useWorkflowsStore()
  const runsBefore = runs.get(workflowId) ?? 0
  const record = await api.workflows.get(folderId, workflowId, { signal, background })
  // Edits the server has not got yet win over what it had.
  if (unsaved.has(workflowId) || saves.has(workflowId)) return
  // A run started or ended meanwhile: this answer may predate it (a refresh
  // on focus while the run was in flight) and would put the draft back.
  if (workflowActivity(workflowId).running || (runs.get(workflowId) ?? 0) !== runsBefore) return
  const workflow = mapWorkflow(record)
  listNewOutputs(workflowsStore.workflowOf(folderId), workflow)
  workflowsStore.upsertWorkflow(workflow)
}

/**
 * Tasks write their outputs into the workflow's folder, behind the app's back:
 * the folder's file listing was known — as empty, when the workflow was made
 * — and would stay "fresh" without them. When the workflow names outputs the
 * store has not seen, the listing is stale: on screen it refreshes now,
 * elsewhere on the next visit.
 */
function listNewOutputs(before: Workflow | undefined, after: Workflow): void {
  // A workflow seen for the first time left no stale listing behind.
  if (!before) return
  const known = new Set(everyTask(before).flatMap((task) => task.outputs))
  const fresh = everyTask(after).some((task) => task.outputs.some((id) => !known.has(id)))
  if (!fresh) return
  invalidate(folderKeys.files(after.folderId))
  refreshAll()
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
 * Creates a workflow over `fileIds` — empty, or from a template — in a new
 * folder inside `parentId`. Resolves with the workflow; rejects with the
 * server's error.
 */
export async function createWorkflow(
  parentId: number,
  fileIds: number[],
  templateId?: number,
): Promise<Workflow> {
  return adopt(await api.workflows.create(parentId, fileIds, templateId), parentId)
}

/**
 * Takes in a workflow the server just made, in a new folder inside
 * `parentId`: the folder and the workflow go into the stores, and both are
 * known to be fresh, so opening the folder costs no request.
 */
function adopt(record: WorkflowRecord, parentId: number): Workflow {
  const workflow = mapWorkflow(record)
  useItemsStore().upsertItems([
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
  useWorkflowsStore().upsertWorkflow(workflow)
  // All known without asking: the folder is new and empty.
  markFresh(workflowKeys.workflow(workflow.id))
  markFresh(folderKeys.subfolders(workflow.folderId))
  markFresh(folderKeys.files(workflow.folderId))
  return workflow
}

/**
 * Renames the workflow, which is renaming its folder: the two share one name,
 * owned by the folder (`renameFolder` renames both). A failure shows on the
 * workflow too, where the rename was typed.
 */
export async function renameWorkflow(folderId: number, name: string): Promise<boolean> {
  const workflow = useWorkflowsStore().workflowOf(folderId)
  const trimmed = name.trim()
  if (!workflow || !trimmed) return false
  activityFor(workflow.id).error = null
  const folderActions = useFolderActions()
  const ok = await folderActions.renameFolder(folderId, trimmed)
  if (!ok && folderActions.error.value) activityFor(workflow.id).error = folderActions.error.value
  return ok
}

// --- draft edits ---

/** The draft owning `folderId`, if it can still be edited. */
function editable(folderId: number): Workflow | undefined {
  const workflow = useWorkflowsStore().workflowOf(folderId)
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
   * As the join of everything on this task's output, or the inputs' (null):
   * its sibling groups merge into one, and the worker waits for all of them.
   */
  | { joinAll: string | null }

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
    fileReports: [],
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
  } else if ('join' in at) {
    const group = everyGroup(workflow).find(({ group }) => group.id === at.join)?.group
    if (!group || !canJoin(group)) return null
    group.join = task
  } else {
    const owner = at.joinAll === null ? workflow : findTask(workflow, at.joinAll)
    if (!owner || !canJoinAll(owner.groups)) return null
    const [target, ...others] = owner.groups
    for (const group of others) target!.tasks.push(...group.tasks)
    owner.groups = [target!]
    target!.join = task
  }
  scheduleSave(workflow)
  return task
}

/** A recent edit to a draft (a removal, a split), while it can still be undone. */
export interface Edit {
  folderId: number
  /** What was done: "removed Strings and 3 after it", "split 2 tasks into a new group". */
  label: string
  undo: () => void
  /** Whether undo can still revert it; later edits can make it moot. */
  undoable: () => boolean
}

/** How long after the last edit the recent ones can still be undone. */
const UNDO_MS = 10_000
/**
 * Recent edits, oldest first: after a node is removed the next slides under
 * the pointer, so two quick clicks remove two.
 */
const edits = shallowRef<Edit[]>([])
let editTimer: ReturnType<typeof setTimeout> | undefined

/** The edit that undo reverts next, if any; reactive. */
export const lastEdit: Readonly<Ref<Edit | null>> = computed(
  () => [...edits.value].reverse().find((edit) => edit.undoable()) ?? null,
)

/** Keeps an edit undoable for a while. */
function record(
  folderId: number,
  label: string,
  revert: () => void,
  undoable: () => boolean = () => true,
): Edit {
  const edit: Edit = {
    folderId,
    label,
    undoable,
    undo: () => {
      edits.value = edits.value.filter((entry) => entry !== edit)
      revert()
    },
  }
  edits.value = [...edits.value, edit]
  clearTimeout(editTimer)
  editTimer = setTimeout(dismissEdits, UNDO_MS)
  return edit
}

/** Forgets the edits that could be undone. */
export function dismissEdits(): void {
  clearTimeout(editTimer)
  edits.value = []
}

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
export function removeTask(folderId: number, taskId: string): Edit | null {
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
  const what = after ? `${task.name} and ${count(after, 'task')} after it` : task.name
  return record(folderId, `removed ${what}`, () => restore(folderId, place, task))
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

/**
 * Moves some of a group's tasks into a new group of their own, next to it:
 * above it when they were the group's top tasks, below it otherwise. They still run on the same input as before, and the new group can have
 * a join of its own — how a chord is made from part of a group. Takes some,
 * not all, of one group's tasks. Returns the new group; undo puts them back.
 */
export function splitGroup(folderId: number, taskIds: string[]): TaskGroup | null {
  const workflow = editable(folderId)
  const placed = workflow && taskIds[0] ? groupOf(workflow, taskIds[0]) : undefined
  if (!workflow || !placed) return null
  const { group, parent } = placed
  const picked = group.tasks.filter((task) => taskIds.includes(task.id))
  if (picked.length !== new Set(taskIds).size || picked.length >= group.tasks.length) return null

  const owner = parent ?? workflow
  // Where each went from, to put them back in order.
  const from = picked.map((task) => [task.id, group.tasks.indexOf(task)] as const)
  const split: TaskGroup = { id: hexId(), tasks: picked }
  // Tasks taken off the top of the group become a group above it, so nothing
  // jumps; any other pick (the bottom, or scattered tasks) goes below.
  const fromTop = from.every(([, index], n) => index === n)
  const at = owner.groups.indexOf(group) + (fromTop ? 0 : 1)
  group.tasks = group.tasks.filter((task) => !picked.includes(task))
  owner.groups.splice(at, 0, split)
  scheduleSave(workflow)

  const splitOf = () => {
    const current = useWorkflowsStore().workflowOf(folderId)
    const owner = current && (parent ? findTask(current, parent.id) : current)
    return owner?.groups.find((g) => g.id === split.id)
  }
  record(
    folderId,
    `split ${count(picked.length, 'task')} into a new group`,
    () => unsplit(folderId, parent?.id ?? null, group.id, split.id, from),
    // Not once the new group has a join of its own: that is what it was for.
    () => {
      const current = splitOf()
      return !!current && !current.join
    },
  )
  return owner.groups.find((g) => g.id === split.id) ?? null
}

/**
 * Undoes a split: the tasks go back to their group, where they were. Tasks
 * added to the new group since stay in it; it is left alone once it has a
 * join of its own.
 */
function unsplit(
  folderId: number,
  parentId: string | null,
  groupId: string,
  splitId: string,
  from: (readonly [string, number])[],
): void {
  const workflow = editable(folderId)
  const owner = workflow && (parentId === null ? workflow : findTask(workflow, parentId))
  const group = owner?.groups.find((g) => g.id === groupId)
  const split = owner?.groups.find((g) => g.id === splitId)
  if (!workflow || !owner || !group || !split || split.join) return
  for (const [id, index] of [...from].sort((a, b) => a[1] - b[1])) {
    const at = split.tasks.findIndex((task) => task.id === id)
    if (at === -1) continue
    group.tasks.splice(Math.min(index, group.tasks.length), 0, split.tasks.splice(at, 1)[0]!)
  }
  if (!split.tasks.length) owner.groups.splice(owner.groups.indexOf(split), 1)
  scheduleSave(workflow)
}

/** A group merged into another, as it was: to take it back out. */
interface Merged {
  id: string
  /** Where it sat among its parent's groups. */
  index: number
  taskIds: string[]
  joinId?: string
}

/**
 * Merges sibling groups into the upper one: the others' tasks follow its
 * own, in order, and the groups in between stay where they are. A join, if
 * one of them has it, stays and now waits for them all — refused where that
 * is not allowed (`mergeProblem`). Returns the merged group; undo takes the
 * others back out.
 */
export function mergeGroups(folderId: number, groupIds: string[]): TaskGroup | null {
  const workflow = editable(folderId)
  if (!workflow) return null
  const placed = everyGroup(workflow).filter(({ group }) => groupIds.includes(group.id))
  const parent = placed[0]?.parent ?? null
  if (placed.length !== new Set(groupIds).size || placed.some((p) => p.parent !== parent))
    return null
  if (mergeProblem(placed.map(({ group }) => group))) return null

  const owner = parent ?? workflow
  const [target, ...others] = placed
    .map(({ group }) => group)
    .sort((a, b) => owner.groups.indexOf(a) - owner.groups.indexOf(b))
  const merged: Merged[] = others.map((group) => ({
    id: group.id,
    index: owner.groups.indexOf(group),
    taskIds: group.tasks.map((task) => task.id),
    joinId: group.join?.id,
  }))
  for (const group of others) {
    target!.tasks.push(...group.tasks)
    if (group.join) target!.join = group.join
    owner.groups.splice(owner.groups.indexOf(group), 1)
  }
  scheduleSave(workflow)

  record(
    folderId,
    `merged ${count(placed.length, 'group')}`,
    () => unmerge(folderId, parent?.id ?? null, target!.id, merged),
    () => !!findGroup(folderId, parent?.id ?? null, target!.id),
  )
  return target!
}

/** A group among a task's (or the inputs') groups, by id, in the current draft. */
function findGroup(folderId: number, parentId: string | null, groupId: string) {
  const current = useWorkflowsStore().workflowOf(folderId)
  const owner = current && (parentId === null ? current : findTask(current, parentId))
  return owner?.groups.find((group) => group.id === groupId)
}

/** Undoes a merge: each merged group comes back where it was, with its tasks and join. */
function unmerge(folderId: number, parentId: string | null, targetId: string, merged: Merged[]) {
  const workflow = editable(folderId)
  const owner = workflow && (parentId === null ? workflow : findTask(workflow, parentId))
  const target = owner?.groups.find((group) => group.id === targetId)
  if (!workflow || !owner || !target) return
  for (const { id, index, taskIds, joinId } of [...merged].sort((a, b) => a.index - b.index)) {
    const tasks = taskIds
      .map((taskId) => target.tasks.find((task) => task.id === taskId))
      .filter((task): task is Task => !!task)
    if (!tasks.length) continue
    target.tasks = target.tasks.filter((task) => !tasks.includes(task))
    const group: TaskGroup = { id, tasks }
    if (joinId && target.join?.id === joinId) {
      group.join = target.join
      delete target.join
    }
    owner.groups.splice(Math.min(index, owner.groups.length), 0, group)
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
  const workflow = useWorkflowsStore().workflowOf(folderId)
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
  const workflow = useWorkflowsStore().workflowOf(folderId)
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
  const workflowsStore = useWorkflowsStore()
  const workflow = workflowsStore.workflowOf(folderId)
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
    workflowsStore.upsertWorkflow({ ...mapWorkflow(record), draft: false })
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

// --- copy, template ---

/**
 * Copies a workflow to remix it: a new draft over the same inputs, with the
 * same tasks and options, in a "Copy of …" folder next to this one.
 * Resolves with the copy; null on failure, why in `workflowActivity().error`.
 */
export async function copyWorkflow(folderId: number): Promise<Workflow | null> {
  const workflow = useWorkflowsStore().workflowOf(folderId)
  const parentId = useItemsStore().findFolder(folderId)?.parent
  if (!workflow || parentId === null || parentId === undefined) return null
  const state = activityFor(workflow.id)
  state.error = null
  try {
    return adopt(await api.workflows.copy(folderId, workflow.id), parentId)
  } catch (err: unknown) {
    state.error = `Could not copy: ${errorMessage(err, 'request failed')}`
    return null
  }
}

/**
 * Saves the workflow as a template, under a name the user picks (the
 * workflow's own to start with). Resolves with the name saved under; null
 * when cancelled or refused, why in `workflowActivity().error`.
 */
export async function saveAsTemplate(folderId: number): Promise<string | null> {
  const workflow = useWorkflowsStore().workflowOf(folderId)
  if (!workflow) return null
  const name = await askForText({
    title: 'Save as template',
    message:
      'New workflows can start from it: the same workers and options, on their own input files.',
    field: { label: 'template name', value: workflow.name },
    confirmLabel: 'Save template',
  })
  if (!name) return null
  const state = activityFor(workflow.id)
  state.error = null
  try {
    addTemplate(await api.workflows.createTemplate(workflow.id, name))
    return name
  } catch (err: unknown) {
    state.error = `Could not save the template: ${errorMessage(err, 'request failed')}`
    return null
  }
}

// --- discard ---

/**
 * Discards a draft, after asking: deletes its folder, which takes the
 * workflow with it. Resolves with whether it is gone; why not is in
 * `workflowActivity().error`.
 */
export async function discardWorkflow(folderId: number): Promise<boolean> {
  const workflow = editable(folderId)
  if (!workflow) return false
  const confirmed = await confirmAction({
    title: `Discard “${workflow.name}”?`,
    message: 'The draft and its folder are deleted. This cannot be undone.',
    confirmLabel: 'Discard',
    danger: true,
  })
  if (!confirmed) return false

  // A save landing after the delete would only fail.
  const id = workflow.id
  clearTimeout(saveTimers.get(id))
  saveTimers.delete(id)
  unsaved.delete(id)
  await saves.get(id)

  const folders = useFolderActions()
  const state = activityFor(id)
  state.error = null
  const folder = useItemsStore().findFolder(folderId)
  if (!folder || !(await folders.deleteItems([folder])).length) {
    state.error = folders.error.value ?? 'Could not discard the workflow.'
    folders.clearError()
    return false
  }
  useWorkflowsStore().forgetWorkflow(folderId)
  forget([workflowKeys.workflow(id)])
  activity.delete(id)
  return true
}

const followed = new Set<number>()

/**
 * Keeps a started workflow current while it runs, wherever the user is: a
 * quick run starts one from the folder above it, whose row shows its state.
 * Stops when it is done, on an error, or on sign-out (the store is cleared).
 */
export function followWorkflow(folderId: number): void {
  const workflowsStore = useWorkflowsStore()
  const workflow = workflowsStore.workflowOf(folderId)
  if (!workflow || followed.has(workflow.id)) return
  const id = workflow.id
  followed.add(id)
  const tick = () => {
    const current = workflowsStore.workflowOf(folderId)
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
