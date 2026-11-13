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
