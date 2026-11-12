export interface RevealOptions {
  block?: ScrollLogicalPosition
  inline?: ScrollLogicalPosition
  behavior?: ScrollBehavior
}

function findScrollContainer(el: Element): HTMLElement | null {
  let node = el.parentElement
  while (node && node !== document.body && node !== document.documentElement) {
    const { overflowY } = getComputedStyle(node)
    if (overflowY === 'auto' || overflowY === 'scroll') return node
    node = node.parentElement
  }
  return null
}

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

/**
 * Scroll only `el`'s nearest overflow container so `el` is visible (respecting
 * CSS `scroll-margin-top` for sticky table headers) without scrolling outer
 * page ancestors or horizontally jumping rows wider than the container.
 */
export function revealInContainer(el: HTMLElement, options: RevealOptions = {}) {
  const { block = 'nearest', inline = 'nearest', behavior = 'auto' } = options
  const container = findScrollContainer(el)
  if (!container) {
    el.scrollIntoView({ block, inline, behavior })
    return
  }

  const box = container.getBoundingClientRect()
  const target = el.getBoundingClientRect()
  const marginTop = parseFloat(getComputedStyle(el).scrollMarginTop) || 0

  let top = 0
  if (block === 'center') {
    top = target.top - box.top - (box.height - target.height) / 2
  } else if (block === 'start') {
    top = target.top - (box.top + marginTop)
  } else if (block === 'end') {
    top = target.bottom - box.bottom
  } else if (target.top < box.top + marginTop) {
    top = target.top - (box.top + marginTop)
  } else if (target.bottom > box.bottom) {
    top = target.bottom - box.bottom
  }

  let left = 0
  if (inline === 'center') {
    left = target.left - box.left - (box.width - target.width) / 2
  } else if (inline === 'start') {
    left = target.left - box.left
  } else if (inline === 'end') {
    left = target.right - box.right
  } else if (target.width <= box.width) {
    if (target.left < box.left) left = target.left - box.left
    else if (target.right > box.right) left = target.right - box.right
  }

  if (top !== 0 || left !== 0) {
    container.scrollBy({ top, left, behavior })
  }
}
