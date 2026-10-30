import { reactive } from 'vue'

export type TooltipPlacement = 'top' | 'bottom' | 'left' | 'right'

export interface TooltipOptions {
  text: string
  placement?: TooltipPlacement
}

export type TooltipInput = string | TooltipOptions

interface TooltipState {
  visible: boolean
  text: string
  x: number
  y: number
  placement: TooltipPlacement
}

const state = reactive<TooltipState>({
  visible: false,
  text: '',
  x: 0,
  y: 0,
  placement: 'top',
})

let showTimer: ReturnType<typeof setTimeout> | null = null
let flashTimer: ReturnType<typeof setTimeout> | null = null
let cooldownTimer: ReturnType<typeof setTimeout> | null = null
let isWarm = false
let currentTarget: HTMLElement | null = null

export function parseTooltip(input: TooltipInput): TooltipOptions {
  return typeof input === 'string' ? { text: input } : input
}

export function showTooltip(target: HTMLElement, input: TooltipInput) {
  if (currentTarget === target && state.visible) return
  currentTarget = target

  if (cooldownTimer) {
    clearTimeout(cooldownTimer)
    cooldownTimer = null
  }
  if (showTimer) {
    clearTimeout(showTimer)
    showTimer = null
  }

  // 0ms delay if another tooltip was open recently; otherwise 250ms
  const delay = isWarm ? 0 : 250

  showTimer = setTimeout(() => {
    if (currentTarget !== target) return

    const { text, placement: explicitPlacement } = parseTooltip(input)
    if (!text) return

    const rect = target.getBoundingClientRect()
    // Auto-placement: flip to bottom if near the top edge
    const placement = explicitPlacement ?? (rect.top < 120 ? 'bottom' : 'top')

    let x = rect.left + rect.width / 2
    let y = placement === 'bottom' ? rect.bottom + 6 : rect.top - 6

    if (placement === 'left') {
      x = rect.left - 6
      y = rect.top + rect.height / 2
    } else if (placement === 'right') {
      x = rect.right + 6
      y = rect.top + rect.height / 2
    }

    // Viewport edge clamping
    const clampedX = Math.max(16, Math.min(window.innerWidth - 16, x))

    state.text = text
    state.x = clampedX
    state.y = y
    state.placement = placement
    state.visible = true
    isWarm = true
  }, delay)
}

/**
 * Updates the text of the tooltip showing for `target`, if any: a label that
 * changes under the pointer (a status that moves on, a button whose item
 * changed) must not keep saying the old thing.
 */
export function updateTooltip(target: HTMLElement, input: TooltipInput) {
  if (currentTarget !== target || !state.visible) return
  const { text } = parseTooltip(input)
  if (!text) return
  state.text = text
}

/**
 * Instantly displays an unprompted feedback tooltip (e.g. "Copied!")
 * without warm-up delay, and automatically dismisses after `duration` ms.
 */
export function flashTooltip(target: HTMLElement, text: string, duration = 1500) {
  if (showTimer) {
    clearTimeout(showTimer)
    showTimer = null
  }
  if (flashTimer) {
    clearTimeout(flashTimer)
    flashTimer = null
  }

  currentTarget = target
  const rect = target.getBoundingClientRect()
  const placement: TooltipPlacement = rect.top < 120 ? 'bottom' : 'top'

  const x = rect.left + rect.width / 2
  const y = placement === 'bottom' ? rect.bottom + 6 : rect.top - 6
  const clampedX = Math.max(16, Math.min(window.innerWidth - 16, x))

  state.text = text
  state.x = clampedX
  state.y = y
  state.placement = placement
  state.visible = true
  isWarm = true

  flashTimer = setTimeout(() => {
    hideTooltip(target)
    flashTimer = null
  }, duration)
}

export function hideTooltip(target?: HTMLElement) {
  if (target && currentTarget !== target) return

  if (showTimer) {
    clearTimeout(showTimer)
    showTimer = null
  }
  if (flashTimer) {
    clearTimeout(flashTimer)
    flashTimer = null
  }

  currentTarget = null
  state.visible = false

  if (cooldownTimer) clearTimeout(cooldownTimer)
  cooldownTimer = setTimeout(() => {
    isWarm = false
  }, 500)
}

// Global dismiss listeners
if (typeof window !== 'undefined') {
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && state.visible) hideTooltip()
  })
  window.addEventListener(
    'scroll',
    () => {
      if (state.visible) hideTooltip()
    },
    true,
  )
}

export function useTooltip() {
  return {
    state,
    showTooltip,
    hideTooltip,
    flashTooltip,
  }
}
