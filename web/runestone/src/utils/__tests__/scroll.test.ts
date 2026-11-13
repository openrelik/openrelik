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
import { describe, expect, it, vi } from 'vitest'

import { revealIn, revealInContainer } from '@/utils/scroll'

function mockRect(el: Element, rect: { top: number; left: number; width: number; height: number }) {
  vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({
    top: rect.top,
    left: rect.left,
    width: rect.width,
    height: rect.height,
    right: rect.left + rect.width,
    bottom: rect.top + rect.height,
    x: rect.left,
    y: rect.top,
    toJSON: () => ({}),
  })
}

describe('revealIn', () => {
  it('scrolls only container vertically to center target and leaves horizontal alone when inside', () => {
    const container = document.createElement('div')
    const target = document.createElement('div')
    const scrollBy = vi.fn()
    container.scrollBy = scrollBy

    mockRect(container, { top: 100, left: 50, width: 400, height: 200 })
    mockRect(target, { top: 260, left: 80, width: 100, height: 20 })

    revealIn(container, target)

    // top = (260 - 100) - (200 - 20) / 2 = 160 - 90 = 70
    expect(scrollBy).toHaveBeenCalledWith({ top: 70, left: 0, behavior: 'auto' })
  })

  it('scrolls left with 16px margin when target overflows left or right of container', () => {
    const container = document.createElement('div')
    const target = document.createElement('div')
    const scrollBy = vi.fn()
    container.scrollBy = scrollBy

    mockRect(container, { top: 0, left: 100, width: 300, height: 100 })
    mockRect(target, { top: 40, left: 70, width: 50, height: 20 })
    revealIn(container, target)
    // left = 70 - 100 - 16 = -46
    expect(scrollBy).toHaveBeenLastCalledWith({ top: 0, left: -46, behavior: 'auto' })

    mockRect(target, { top: 40, left: 380, width: 50, height: 20 })
    revealIn(container, target)
    // target.right (430) > box.right (400) -> left = 30 + 16 = 46
    expect(scrollBy).toHaveBeenLastCalledWith({ top: 0, left: 46, behavior: 'auto' })
  })
})

describe('revealInContainer', () => {
  it('scrolls only the nearest overflow parent without shifting wide table rows horizontally', () => {
    const outer = document.createElement('div')
    outer.style.overflowY = 'auto'
    const outerScrollBy = vi.fn()
    outer.scrollBy = outerScrollBy

    const container = document.createElement('div')
    container.style.overflowY = 'auto'
    const scrollBy = vi.fn()
    container.scrollBy = scrollBy

    const target = document.createElement('div')
    target.style.scrollMarginTop = '28px'

    outer.appendChild(container)
    container.appendChild(target)
    document.body.appendChild(outer)

    mockRect(container, { top: 0, left: 0, width: 300, height: 200 })
    // Already visible below sticky offset and wider than container -> no scroll at all
    mockRect(target, { top: 40, left: -20, width: 500, height: 28 })
    revealInContainer(target)
    expect(scrollBy).not.toHaveBeenCalled()

    // Below bottom edge -> scrolls down minimally
    mockRect(target, { top: 190, left: -20, width: 500, height: 28 })
    revealInContainer(target)
    expect(scrollBy).toHaveBeenLastCalledWith({ top: 18, left: 0, behavior: 'auto' })
    expect(outerScrollBy).not.toHaveBeenCalled()

    outer.remove()
  })
})
