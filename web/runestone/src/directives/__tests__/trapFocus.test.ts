// @vitest-environment happy-dom
import { defineComponent } from 'vue'
import { mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'

import { vTrapFocus } from '@/directives/trapFocus'

const wrappers: VueWrapper[] = []

function track<T extends VueWrapper>(wrapper: T): T {
  wrappers.push(wrapper)
  return wrapper
}

function markVisible(elements: Element[]): void {
  for (const el of elements) {
    Object.defineProperty(el, 'offsetParent', {
      configurable: true,
      get: () => document.body,
    })
  }
}

afterEach(() => {
  while (wrappers.length > 0) {
    wrappers.pop()?.unmount()
  }
  document.body.innerHTML = ''
})

describe('vTrapFocus', () => {
  it('wraps Tab and Shift+Tab across visible focusable controls and skips disabled or hidden ones', () => {
    const trigger = document.createElement('button')
    trigger.textContent = 'Open modal'
    document.body.appendChild(trigger)
    trigger.focus()
    expect(document.activeElement).toBe(trigger)

    const Comp = defineComponent({
      directives: { trapFocus: vTrapFocus },
      template: `
        <div role="dialog" v-trap-focus data-testid="dialog">
          <button disabled data-testid="disabled">Disabled</button>
          <input data-testid="first" />
          <button tabindex="-1" data-testid="skipped">Skipped</button>
          <button data-testid="hidden">Hidden</button>
          <button data-testid="middle">Middle</button>
          <a href="#end" data-testid="last">Last</a>
        </div>
      `,
    })

    const wrapper = track(mount(Comp, { attachTo: document.body }))
    const dialog = wrapper.get('[data-testid="dialog"]').element as HTMLElement
    const first = wrapper.get('[data-testid="first"]').element as HTMLElement
    const middle = wrapper.get('[data-testid="middle"]').element as HTMLElement
    const last = wrapper.get('[data-testid="last"]').element as HTMLElement
    const hidden = wrapper.get('[data-testid="hidden"]').element as HTMLElement

    markVisible([first, middle, last])
    Object.defineProperty(hidden, 'offsetParent', { configurable: true, get: () => null })

    // Non-Tab keys (e.g. Escape) are ignored by trapFocus
    const esc = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    dialog.dispatchEvent(esc)
    expect(esc.defaultPrevented).toBe(false)

    // When focus is outside the dialog (still on trigger), Tab moves focus to first
    const tabFromOutside = new KeyboardEvent('keydown', {
      key: 'Tab',
      bubbles: true,
      cancelable: true,
    })
    dialog.dispatchEvent(tabFromOutside)
    expect(tabFromOutside.defaultPrevented).toBe(true)
    expect(document.activeElement).toBe(first)

    // Tab on first (not at end) allows natural browser tab progression
    const tabFromFirst = new KeyboardEvent('keydown', {
      key: 'Tab',
      bubbles: true,
      cancelable: true,
    })
    first.dispatchEvent(tabFromFirst)
    expect(tabFromFirst.defaultPrevented).toBe(false)

    // Tab on last wraps around to first
    last.focus()
    const tabFromLast = new KeyboardEvent('keydown', {
      key: 'Tab',
      bubbles: true,
      cancelable: true,
    })
    last.dispatchEvent(tabFromLast)
    expect(tabFromLast.defaultPrevented).toBe(true)
    expect(document.activeElement).toBe(first)

    // Shift+Tab on first wraps around to last
    const shiftTabFromFirst = new KeyboardEvent('keydown', {
      key: 'Tab',
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    })
    first.dispatchEvent(shiftTabFromFirst)
    expect(shiftTabFromFirst.defaultPrevented).toBe(true)
    expect(document.activeElement).toBe(last)

    // Shift+Tab on middle allows natural backward tab progression
    middle.focus()
    const shiftTabFromMiddle = new KeyboardEvent('keydown', {
      key: 'Tab',
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    })
    middle.dispatchEvent(shiftTabFromMiddle)
    expect(shiftTabFromMiddle.defaultPrevented).toBe(false)

    // Shift+Tab when focus escaped outside moves focus to last
    trigger.focus()
    const shiftTabFromOutside = new KeyboardEvent('keydown', {
      key: 'Tab',
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    })
    dialog.dispatchEvent(shiftTabFromOutside)
    expect(shiftTabFromOutside.defaultPrevented).toBe(true)
    expect(document.activeElement).toBe(last)

    // Unmounting restores focus to the trigger that was active before mount
    wrapper.unmount()
    expect(document.activeElement).toBe(trigger)
  })

  it('prevents Tab from escaping an empty dialog and tolerates a removed previous active element on unmount', () => {
    const ephemeral = document.createElement('button')
    document.body.appendChild(ephemeral)
    ephemeral.focus()

    const Comp = defineComponent({
      directives: { trapFocus: vTrapFocus },
      template: '<div role="dialog" v-trap-focus data-testid="empty"><p>No controls</p></div>',
    })

    const wrapper = mount(Comp, { attachTo: document.body })
    const dialog = wrapper.get('[data-testid="empty"]').element as HTMLElement

    const tab = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })
    dialog.dispatchEvent(tab)
    expect(tab.defaultPrevented).toBe(true)

    // Remove previous active element before unmount
    ephemeral.remove()
    wrapper.unmount()

    // Listener is removed after unmount
    const tabAfter = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })
    dialog.dispatchEvent(tabAfter)
    expect(tabAfter.defaultPrevented).toBe(false)
  })
})
