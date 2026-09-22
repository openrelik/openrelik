import type { Directive } from 'vue'
import { hideTooltip, showTooltip, type TooltipInput } from '@/composables/useTooltip'

interface OverflowTooltipElement extends HTMLElement {
  _overflowTooltipValue?: TooltipInput
  _overflowTooltipListeners?: {
    onPointerEnter: () => void
    onPointerLeave: () => void
  }
}

function isTruncated(el: HTMLElement): boolean {
  return el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1
}

/**
 * v-overflow-tooltip directive:
 * Only shows a tooltip if the element's text content is genuinely overflowing / truncated.
 * Prevents unnecessary visual noise on short strings while making clipped labels accessible.
 *
 * Usage:
 *   <span class="truncate" v-overflow-tooltip>{{ row.name }}</span>
 *   <span class="truncate" v-overflow-tooltip="customText">{{ row.name }}</span>
 */
export const vOverflowTooltip: Directive<OverflowTooltipElement, TooltipInput | undefined> = {
  mounted(el, binding) {
    el._overflowTooltipValue = binding.value

    const onPointerEnter = () => {
      if (!isTruncated(el)) return

      const text = el._overflowTooltipValue ?? (el.textContent || el.innerText || '').trim()

      if (text) {
        showTooltip(el, text)
      }
    }

    const onPointerLeave = () => {
      hideTooltip(el)
    }

    el.addEventListener('pointerenter', onPointerEnter)
    el.addEventListener('pointerleave', onPointerLeave)

    el._overflowTooltipListeners = {
      onPointerEnter,
      onPointerLeave,
    }
  },

  updated(el, binding) {
    el._overflowTooltipValue = binding.value
  },

  unmounted(el) {
    if (el._overflowTooltipListeners) {
      el.removeEventListener('pointerenter', el._overflowTooltipListeners.onPointerEnter)
      el.removeEventListener('pointerleave', el._overflowTooltipListeners.onPointerLeave)
      delete el._overflowTooltipListeners
    }
    delete el._overflowTooltipValue
  },
}
