/**
 * Upload Panel Composable
 *
 * Whether the upload queue is on screen. The panel opens by itself when files
 * start going up — that is when it is worth seeing — and the operator can
 * minimize it without stopping anything. Minimizing is remembered until the
 * queue empties, so it does not pop back up for every file of one drop.
 */

import { computed, watch, type ComputedRef } from 'vue'
import { useUploadQueue } from '@/composables/useUploadQueue'
import { useModalStore } from '@/stores/modals'

/** The operator minimized this batch: do not open again until it is over. */
let minimized = false
/** The panel opened by itself, so it may close by itself when the queue empties. */
let opened = false
let watching = false

export interface UseUploadPanelReturn {
  isOpen: ComputedRef<boolean>
  open: () => void
  /** Hides the panel; uploads carry on. */
  minimize: () => void
  toggle: () => void
}

export function useUploadPanel(): UseUploadPanelReturn {
  const modalStore = useModalStore()
  const uploads = useUploadQueue()
  const isOpen = computed(() => modalStore.isModalOpen('uploads'))

  if (!watching) {
    watching = true
    watch(
      () => uploads.activeCount.value,
      (count, before) => {
        if (count > 0 && !before && !minimized) {
          modalStore.openModal('uploads')
          opened = true
          return
        }
        if (count === 0) {
          minimized = false
          // Only tidies away what it put there itself.
          if (opened) modalStore.closeModal('uploads')
          opened = false
        }
      },
    )
  }

  function open() {
    minimized = false
    modalStore.openModal('uploads')
  }

  function minimize() {
    minimized = true
    opened = false
    modalStore.closeModal('uploads')
  }

  return {
    isOpen,
    open,
    minimize,
    toggle: () => (isOpen.value ? minimize() : open()),
  }
}
