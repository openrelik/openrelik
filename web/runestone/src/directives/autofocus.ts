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

import { nextTick, type Directive } from 'vue'

/**
 * v-autofocus directive:
 * Automatically focuses an element when mounted or when its binding value transitions to true.
 *
 * Modifiers:
 *   .select - Selects the text within the input/textarea upon focus.
 *
 * Usage:
 *   <input v-autofocus />
 *   <input v-autofocus.select />
 *   <input v-autofocus="isOpen" />
 */
function focusTarget(el: HTMLElement, select?: boolean) {
  nextTick(() => {
    const target =
      el instanceof HTMLInputElement ||
      el instanceof HTMLTextAreaElement ||
      el instanceof HTMLButtonElement ||
      el.hasAttribute('tabindex')
        ? el
        : (el.querySelector<HTMLElement>('input, textarea, button, [tabindex]') ?? el)

    target.focus()

    if (select && 'select' in target && typeof target.select === 'function') {
      target.select()
    }
  })
}

export const vAutofocus: Directive<HTMLElement, boolean | undefined> = {
  mounted(el, binding) {
    if (binding.value === false) return
    focusTarget(el, binding.modifiers.select)
  },

  updated(el, binding) {
    if (binding.value && !binding.oldValue) {
      focusTarget(el, binding.modifiers.select)
    }
  },
}
