import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

export type ModalType = 'help' | 'settings' | 'prompt' | 'run' | 'workflow' | 'share' | 'confirm'

export const useModalStore = defineStore('modals', () => {
  // Stack of active modal names (last element is topmost)
  const modalStack = ref<ModalType[]>([])

  const activeModal = computed(() => modalStack.value.at(-1) ?? null)
  const hasActiveModal = computed(() => modalStack.value.length > 0)

  function isModalOpen(name: ModalType): boolean {
    return modalStack.value.includes(name)
  }

  function openModal(name: ModalType) {
    if (!modalStack.value.includes(name)) {
      modalStack.value.push(name)
    }
  }

  function closeModal(name: ModalType) {
    const idx = modalStack.value.indexOf(name)
    if (idx >= 0) {
      modalStack.value.splice(idx, 1)
    }
  }

  function toggleModal(name: ModalType) {
    if (isModalOpen(name)) {
      closeModal(name)
    } else {
      openModal(name)
    }
  }

  function closeTopModal(): ModalType | null {
    return modalStack.value.pop() ?? null
  }

  function closeAllModals() {
    modalStack.value = []
  }

  // --- Prompt registration ---
  let focusPromptCallback: (() => void) | null = null

  function registerPrompt(focus: () => void): () => void {
    focusPromptCallback = focus
    return () => {
      if (focusPromptCallback === focus) {
        focusPromptCallback = null
      }
    }
  }

  function triggerPrompt() {
    if (focusPromptCallback) {
      focusPromptCallback()
    } else {
      openModal('prompt')
    }
  }

  return {
    modalStack,
    activeModal,
    hasActiveModal,
    isModalOpen,
    openModal,
    closeModal,
    toggleModal,
    closeTopModal,
    closeAllModals,
    registerPrompt,
    triggerPrompt,
  }
})
