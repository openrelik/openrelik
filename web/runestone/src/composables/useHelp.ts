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
