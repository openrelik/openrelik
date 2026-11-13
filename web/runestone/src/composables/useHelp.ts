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

import { type WritableComputedRef, computed } from 'vue'
import { useModalStore } from '@/stores/modals'

export interface UseHelpReturn {
  helpOpen: WritableComputedRef<boolean>
  open: () => void
  close: () => void
}

export function useHelp(): UseHelpReturn {
  const modalStore = useModalStore()
  return {
    helpOpen: computed({
      get: () => modalStore.isModalOpen('help'),
      set: (val: boolean) => (val ? modalStore.openModal('help') : modalStore.closeModal('help')),
    }),
    open: () => modalStore.openModal('help'),
    close: () => modalStore.closeModal('help'),
  }
}

/** Reactive boolean for whether the keyboard help dialog is open. */
export const helpOpen = computed({
  get: () => useModalStore().isModalOpen('help'),
  set: (val: boolean) =>
    val ? useModalStore().openModal('help') : useModalStore().closeModal('help'),
})
