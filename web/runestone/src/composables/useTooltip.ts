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

import { reactive } from 'vue'
import type { Placement } from '@/utils/placement'

export type TooltipPlacement = Placement

export interface TooltipOptions {
  text: string
  /** A second, quieter line: what clicking does, or what the label leaves out. */
  detail?: string
  placement?: TooltipPlacement
}

export type TooltipInput = string | TooltipOptions

/** The presenter's id, for the anchor's `aria-describedby`. */
export const TOOLTIP_ID = 'app-tooltip'

/** Cold hover: long enough that sweeping across a toolbar shows nothing. */
const COLD_DELAY = 400
/** After a tooltip hides, the next one shows at once for this long. */
const WARM_WINDOW = 400
/** Leaving the anchor waits this long, so the pointer can cross onto the tooltip. */
export const HIDE_GRACE = 100

interface TooltipState {
  visible: boolean
  text: string
  detail: string
  /** The anchor's screen rectangle, read when the tooltip was shown. */
  anchor: DOMRect | null
  preferred: TooltipPlacement
  placement: TooltipPlacement
  left: number
  top: number
  /** False until the presenter has measured the box and placed it. */
  measured: boolean
  /** Bumped on every show and text change: the presenter re-measures on it. */
  revision: number
}

const state = reactive<TooltipState>({
  visible: false,
  text: '',
  detail: '',
  anchor: null,
  preferred: 'top',
  placement: 'top',
  left: 0,
  top: 0,
  measured: false,
  revision: 0,
})

let showTimer: ReturnType<typeof setTimeout> | null = null
let hideTimer: ReturnType<typeof setTimeout> | null = null
let flashTimer: ReturnType<typeof setTimeout> | null = null
let cooldownTimer: ReturnType<typeof setTimeout> | null = null
let isWarm = false
let currentTarget: HTMLElement | null = null
/** The anchor carrying our `aria-describedby`, and what it held before. */
let described: { el: HTMLElement; previous: string | null } | null = null

function clear(timer: ReturnType<typeof setTimeout> | null): null {
  if (timer) clearTimeout(timer)
  return null
}

export function parseTooltip(input: TooltipInput): TooltipOptions {
  return typeof input === 'string' ? { text: input } : input
}

function describe(target: HTMLElement, { text, detail }: TooltipOptions) {
  undescribe()
  // Focus inside the anchor (an input in a labelled row) is what a screen
  // reader is on, so that is what the tooltip describes.
  const focused = document.activeElement
  const el = focused instanceof HTMLElement && target.contains(focused) ? focused : target
  // A label that already says it all would be read twice.
  if (!detail && el.getAttribute('aria-label') === text) return
  described = { el, previous: el.getAttribute('aria-describedby') }
  el.setAttribute(
    'aria-describedby',
    described.previous ? `${described.previous} ${TOOLTIP_ID}` : TOOLTIP_ID,
  )
}

function undescribe() {
  if (!described) return
  const { el, previous } = described
  if (previous) el.setAttribute('aria-describedby', previous)
  else el.removeAttribute('aria-describedby')
  described = null
}

/** Shows `options` beside `target` now; the presenter measures and places it. */
function present(target: HTMLElement, options: TooltipOptions) {
  currentTarget = target
  hideTimer = clear(hideTimer)
  cooldownTimer = clear(cooldownTimer)
  state.text = options.text
  state.detail = options.detail ?? ''
  state.anchor = target.getBoundingClientRect()
  state.preferred = options.placement ?? 'top'
  state.measured = false
  state.revision++
  state.visible = true
  isWarm = true
}

/**
 * Shows `input` beside `target` after `delay` ms, or at once while warm (a
 * tooltip was open moments ago). Keyboard focus passes 0: focus is intent.
 */
export function showTooltip(target: HTMLElement, input: TooltipInput, delay = COLD_DELAY) {
  const options = parseTooltip(input)
  if (!options.text) {
    if (currentTarget === target) hideTooltip(target)
    return
  }
  if (currentTarget === target && state.visible) {
    hideTimer = clear(hideTimer)
    return
  }
  currentTarget = target
  showTimer = clear(showTimer)
  hideTimer = clear(hideTimer)
  cooldownTimer = clear(cooldownTimer)

  showTimer = setTimeout(
    () => {
      showTimer = null
      if (currentTarget !== target || !target.isConnected) return
      present(target, options)
      describe(target, options)
    },
    isWarm ? 0 : delay,
  )
}

/**
 * Updates the text of the tooltip showing for `target`, if any: a label that
 * changes under the pointer (a status that moves on, a button whose item
 * changed) must not keep saying the old thing.
 */
export function updateTooltip(target: HTMLElement, input: TooltipInput) {
  if (currentTarget !== target || !state.visible) return
  const { text, detail, placement } = parseTooltip(input)
  if (!text) return
  state.text = text
  state.detail = detail ?? ''
  state.preferred = placement ?? 'top'
  state.anchor = target.getBoundingClientRect()
  state.revision++
}

/**
 * Instantly displays an unprompted feedback tooltip (e.g. "Copied!")
 * without warm-up delay, and automatically dismisses after `duration` ms.
 */
export function flashTooltip(target: HTMLElement, text: string, duration = 1500) {
  showTimer = clear(showTimer)
  flashTimer = clear(flashTimer)
  undescribe()
  present(target, { text })
  flashTimer = setTimeout(() => {
    flashTimer = null
    hideTooltip(target)
  }, duration)
}

/**
 * Hides the tooltip (only `target`'s, when given). A `grace` delay lets the
 * pointer move from the anchor onto the tooltip, which then holds it open.
 */
export function hideTooltip(target?: HTMLElement, grace = 0) {
  if (target && currentTarget !== target) return

  showTimer = clear(showTimer)
  hideTimer = clear(hideTimer)
  if (grace > 0 && state.visible) {
    hideTimer = setTimeout(() => {
      hideTimer = null
      hideTooltip(target)
    }, grace)
    return
  }
  flashTimer = clear(flashTimer)

  currentTarget = null
  state.visible = false
  undescribe()

  cooldownTimer = clear(cooldownTimer)
  cooldownTimer = setTimeout(() => {
    isWarm = false
  }, WARM_WINDOW)
}

/** The pointer reached the tooltip itself: keep it open (WCAG 1.4.13, hoverable). */
export function holdTooltip() {
  hideTimer = clear(hideTimer)
}

/** Whether a pointer event came from touch, where a tap is not a hover. */
export function isTouch(event: Event): boolean {
  return event instanceof PointerEvent && event.pointerType === 'touch'
}

/** Whether a focus event's target got there by keyboard, not by a click. */
export function isKeyboardFocus(event: FocusEvent): boolean {
  return event.target instanceof Element && event.target.matches(':focus-visible')
}

// Global dismiss listeners
if (typeof window !== 'undefined') {
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && state.visible) hideTooltip()
  })
  // Only a scroll that moves the anchor: a log tailing in another pane must
  // not take the tooltip away from the one being read.
  window.addEventListener(
    'scroll',
    (e) => {
      if (!state.visible || !currentTarget) return
      if (e.target instanceof Node && e.target.contains(currentTarget)) hideTooltip()
    },
    true,
  )
  window.addEventListener('resize', () => {
    if (state.visible) hideTooltip()
  })
}

export function useTooltip() {
  return {
    state,
    showTooltip,
    hideTooltip,
    holdTooltip,
    flashTooltip,
  }
}
