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
 * Utility functions for keyboard event handling and focus management.
 */

/** Keys the path prompt hands to the listing while its line is empty: move, range-select, open. */
const LISTING_KEYS = new Set([
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'Enter',
  ' ',
  'Home',
  'End',
])

/**
 * Whether the path prompt lets a key through to the page: a listing key or `?`
 * on an empty line, or ⌘⏎ (runs a worker on the highlighted file). Every other
 * key is the prompt's.
 */
export function promptPassesThrough(event: KeyboardEvent, line: string): boolean {
  if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') return true
  if (!line && event.key === '?' && !event.metaKey && !event.ctrlKey && !event.altKey) return true
  return !line && LISTING_KEYS.has(event.key)
}

/**
 * Checks if the event target is an active text input, select, or editable element.
 * Checkboxes and radio buttons are not typing. Nor is the PathBar prompt
 * (data-prompt) for the keys it passes through to the listing; for every
 * other key it is, which matters to listeners in the capture phase: they
 * see a key before the prompt can stop it.
 */
export function isTyping(event: KeyboardEvent): boolean {
  const target = event.target
  if (!(target instanceof HTMLElement)) return false

  if (target.isContentEditable) return true
  if (target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return true

  if (target instanceof HTMLInputElement) {
    if (target.type === 'checkbox' || target.type === 'radio') {
      return false
    }
    if ('prompt' in target.dataset) {
      return !promptPassesThrough(event, target.value)
    }
    return true
  }

  return false
}

/**
 * Whether a Command (Mac) or Control (Windows/Linux) modifier is pressed without Alt.
 */
export function isCommandModifier(event: KeyboardEvent): boolean {
  return (event.metaKey || event.ctrlKey) && !event.altKey
}
