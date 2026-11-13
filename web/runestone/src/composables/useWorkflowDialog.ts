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
