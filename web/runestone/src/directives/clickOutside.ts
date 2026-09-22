import type { Directive } from 'vue'

interface ClickOutsideElement extends HTMLElement {
  _clickOutsideHandler?: (event: PointerEvent) => void
}

/**
 * v-click-outside directive:
 * Fires a callback when a pointerdown event occurs outside the element and its children.
 *
 * Usage:
 *   <div v-click-outside="() => open = false">
 */
export const vClickOutside: Directive<ClickOutsideElement, (event: PointerEvent) => void> = {
  mounted(el, binding) {
    const handler = (event: PointerEvent) => {
      const target = event.target as Node | null
      if (!target) return
      // Ignore clicks on or inside the element itself
      if (el === target || el.contains(target)) return

      if (typeof binding.value === 'function') {
        binding.value(event)
      }
    }

    el._clickOutsideHandler = handler
    // Capture phase ensures detection even if other elements stop propagation
    document.addEventListener('pointerdown', handler, true)
  },

  unmounted(el) {
    if (el._clickOutsideHandler) {
      document.removeEventListener('pointerdown', el._clickOutsideHandler, true)
      delete el._clickOutsideHandler
    }
  },
}
