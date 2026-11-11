// @vitest-environment happy-dom
import { nextTick } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import LinkMenu from '@/components/markdown/LinkMenu.vue'
import { closeLinkMenu, openLinkMenu, useLinkMenu } from '@/composables/useLinkMenu'
import { directives } from '@/directives'

function makeRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/a', component: { template: '<div />' } },
      { path: '/b', component: { template: '<div />' } },
    ],
  })
}

function getMenu(): HTMLElement | null {
  return document.body.querySelector<HTMLElement>('[role="menu"]')
}

describe('LinkMenu', () => {
  const writeText = vi.fn<(text: string) => Promise<void>>()
  let anchor: HTMLButtonElement
  const wrappers: { unmount: () => void }[] = []

  beforeEach(() => {
    vi.useFakeTimers()
    closeLinkMenu()
    writeText.mockReset()
    writeText.mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    })

    anchor = document.createElement('button')
    anchor.textContent = 'evidence link'
    document.body.appendChild(anchor)
    vi.spyOn(anchor, 'getBoundingClientRect').mockReturnValue(new DOMRect(40, 80, 100, 20))
  })

  afterEach(() => {
    while (wrappers.length > 0) {
      wrappers.pop()?.unmount()
    }
    closeLinkMenu()
    anchor.remove()
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('cycles focus with ArrowDown/ArrowUp/j/k, ignores unhandled keys, and closes on Escape (refocusing anchor) and Tab', async () => {
    const router = makeRouter()
    await router.push('/a')
    await router.isReady()

    const wrapper = mount(LinkMenu, {
      global: { plugins: [router, directives] },
    })
    wrappers.push(wrapper)

    openLinkMenu(anchor, 'https://example.org/ioc', 'link')
    await flushPromises()

    const menu = getMenu()!
    const buttons = menu.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')
    expect(buttons).toHaveLength(2)
    expect(document.activeElement).toBe(buttons[0])

    // ArrowDown moves to Open, j wraps to Copy.
    menu.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
    expect(document.activeElement).toBe(buttons[1])

    menu.dispatchEvent(new KeyboardEvent('keydown', { key: 'j', bubbles: true }))
    expect(document.activeElement).toBe(buttons[0])

    // ArrowUp wraps to Open, k moves back to Copy.
    menu.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }))
    expect(document.activeElement).toBe(buttons[1])

    menu.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', bubbles: true }))
    expect(document.activeElement).toBe(buttons[0])

    // Unhandled key (e.g. Home) leaves menu open and focus intact.
    menu.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }))
    expect(useLinkMenu().state.value).not.toBeNull()
    expect(document.activeElement).toBe(buttons[0])

    // Escape closes and returns focus to anchor.
    const focusSpy = vi.spyOn(anchor, 'focus')
    menu.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await flushPromises()
    expect(useLinkMenu().state.value).toBeNull()
    expect(focusSpy).toHaveBeenCalledTimes(1)

    // Re-open and press Tab: closes without refocusing anchor.
    focusSpy.mockClear()
    openLinkMenu(anchor, 'https://example.org/ioc', 'link')
    await flushPromises()
    getMenu()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }))
    await flushPromises()
    expect(useLinkMenu().state.value).toBeNull()
    expect(focusSpy).not.toHaveBeenCalled()
  })

  it('copies URL via navigator.clipboard.writeText and closes after 600ms, and opens external links safely', async () => {
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null)
    const router = makeRouter()
    await router.push('/a')
    await router.isReady()

    const wrapper = mount(LinkMenu, {
      global: { plugins: [router, directives] },
    })
    wrappers.push(wrapper)

    // Flip above anchor when near bottom of viewport.
    Object.defineProperty(window, 'innerHeight', { value: 200, configurable: true })
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: HTMLElement,
    ) {
      if (this === anchor) return new DOMRect(40, 170, 100, 20)
      return new DOMRect(0, 0, 320, 90)
    })

    openLinkMenu(anchor, 'https://intel.example.com/path', 'link')
    await flushPromises()
    await nextTick()

    const menu = getMenu()!
    expect(Number.parseFloat(menu.style.top)).toBeLessThan(170)

    const [copyBtn] = menu.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')
    copyBtn!.click()
    await flushPromises()
    expect(writeText).toHaveBeenCalledWith('https://intel.example.com/path')
    expect(copyBtn!.textContent).toContain('Copied')

    vi.advanceTimersByTime(600)
    await nextTick()
    expect(useLinkMenu().state.value).toBeNull()

    // Re-open and test Open in a new tab with noopener,noreferrer.
    openLinkMenu(anchor, 'https://intel.example.com/path', 'link')
    await flushPromises()

    const [, openBtn] = getMenu()!.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')
    openBtn!.click()
    expect(openSpy).toHaveBeenCalledWith(
      'https://intel.example.com/path',
      '_blank',
      'noopener,noreferrer',
    )
    expect(useLinkMenu().state.value).toBeNull()
  })

  it('blocks unsafe schemes from opening and renders copy-only menu for images', async () => {
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null)
    const router = makeRouter()
    await router.push('/a')
    await router.isReady()

    const wrapper = mount(LinkMenu, {
      global: { plugins: [router, directives] },
    })
    wrappers.push(wrapper)

    openLinkMenu(anchor, 'javascript:alert(1)', 'link')
    await flushPromises()

    const unsafeMenu = getMenu()!
    expect(unsafeMenu.textContent).toContain('Not a web link')
    expect(unsafeMenu.textContent).toContain('Only web links open, not javascript:')
    const [, disabledOpen] = unsafeMenu.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')
    expect(disabledOpen!.getAttribute('aria-disabled')).toBe('true')
    disabledOpen!.click()
    expect(openSpy).not.toHaveBeenCalled()
    expect(useLinkMenu().state.value).not.toBeNull()

    closeLinkMenu()
    openLinkMenu(anchor, 'https://cdn.example.com/pixel.png', 'image')
    await flushPromises()

    const imgMenu = getMenu()!
    expect(imgMenu.getAttribute('aria-label')).toBe('Image link')
    expect(imgMenu.textContent).toContain('Image, not loaded')
    const imgButtons = imgMenu.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')
    expect(imgButtons).toHaveLength(1)
    imgButtons[0]!.click()
    await flushPromises()
    expect(writeText).toHaveBeenCalledWith('https://cdn.example.com/pixel.png')
  })

  it('keeps menu open on internal scroll, and dismisses on outside scroll, window resize, click-outside, and route change', async () => {
    const router = makeRouter()
    await router.push('/a')
    await router.isReady()

    const wrapper = mount(LinkMenu, {
      global: { plugins: [router, directives] },
    })
    wrappers.push(wrapper)

    openLinkMenu(anchor, 'https://example.com/1', 'link')
    await flushPromises()

    const menu = getMenu()!
    // Scroll originating inside the menu is ignored.
    menu.dispatchEvent(new Event('scroll'))
    await nextTick()
    expect(useLinkMenu().state.value).not.toBeNull()

    // Scroll outside dismisses the menu.
    document.body.dispatchEvent(new Event('scroll'))
    await nextTick()
    expect(useLinkMenu().state.value).toBeNull()

    // Window resize dismisses the menu.
    openLinkMenu(anchor, 'https://example.com/2', 'link')
    await flushPromises()
    window.dispatchEvent(new Event('resize'))
    await nextTick()
    expect(useLinkMenu().state.value).toBeNull()

    // Outside pointerdown dismisses via v-click-outside.
    openLinkMenu(anchor, 'https://example.com/3', 'link')
    await flushPromises()
    document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    await nextTick()
    expect(useLinkMenu().state.value).toBeNull()

    // Route change dismisses the menu.
    openLinkMenu(anchor, 'https://example.com/4', 'link')
    await flushPromises()
    await router.push('/b')
    await flushPromises()
    expect(useLinkMenu().state.value).toBeNull()
  })
})
