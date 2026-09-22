import type { Directive } from 'vue'

interface ClickOutsideElement extends HTMLElement {
  _clickOutsideHandler?: (event: PointerEvent) => void
}

/**
 * v-click-outside directive:
 * Fires a callback when a pointerdown event occurs outside the element and its children.
 *
 * An element marked `data-click-outside-ignore` is treated as inside: that is
 * how a toggle button keeps working. Without it, pressing the button that
 * opened a panel would close it here and reopen it on click, so it could never
 * be closed from its own control.
 *
 * Usage:
 *   <div v-click-outside="() => open = false">
 *   <button data-click-outside-ignore @click="open = !open">
 */
export const vClickOutside: Directive<ClickOutsideElement, (event: PointerEvent) => void> = {
  mounted(el, binding) {
    const handler = (event: PointerEvent) => {
      const target = event.target as Node | null
      if (!target) return
      // Ignore clicks on or inside the element itself
      if (el === target || el.contains(target)) return
      if (target instanceof Element && target.closest('[data-click-outside-ignore]')) return

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
