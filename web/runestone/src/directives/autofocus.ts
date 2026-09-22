import { nextTick, type Directive } from 'vue'

/**
 * v-autofocus directive:
 * Automatically focuses an element when mounted or when its binding value transitions to true.
 *
 * Modifiers:
 *   .select - Selects the text within the input/textarea upon focus.
 *
 * Usage:
 *   <input v-autofocus />
 *   <input v-autofocus.select />
 *   <input v-autofocus="isOpen" />
 */
export const vAutofocus: Directive<HTMLElement, boolean | undefined> = {
  mounted(el, binding) {
    if (binding.value === false) return

    nextTick(() => {
      const target =
        el instanceof HTMLInputElement ||
        el instanceof HTMLTextAreaElement ||
        el instanceof HTMLButtonElement ||
        el.hasAttribute('tabindex')
          ? el
          : (el.querySelector<HTMLElement>('input, textarea, button, [tabindex]') ?? el)

      target.focus()

      if (binding.modifiers.select && 'select' in target && typeof target.select === 'function') {
        target.select()
      }
    })
  },

  updated(el, binding) {
    if (binding.value && !binding.oldValue) {
      nextTick(() => {
        const target =
          el instanceof HTMLInputElement ||
          el instanceof HTMLTextAreaElement ||
          el instanceof HTMLButtonElement ||
          el.hasAttribute('tabindex')
            ? el
            : (el.querySelector<HTMLElement>('input, textarea, button, [tabindex]') ?? el)

        target.focus()

        if (binding.modifiers.select && 'select' in target && typeof target.select === 'function') {
          target.select()
        }
      })
    }
  },
}
