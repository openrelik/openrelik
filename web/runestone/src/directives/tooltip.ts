import type { Directive } from 'vue'
import {
  hideTooltip,
  showTooltip,
  updateTooltip,
  type TooltipInput,
} from '@/composables/useTooltip'

interface TooltipElement extends HTMLElement {
  _tooltipValue?: TooltipInput
  _tooltipListeners?: {
    onPointerEnter: () => void
    onPointerLeave: () => void
    onFocusIn: () => void
    onFocusOut: () => void
    onClick: () => void
  }
}

/**
 * v-tooltip directive: attaches hover and keyboard focus listeners to any control.
 * Dismisses on click and blur, and feeds the singleton Tooltip presenter.
 */
export const vTooltip: Directive<TooltipElement, TooltipInput | undefined> = {
  mounted(el, binding) {
    el._tooltipValue = binding.value

    const onPointerEnter = () => {
      if (el._tooltipValue) showTooltip(el, el._tooltipValue)
    }
    const onPointerLeave = () => {
      hideTooltip(el)
    }
    const onFocusIn = () => {
      if (el._tooltipValue) showTooltip(el, el._tooltipValue)
    }
    const onFocusOut = () => {
      hideTooltip(el)
    }
    const onClick = () => {
      hideTooltip(el)
    }

    el.addEventListener('pointerenter', onPointerEnter)
    el.addEventListener('pointerleave', onPointerLeave)
    el.addEventListener('focusin', onFocusIn)
    el.addEventListener('focusout', onFocusOut)
    el.addEventListener('click', onClick)

    el._tooltipListeners = {
      onPointerEnter,
      onPointerLeave,
      onFocusIn,
      onFocusOut,
      onClick,
    }
  },

  updated(el, binding) {
    el._tooltipValue = binding.value
    if (!binding.value) {
      hideTooltip(el)
    } else if (binding.value !== binding.oldValue) {
      updateTooltip(el, binding.value)
    }
  },

  unmounted(el) {
    hideTooltip(el)
    if (el._tooltipListeners) {
      el.removeEventListener('pointerenter', el._tooltipListeners.onPointerEnter)
      el.removeEventListener('pointerleave', el._tooltipListeners.onPointerLeave)
      el.removeEventListener('focusin', el._tooltipListeners.onFocusIn)
      el.removeEventListener('focusout', el._tooltipListeners.onFocusOut)
      el.removeEventListener('click', el._tooltipListeners.onClick)
      delete el._tooltipListeners
    }
    delete el._tooltipValue
  },
}
