/**
 * Scroll `container` — and only it — so `el` sits in its vertical middle and
 * inside it horizontally. `scrollIntoView` would also scroll every ancestor,
 * dragging the page away from whatever was clicked; this leaves them alone.
 * Works from screen rectangles, so a CSS-scaled child is placed correctly.
 */
export function revealIn(container: HTMLElement, el: Element) {
  const box = container.getBoundingClientRect()
  const target = el.getBoundingClientRect()
  const top = target.top - box.top - (box.height - target.height) / 2
  let left = 0
  if (target.left < box.left) left = target.left - box.left - 16
  else if (target.right > box.right) left = target.right - box.right + 16
  // Instant, like a terminal: nothing to wait for, and nothing for a throttled
  // background tab to leave half-finished.
  container.scrollBy({ top, left, behavior: 'auto' })
}
