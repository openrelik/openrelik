import { onMounted, onUnmounted } from 'vue'
import { useModalStore } from '@/stores/modals'
import { isCommandModifier, isTyping } from '@/utils/keyboard'

/**
 * Coordinates application-level global keyboard shortcuts and modal escape handling.
 */
export function useKeyboardShortcuts(): void {
  const modalStore = useModalStore()

  function handleKeyDown(event: KeyboardEvent) {
    if (event.defaultPrevented) return
    const isCmd = isCommandModifier(event)

    // 1. If any modal is active, let Escape close the topmost modal
    if (modalStore.hasActiveModal) {
      if (event.key === 'Escape') {
        modalStore.closeTopModal()
        event.preventDefault()
        event.stopPropagation()
      }
      return
    }

    // 2. Cmd+, / Ctrl+,: Open settings from anywhere
    if (isCmd && event.key === ',') {
      modalStore.openModal('settings')
      event.preventDefault()
      event.stopPropagation()
      return
    }

    // 3. Cmd+K / Ctrl+K: Focus path prompt or open prompt
    if (isCmd && (event.key === 'k' || event.key === 'K')) {
      modalStore.triggerPrompt()
      event.preventDefault()
      event.stopPropagation()
      return
    }

    // 4. Typing check for single-key global shortcuts
    if (isTyping(event)) {
      return
    }

    // 5. '?' opens keyboard help
    if (event.key === '?' && !isCmd && !event.altKey) {
      modalStore.openModal('help')
      event.preventDefault()
      event.stopPropagation()
      return
    }

    // 6. 'g' focuses path prompt or opens prompt
    if (event.key === 'g' && !isCmd && !event.altKey) {
      modalStore.triggerPrompt()
      event.preventDefault()
      event.stopPropagation()
      return
    }
  }

  onMounted(() => {
    window.addEventListener('keydown', handleKeyDown)
  })

  onUnmounted(() => {
    window.removeEventListener('keydown', handleKeyDown)
  })
}
