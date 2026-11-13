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
