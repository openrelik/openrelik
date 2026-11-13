import { describe, expect, it } from 'vitest'

import { place, type AnchorRect, type Box } from '@/utils/placement'

function makeAnchor(left: number, top: number, width: number, height: number): AnchorRect {
  return {
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
  }
}

describe('place', () => {
  const viewport: Box = { width: 800, height: 600 }
  const box: Box = { width: 120, height: 40 }

  it('places centered on the preferred side when there is room', () => {
    const anchor = makeAnchor(300, 250, 80, 30)

    expect(place(anchor, box, 'top', viewport)).toEqual({
      placement: 'top',
      left: 280,
      top: 204,
    })
    expect(place(anchor, box, 'bottom', viewport)).toEqual({
      placement: 'bottom',
      left: 280,
      top: 286,
    })
    expect(place(anchor, box, 'left', viewport)).toEqual({
      placement: 'left',
      left: 174,
      top: 245,
    })
    expect(place(anchor, box, 'right', viewport)).toEqual({
      placement: 'right',
      left: 386,
      top: 245,
    })
  })

  it('flips to the opposite side when the preferred side overflows and opposite fits', () => {
    expect(place(makeAnchor(300, 10, 80, 30), box, 'top', viewport).placement).toBe('bottom')
    expect(place(makeAnchor(300, 570, 80, 20), box, 'bottom', viewport).placement).toBe('top')
    expect(place(makeAnchor(10, 250, 40, 30), box, 'left', viewport).placement).toBe('right')
    expect(place(makeAnchor(750, 250, 40, 30), box, 'right', viewport).placement).toBe('left')
  })

  it('keeps preferred side and clamps inside margin when neither side fits', () => {
    const tinyViewport: Box = { width: 200, height: 60 }
    const placed = place(makeAnchor(80, 20, 40, 20), box, 'top', tinyViewport, 6, 8)

    expect(placed.placement).toBe('top')
    expect(placed.top).toBe(8)
    expect(placed.left).toBeGreaterThanOrEqual(8)
  })

  it('shifts along the cross-axis to keep margin from viewport edges', () => {
    const nearLeft = place(makeAnchor(2, 200, 20, 20), box, 'bottom', viewport, 6, 8)
    expect(nearLeft.left).toBe(8)

    const nearRight = place(makeAnchor(780, 200, 20, 20), box, 'bottom', viewport, 6, 8)
    expect(nearRight.left).toBe(800 - 8 - 120)
  })
})
