// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'

import { revealIn } from '@/utils/scroll'

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
