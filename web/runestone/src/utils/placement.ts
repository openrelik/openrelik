export type Placement = 'top' | 'bottom' | 'left' | 'right'

export interface Box {
  width: number
  height: number
}

export interface AnchorRect extends Box {
  top: number
  left: number
  right: number
  bottom: number
}

export interface Placed {
  left: number
  top: number
  placement: Placement
}

const OPPOSITE: Record<Placement, Placement> = {
  top: 'bottom',
  bottom: 'top',
  left: 'right',
  right: 'left',
}

function fits(anchor: AnchorRect, box: Box, side: Placement, viewport: Box, gap: number): boolean {
  if (side === 'top') return anchor.top - gap - box.height >= 0
  if (side === 'bottom') return anchor.bottom + gap + box.height <= viewport.height
  if (side === 'left') return anchor.left - gap - box.width >= 0
  return anchor.right + gap + box.width <= viewport.width
}

/** `value` inside [min, max]; `min` wins when the range is empty. */
function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

/**
 * Where a floating box of measured size goes beside `anchor`: on the
 * `preferred` side, flipped to the opposite one when only that fits, then
 * shifted to stay `margin` inside the viewport. Floating UI's flip + shift,
 * in one screen of arithmetic.
 */
export function place(
  anchor: AnchorRect,
  box: Box,
  preferred: Placement,
  viewport: Box,
  offset = 6,
  margin = 8,
): Placed {
  const gap = offset + margin
  const placement =
    fits(anchor, box, preferred, viewport, gap) ||
    !fits(anchor, box, OPPOSITE[preferred], viewport, gap)
      ? preferred
      : OPPOSITE[preferred]

  let left: number
  let top: number
  if (placement === 'top' || placement === 'bottom') {
    left = anchor.left + anchor.width / 2 - box.width / 2
    top = placement === 'top' ? anchor.top - offset - box.height : anchor.bottom + offset
  } else {
    top = anchor.top + anchor.height / 2 - box.height / 2
    left = placement === 'left' ? anchor.left - offset - box.width : anchor.right + offset
  }

  return {
    left: clamp(left, margin, viewport.width - margin - box.width),
    top: clamp(top, margin, viewport.height - margin - box.height),
    placement,
  }
}
