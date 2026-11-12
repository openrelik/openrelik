import type { Directive } from 'vue'
import {
  HIDE_GRACE,
  hideTooltip,
  isKeyboardFocus,
  isTouch,
  showTooltip,
  updateTooltip,
  type TooltipInput,
} from '@/composables/useTooltip'

/** Slower than a control's label: a name is read, not hunted for. */
const OVERFLOW_DELAY = 500

interface OverflowTooltipElement extends HTMLElement {
  _overflowTooltipValue?: TooltipInput
  _overflowTooltipListeners?: {
    onPointerEnter: (event: PointerEvent) => void
    onPointerLeave: () => void
    onFocusIn: (event: FocusEvent) => void
    onFocusOut: () => void
  }
}

function isTruncated(el: HTMLElement): boolean {
  return el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1
}

/**
 * v-overflow-tooltip directive:
 * Only shows a tooltip if the element's text content is genuinely overflowing / truncated.
 * Prevents unnecessary visual noise on short strings while making clipped labels accessible.
 * Keyboard focus on (or inside) the element reveals it too, at once.
 *
 * Usage:
 *   <span class="truncate" v-overflow-tooltip>{{ row.name }}</span>
 *   <span class="truncate" v-overflow-tooltip="customText">{{ row.name }}</span>
 */
export const vOverflowTooltip: Directive<OverflowTooltipElement, TooltipInput | undefined> = {
  mounted(el, binding) {
    el._overflowTooltipValue = binding.value

    const reveal = (delay: number) => {
      if (!isTruncated(el)) return

      const text = el._overflowTooltipValue ?? (el.textContent || el.innerText || '').trim()

      if (text) {
        showTooltip(el, text, delay)
      }
    }

    const onPointerEnter = (event: PointerEvent) => {
      if (!isTouch(event)) reveal(OVERFLOW_DELAY)
    }

    const onPointerLeave = () => {
      hideTooltip(el, HIDE_GRACE)
    }

    const onFocusIn = (event: FocusEvent) => {
      if (isKeyboardFocus(event)) reveal(0)
    }

    const onFocusOut = () => {
      hideTooltip(el)
    }

    el.addEventListener('pointerenter', onPointerEnter)
    el.addEventListener('pointerleave', onPointerLeave)
    el.addEventListener('focusin', onFocusIn)
    el.addEventListener('focusout', onFocusOut)

    el._overflowTooltipListeners = {
      onPointerEnter,
      onPointerLeave,
      onFocusIn,
      onFocusOut,
    }
  },

  updated(el, binding) {
    el._overflowTooltipValue = binding.value
    if (!isTruncated(el)) {
      hideTooltip(el)
      return
    }
    const text = binding.value ?? (el.textContent || el.innerText || '').trim()
    if (!text) hideTooltip(el)
    else updateTooltip(el, text)
  },

  unmounted(el) {
    hideTooltip(el)
    if (el._overflowTooltipListeners) {
      el.removeEventListener('pointerenter', el._overflowTooltipListeners.onPointerEnter)
      el.removeEventListener('pointerleave', el._overflowTooltipListeners.onPointerLeave)
      el.removeEventListener('focusin', el._overflowTooltipListeners.onFocusIn)
      el.removeEventListener('focusout', el._overflowTooltipListeners.onFocusOut)
      delete el._overflowTooltipListeners
    }
    delete el._overflowTooltipValue
  },
}
