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

// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'

import { place, pointAnchor, selectionAnchor, type AnchorRect, type Box } from '@/utils/placement'

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

describe('pointAnchor and selectionAnchor', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('builds a zero-width AnchorRect centered vertically around pointer coordinates', () => {
    expect(pointAnchor(120, 240)).toEqual({
      left: 120,
      top: 230,
      right: 120,
      bottom: 250,
      width: 0,
      height: 20,
    })
  })

  it('uses the last non-empty selection client rect when available', () => {
    const rect = { left: 10, top: 20, right: 90, bottom: 38, width: 80, height: 18 }
    vi.spyOn(window, 'getSelection').mockReturnValue({
      rangeCount: 1,
      isCollapsed: false,
      getRangeAt: () => ({ getClientRects: () => [rect] }),
    } as unknown as Selection)

    expect(selectionAnchor(500, 500)).toEqual(rect)
  })

  it('falls back to pointAnchor when there is no active selection rect', () => {
    vi.spyOn(window, 'getSelection').mockReturnValue({
      rangeCount: 0,
      isCollapsed: true,
    } as unknown as Selection)

    expect(selectionAnchor(150, 300)).toEqual(pointAnchor(150, 300))
  })
})
