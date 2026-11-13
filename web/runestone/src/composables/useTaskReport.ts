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

import { computed, shallowRef, type ComputedRef } from 'vue'

import { useModalStore } from '@/stores/modals'
import type { Task } from '@/types/workflow'

/**
 * The report sheet: one task's findings, for the whole task and per file. A
 * module singleton, like the share dialog: the task panel opens it, `App.vue`
 * shows it, and the modal stack gives it Esc and keeps the page's keys away.
 */
const shown = shallowRef<{ task: Task; folderId: number } | null>(null)

/** Opens the report of `task`, whose outputs are in the workflow folder `folderId`. */
export function openTaskReport(task: Task, folderId: number): void {
  shown.value = { task, folderId }
  useModalStore().openModal('report')
}

/** Clears the currently displayed task report (sign-out). */
export function clearTaskReport(): void {
  shown.value = null
  useModalStore().closeModal('report')
}

export function useTaskReport(): {
  report: ComputedRef<{ task: Task; folderId: number } | null>
  close: () => void
} {
  const modalStore = useModalStore()
  return {
    // Closed by the stack too (Esc): the sheet follows the stack, not only `shown`.
    report: computed(() => (modalStore.isModalOpen('report') ? shown.value : null)),
    close: clearTaskReport,
  }
}
