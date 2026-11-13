/**
 * The link menu: one for the whole app (`LinkMenu.vue`, in `App.vue`), opened
 * under whichever link or image in rendered Markdown was clicked. Links carry
 * no `href`: nothing is followed but through this menu, by choice.
 */

import { computed, shallowRef, type ComputedRef } from 'vue'

export interface LinkMenuState {
  url: string
  /** An image is only ever copied, never opened: opening it is loading it. */
  kind: 'link' | 'image'
  /** The link it hangs under; focus goes back to it when the menu closes. */
  anchor: HTMLElement
}

const state = shallowRef<LinkMenuState | null>(null)

/** Opens the menu under `anchor`; the same link again closes it. */
export function openLinkMenu(anchor: HTMLElement, url: string, kind: LinkMenuState['kind']): void {
  state.value = state.value?.anchor === anchor ? null : { url, kind, anchor }
}

/** Closes the menu; `refocus` puts focus back on its link (a key closed it). */
export function closeLinkMenu(refocus = false): void {
  const anchor = state.value?.anchor
  state.value = null
  if (refocus) anchor?.focus()
}

const current = computed(() => state.value)

export function useLinkMenu(): { state: ComputedRef<LinkMenuState | null> } {
  return { state: current }
}
