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
 * Whether the path prompt lets a key through to the page: a listing key on an
 * empty line, or ⌘⏎ (runs a worker on the highlighted file). Every other key
 * is the prompt's.
 */
export function promptPassesThrough(event: KeyboardEvent, line: string): boolean {
  if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') return true
  return !line && LISTING_KEYS.has(event.key)
}

/**
 * Checks if the event target is an active text input or editable element.
 * Checkboxes and radio buttons are not typing. Nor is the PathBar prompt
 * (data-prompt) for the keys it passes through to the listing; for every
 * other key it is, which matters to listeners in the capture phase: they
 * see a key before the prompt can stop it.
 */
export function isTyping(event: KeyboardEvent): boolean {
  const target = event.target
  if (!(target instanceof HTMLElement)) return false

  if (target.isContentEditable) return true
  if (target instanceof HTMLTextAreaElement) return true

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
