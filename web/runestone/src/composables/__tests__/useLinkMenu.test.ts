// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'

import { closeLinkMenu, openLinkMenu, useLinkMenu } from '@/composables/useLinkMenu'

describe('useLinkMenu', () => {
  afterEach(() => {
    closeLinkMenu()
    document.body.innerHTML = ''
  })

  it('opens, switches anchors, toggles closed on the same anchor, and refocuses on Escape close', () => {
    const { state } = useLinkMenu()
    const anchorA = document.createElement('button')
    const anchorB = document.createElement('button')
    document.body.append(anchorA, anchorB)
    const focusA = vi.spyOn(anchorA, 'focus')
    const focusB = vi.spyOn(anchorB, 'focus')

    expect(state.value).toBeNull()

    openLinkMenu(anchorA, 'https://a.example.com', 'link')
    expect(state.value).toEqual({
      url: 'https://a.example.com',
      kind: 'link',
      anchor: anchorA,
    })

    // Clicking the same anchor again toggles it closed
    openLinkMenu(anchorA, 'https://a.example.com', 'link')
    expect(state.value).toBeNull()

    // Switching directly from anchorA to anchorB replaces state
    openLinkMenu(anchorA, 'https://a.example.com', 'link')
    openLinkMenu(anchorB, 'https://b.example.com/img.png', 'image')
    expect(state.value).toEqual({
      url: 'https://b.example.com/img.png',
      kind: 'image',
      anchor: anchorB,
    })

    // closeLinkMenu(true) returns focus to the active anchor
    closeLinkMenu(true)
    expect(state.value).toBeNull()
    expect(focusB).toHaveBeenCalledTimes(1)
    expect(focusA).not.toHaveBeenCalled()

    // closeLinkMenu(true) when already closed is a safe no-op
    closeLinkMenu(true)
    expect(state.value).toBeNull()
  })
})
