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
