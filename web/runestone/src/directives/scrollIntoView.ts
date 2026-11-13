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

import { nextTick, type Directive, type DirectiveBinding } from 'vue'
import { revealInContainer } from '@/utils/scroll'

export interface ScrollIntoViewOptions {
  active?: boolean
  block?: ScrollLogicalPosition
  inline?: ScrollLogicalPosition
  behavior?: ScrollBehavior
}

export type ScrollIntoViewInput = boolean | ScrollIntoViewOptions

function parseActive(val: unknown): boolean {
  if (typeof val === 'object' && val !== null) {
    return !!(val as ScrollIntoViewOptions).active
  }
  return !!val
}

function parseOptions(
  val: unknown,
  modifiers: Record<string, boolean | undefined>,
): { block: ScrollLogicalPosition; inline: ScrollLogicalPosition; behavior: ScrollBehavior } {
  const isObj = typeof val === 'object' && val !== null
  const opts = isObj ? (val as ScrollIntoViewOptions) : {}
  return {
    block: opts.block ?? (modifiers.center ? 'center' : 'nearest'),
    inline: opts.inline ?? 'nearest',
    behavior: opts.behavior ?? (modifiers.smooth ? 'smooth' : 'auto'),
  }
}

function scheduleScroll(el: HTMLElement, binding: DirectiveBinding<ScrollIntoViewInput>) {
  const options = parseOptions(binding.value, binding.modifiers)
  nextTick(() => {
    revealInContainer(el, options)
  })
}

/**
 * v-scroll-into-view directive:
 * Automatically scrolls an element into its container's visible area when active,
 * scrolling only the nearest scrollable container (via `utils/scroll.ts`).
 *
 * Modifiers:
 *   .center - Centers the element vertically in the container
 *   .smooth - Enables smooth scrolling animation
 *
 * Usage:
 *   <tr v-scroll-into-view="index === cursor">
 *   <li v-scroll-into-view.center="isSelected">
 */
export const vScrollIntoView: Directive<HTMLElement, ScrollIntoViewInput> = {
  mounted(el, binding) {
    if (!parseActive(binding.value)) return
    scheduleScroll(el, binding)
  },

  updated(el, binding) {
    const active = parseActive(binding.value)
    const wasActive = parseActive(binding.oldValue)

    if (active && !wasActive) {
      scheduleScroll(el, binding)
    }
  },
}
