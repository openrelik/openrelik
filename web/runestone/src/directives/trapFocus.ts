import type { Directive } from 'vue'

const FOCUSABLE_SELECTOR =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]):not([disabled])'

interface TrapFocusElement extends HTMLElement {
  _trapFocusKeydown?: (e: KeyboardEvent) => void
  _previousActiveElement?: HTMLElement | null
}

/**
 * v-trap-focus directive:
 * Traps Tab key navigation within the attached container element.
 * Ensures accessibility compliance (WCAG) for modal dialogs.
 *
 * Usage:
 *   <div role="dialog" aria-modal="true" v-trap-focus>
 */
export const vTrapFocus: Directive<TrapFocusElement> = {
  mounted(el) {
    el._previousActiveElement =
      document.activeElement instanceof HTMLElement ? document.activeElement : null

    const handleKeydown = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return

      const focusable = Array.from(el.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
        (node) => node.offsetParent !== null || node === document.activeElement,
      )

      if (focusable.length === 0) {
        e.preventDefault()
        return
      }

      const first = focusable[0]!
      const last = focusable[focusable.length - 1]!

      if (e.shiftKey) {
        if (document.activeElement === first || !el.contains(document.activeElement)) {
          last.focus()
          e.preventDefault()
        }
      } else {
        if (document.activeElement === last || !el.contains(document.activeElement)) {
          first.focus()
          e.preventDefault()
        }
      }
    }

    el._trapFocusKeydown = handleKeydown
    el.addEventListener('keydown', handleKeydown)
  },

  unmounted(el) {
    if (el._trapFocusKeydown) {
      el.removeEventListener('keydown', el._trapFocusKeydown)
      delete el._trapFocusKeydown
    }

    // Restore focus to element that had it before dialog opened
    if (el._previousActiveElement && document.contains(el._previousActiveElement)) {
      el._previousActiveElement.focus()
      delete el._previousActiveElement
    }
  },
}
