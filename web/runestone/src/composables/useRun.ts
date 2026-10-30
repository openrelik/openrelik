import { computed } from 'vue'
import type { Item } from '@/types/item'
import type { Worker } from '@/types/worker'
import type { AddAt } from '@/composables/useWorkflow'
import { canChainAfter, canJoin, canJoinAll, everyGroup, findTask } from '@/utils/workflow'
import type { Workflow } from '@/types/workflow'
import { useModalStore } from '@/stores/modals'
import { useRunStore, type Anchor, type RunTarget } from '@/stores/run'
import { count } from '@/utils/format'

export type { Anchor, RunTarget }

/** The box of the control an event came from, to anchor a popover to it. */
export function anchorOf(event: Event): Anchor | undefined {
  const target = event.currentTarget
  if (!(target instanceof Element)) return undefined
  const { top, bottom, left, right } = target.getBoundingClientRect()
  return { top, bottom, left, right }
}

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
 * Opens the picker to add a worker to a draft, at `at` (see `AddAt`): beside
 * the + it came from when there is one (`anchor`), else as a dialog. Does
 * nothing where no worker may go (`canJoin`, `canJoinAll`, `canChainAfter`).
 */
export function openAddToWorkflow(workflow: Workflow, at: AddAt, anchor?: Anchor) {
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
  } else if ('join' in at) {
    const group = everyGroup(workflow).find(({ group }) => group.id === at.join)?.group
    if (!group || !canJoin(group)) return
    label = count(group.tasks.length, 'task')
  } else {
    const owner = at.joinAll === null ? workflow : findTask(workflow, at.joinAll)
    if (!owner || !canJoinAll(owner.groups)) return
    label = count(owner.groups.flatMap((group) => group.tasks).length, 'task')
  }
  useRunStore().open({ label, files: [], folderId: workflow.folderId, add: at, anchor })
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
