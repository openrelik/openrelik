import { computed, ref } from 'vue'
import type { Item } from '@/types/item'
import { useModalStore } from '@/stores/modals'

export interface WorkflowTarget {
  files: Item[]
  folderId: number
}

const target = ref<WorkflowTarget | null>(null)

export function useWorkflowDialog() {
  const modalStore = useModalStore()

  const workflowTarget = computed({
    get: () => (modalStore.isModalOpen('workflow') ? target.value : null),
    set: (val: WorkflowTarget | null) => {
      target.value = val
      if (val) {
        modalStore.openModal('workflow')
      } else {
        modalStore.closeModal('workflow')
      }
    },
  })

  function open(files: Item[], folderId: number) {
    if (!files.length) return
    target.value = { files, folderId }
    modalStore.openModal('workflow')
  }

  function close() {
    target.value = null
    modalStore.closeModal('workflow')
  }

  return {
    workflowTarget,
    open,
    close,
  }
}

export function openWorkflowDialog(files: Item[], folderId: number) {
  useWorkflowDialog().open(files, folderId)
}

export function closeWorkflowDialog() {
  useWorkflowDialog().close()
}
