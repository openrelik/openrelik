/**
 * Utility functions for keyboard event handling and focus management.
 */

/**
 * Checks if the event target is an active text input or editable element.
 * Checkboxes, radio buttons, and the PathBar terminal prompt (data-prompt)
 * are not considered blocking typing inputs for table navigation, because
 * PathBar's prompt manages its own keystrokes and intentionally allows
 * navigation keys (arrows, enter, space, etc.) to bubble to the view.
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
    // The path prompt input has dataset.prompt.
    // It intentionally lets arrow navigation and listing keys pass through.
    if ('prompt' in target.dataset) {
      return false
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
