import { computed } from 'vue'
import type { Item } from '@/data/folders'
import type { Worker } from '@/data/workers'
import type { AddAt } from '@/composables/useWorkflow'
import { canChainAfter, canJoin, everyGroup, findTask, type Workflow } from '@/data/workflows'
import { useModalStore } from '@/stores/modals'
import { useRunStore, type RunTarget } from '@/stores/run'
import { count } from '@/utils/format'

export type { RunTarget }

export const runTarget = computed({
  get: () => useRunStore().runTarget,
  set: (val: RunTarget | null) => {
    useRunStore().runTarget = val
    if (val) {
      useModalStore().openModal('run')
    } else {
      useModalStore().closeModal('run')
    }
  },
})

const labelOf = (files: Item[]) =>
  files.length === 1 ? files[0]!.name : count(files.length, 'file')

/** Opens the picker to run one worker on `files`, as a workflow of its own. */
export function openRun(files: Item[], folderId: number) {
  if (!files.length) return
  useRunStore().open({ label: labelOf(files), files, folderId })
  useModalStore().openModal('run')
}

/**
 * Opens the picker to add a worker to a draft, at `at` (see `AddAt`). Does
 * nothing where no worker may go (`canJoin`, `canChainAfter`).
 */
export function openAddToWorkflow(workflow: Workflow, at: AddAt) {
  const { inputs } = workflow
  let label: string
  if ('after' in at) {
    const parent = at.after === null ? null : findTask(workflow, at.after)
    if (parent === undefined || (parent && !canChainAfter(workflow, parent.id))) return
    label = parent
      ? parent.name
      : inputs.length === 1
        ? inputs[0]!.name
        : count(inputs.length, 'input file')
  } else if ('beside' in at) {
    const task = findTask(workflow, at.beside)
    if (!task) return
    label = task.name
  } else {
    const group = everyGroup(workflow).find(({ group }) => group.id === at.join)?.group
    if (!group || !canJoin(group)) return
    label = count(group.tasks.length, 'task')
  }
  useRunStore().open({ label, files: [], folderId: workflow.folderId, add: at })
  useModalStore().openModal('run')
}

export function closeRun() {
  useRunStore().close()
  useModalStore().closeModal('run')
}

export const lastRun = computed(() => useRunStore().lastRun)
export const runError = computed(() => useRunStore().error)

export function startRun(
  worker: Worker,
  target: RunTarget,
  config: Record<string, string>,
): Promise<number | null> {
  return useRunStore().start(worker, target, config)
}
