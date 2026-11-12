import type { Directive } from 'vue'
import { flashTooltip, hideTooltip, isKeyboardFocus, showTooltip } from '@/composables/useTooltip'

export type CopyValue = string | number | { text: string; hint?: string }

interface CopyElement extends HTMLElement {
  _copyValue?: CopyValue
  _copyListeners?: {
    onClick: (e: MouseEvent) => void
    onKeyDown: (e: KeyboardEvent) => void
    onPointerEnter: () => void
    onPointerLeave: () => void
    onFocusIn: (e: FocusEvent) => void
    onFocusOut: () => void
  }
  _copyFeedbackTimer?: ReturnType<typeof setTimeout> | null
  _tooltipListeners?: unknown
}

export async function copyToClipboard(text: string): Promise<boolean> {
  if (!text) return false
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch {
      // Fallback to legacy execCommand below
    }
  }

  try {
    const textarea = document.createElement('textarea')
    textarea.value = text
    textarea.style.position = 'fixed'
    textarea.style.left = '-9999px'
    textarea.style.top = '-9999px'
    textarea.style.opacity = '0'
    document.body.appendChild(textarea)
    textarea.select()
    const success = document.execCommand('copy')
    document.body.removeChild(textarea)
    return success
  } catch {
    return false
  }
}

function resolveCopyData(el: HTMLElement, value?: CopyValue): { text: string; hint: string } {
  if (typeof value === 'object' && value !== null) {
    return {
      text: String(value.text ?? ''),
      hint: value.hint ?? 'Click to copy',
    }
  }
  if (value !== undefined && value !== null) {
    return {
      text: String(value),
      hint: 'Click to copy',
    }
  }
  const text = (el.textContent || el.innerText || '').trim()
  return {
    text,
    hint: 'Click to copy',
  }
}

/**
 * v-copy-to-clipboard (v-copy) directive: One-click copy for hashes, paths, IDs, and metadata.
 *
 * Provides instant feedback via the singleton Tooltip presenter and applies
 * `data-copied="true"` to the element for temporary CSS state.
 */
export const vCopyToClipboard: Directive<CopyElement, CopyValue | undefined> = {
  mounted(el, binding) {
    el._copyValue = binding.value

    const isInteractive = ['BUTTON', 'A', 'INPUT', 'TEXTAREA'].includes(el.tagName)
    if (!isInteractive) {
      if (!el.hasAttribute('tabindex')) {
        el.setAttribute('tabindex', '0')
      }
      if (!el.hasAttribute('role')) {
        el.setAttribute('role', 'button')
      }
    }
    el.style.cursor = 'pointer'

    const triggerCopy = async (e: Event) => {
      e.stopPropagation()
      const { text } = resolveCopyData(el, el._copyValue)
      if (!text) return

      const ok = await copyToClipboard(text)
      if (!ok || !el._copyListeners) return

      if (!binding.modifiers.silent) {
        flashTooltip(el, 'Copied!')
      }
      el.setAttribute('data-copied', 'true')
      if (el._copyFeedbackTimer) clearTimeout(el._copyFeedbackTimer)
      el._copyFeedbackTimer = setTimeout(() => {
        el.removeAttribute('data-copied')
        el._copyFeedbackTimer = null
      }, 1500)
    }

    const onPointerEnter = () => {
      // If the element has an explicit v-tooltip attached, let v-tooltip manage hover
      if (el._tooltipListeners) return
      if (!el.hasAttribute('data-copied')) {
        const { hint } = resolveCopyData(el, el._copyValue)
        showTooltip(el, hint)
      }
    }

    const onPointerLeave = () => {
      if (el._tooltipListeners) return
      if (!el.hasAttribute('data-copied')) {
        hideTooltip(el)
      }
    }

    const onFocusIn = (e: FocusEvent) => {
      if (el._tooltipListeners) return
      if (!el.hasAttribute('data-copied') && isKeyboardFocus(e)) {
        const { hint } = resolveCopyData(el, el._copyValue)
        showTooltip(el, hint, 0)
      }
    }

    const onFocusOut = () => {
      if (el._tooltipListeners) return
      if (!el.hasAttribute('data-copied')) {
        hideTooltip(el)
      }
    }

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        triggerCopy(e)
      }
    }

    el.addEventListener('click', triggerCopy)
    el.addEventListener('keydown', onKeyDown)
    el.addEventListener('pointerenter', onPointerEnter)
    el.addEventListener('pointerleave', onPointerLeave)
    el.addEventListener('focusin', onFocusIn)
    el.addEventListener('focusout', onFocusOut)

    el._copyListeners = {
      onClick: triggerCopy,
      onKeyDown,
      onPointerEnter,
      onPointerLeave,
      onFocusIn,
      onFocusOut,
    }
  },

  updated(el, binding) {
    el._copyValue = binding.value
  },

  unmounted(el) {
    hideTooltip(el)
    if (el._copyFeedbackTimer) {
      clearTimeout(el._copyFeedbackTimer)
      el._copyFeedbackTimer = null
    }
    if (el._copyListeners) {
      el.removeEventListener('click', el._copyListeners.onClick)
      el.removeEventListener('keydown', el._copyListeners.onKeyDown)
      el.removeEventListener('pointerenter', el._copyListeners.onPointerEnter)
      el.removeEventListener('pointerleave', el._copyListeners.onPointerLeave)
      el.removeEventListener('focusin', el._copyListeners.onFocusIn)
      el.removeEventListener('focusout', el._copyListeners.onFocusOut)
      delete el._copyListeners
    }
    delete el._copyValue
  },
}
