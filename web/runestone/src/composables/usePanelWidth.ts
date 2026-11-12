/**
 * Panel Width Composable
 *
 * The width of a side panel the user can drag wider or narrower by its left
 * edge (see `PanelResizeHandle`): kept between a minimum and a share of the
 * window, so the content beside it always has room, and remembered per panel.
 */

import { computed, getCurrentScope, onScopeDispose, ref, type ComputedRef } from 'vue'

import { useRemembered } from '@/composables/useRemembered'

export interface PanelWidth {
  /** The width to draw, in px. */
  width: ComputedRef<number>
  start: (event: PointerEvent) => void
  move: (event: PointerEvent) => void
  end: () => void
  /** Adjust width by `delta` px (positive widens), clamped to bounds. */
  step: (delta: number) => void
  /** Back to the panel's default width. */
  reset: () => void
}

export function usePanelWidth(
  /** Where the width is remembered (localStorage key). */
  key: string,
  options: { initial: number; min: number; maxShare?: number },
): PanelWidth {
  const { initial, min, maxShare = 0.6 } = options
  const stored = useRemembered(key, initial)
  const viewportWidth = ref(typeof window === 'undefined' ? initial : window.innerWidth)
  const syncViewport = () => {
    viewportWidth.value = window.innerWidth
  }
  if (typeof window !== 'undefined') {
    window.addEventListener('resize', syncViewport, { passive: true })
    if (getCurrentScope()) {
      onScopeDispose(() => window.removeEventListener('resize', syncViewport))
    }
  }
  const clamp = (px: number) =>
    Math.round(Math.min(viewportWidth.value * maxShare, Math.max(min, px)))
  const width = computed(() => clamp(stored.value))

  let drag: { x: number; width: number } | null = null
  return {
    width,
    start(event) {
      ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
      syncViewport()
      drag = { x: event.clientX, width: width.value }
    },
    // The edge is on the panel's left: dragging left widens it.
    move(event) {
      if (drag) stored.value = clamp(drag.width + drag.x - event.clientX)
    },
    end() {
      drag = null
    },
    step(delta) {
      syncViewport()
      stored.value = clamp(width.value + delta)
    },
    reset() {
      stored.value = initial
    },
  }
}
