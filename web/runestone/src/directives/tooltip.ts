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

import type { Directive } from 'vue'
import {
  HIDE_GRACE,
  hideTooltip,
  isKeyboardFocus,
  isTouch,
  parseTooltip,
  showTooltip,
  updateTooltip,
  type TooltipInput,
} from '@/composables/useTooltip'

interface TooltipElement extends HTMLElement {
  _tooltipValue?: TooltipInput
  _tooltipListeners?: {
    onPointerEnter: (event: PointerEvent) => void
    onPointerLeave: () => void
    onFocusIn: (event: FocusEvent) => void
    onFocusOut: () => void
    onClick: () => void
  }
}

/** Whether two bindings say the same: an object literal is new on every render. */
function sameTooltip(a: TooltipInput, b: TooltipInput | null | undefined): boolean {
  if (!b) return false
  const x = parseTooltip(a)
  const y = parseTooltip(b)
  return x.text === y.text && x.detail === y.detail && x.placement === y.placement
}

/**
 * v-tooltip directive: attaches hover and keyboard focus listeners to any control.
 * Dismisses on click and blur, and feeds the singleton Tooltip presenter.
 * A touch tap and a mouse click's focus show nothing: neither asked for it.
 */
export const vTooltip: Directive<TooltipElement, TooltipInput | undefined> = {
  mounted(el, binding) {
    el._tooltipValue = binding.value

    const onPointerEnter = (event: PointerEvent) => {
      if (el._tooltipValue && !isTouch(event)) showTooltip(el, el._tooltipValue)
    }
    const onPointerLeave = () => {
      hideTooltip(el, HIDE_GRACE)
    }
    const onFocusIn = (event: FocusEvent) => {
      if (el._tooltipValue && isKeyboardFocus(event)) showTooltip(el, el._tooltipValue, 0)
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
    } else if (!sameTooltip(binding.value, binding.oldValue)) {
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
