import { computed } from 'vue'
import type { Item } from '@/data/folders'
import type { Worker } from '@/data/workers'
import { useModalStore } from '@/stores/modals'
import { useRunStore, type RunTarget } from '@/stores/run'

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

export function openRun(files: Item[], folderId: number) {
  useRunStore().open(files, folderId)
  if (files.length) {
    useModalStore().openModal('run')
  }
}

export function closeRun() {
  useRunStore().close()
  useModalStore().closeModal('run')
}

export const lastRun = computed(() => useRunStore().lastRun)

export function startRun(
  worker: Worker,
  target: RunTarget,
  config: Record<string, string>,
): number {
  return useRunStore().start(worker, target, config)
}

export function undoRun(folderId: number) {
  useRunStore().undo(folderId)
}
