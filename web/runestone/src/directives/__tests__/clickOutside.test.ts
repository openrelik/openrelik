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
import { defineComponent } from 'vue'
import { mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { vClickOutside } from '@/directives/clickOutside'

const wrappers: VueWrapper[] = []

function track<T extends VueWrapper>(wrapper: T): T {
  wrappers.push(wrapper)
  return wrapper
}

afterEach(() => {
  while (wrappers.length > 0) {
    wrappers.pop()?.unmount()
  }
  document.body.innerHTML = ''
})

describe('vClickOutside', () => {
  it('invokes the callback only when pointerdown occurs outside the element and outside ignored controls', () => {
    const onOutside = vi.fn<(event: PointerEvent) => void>()

    const Comp = defineComponent({
      directives: { clickOutside: vClickOutside },
      setup() {
        return { onOutside }
      },
      template: `
        <div>
          <button data-click-outside-ignore data-testid="toggle">
            <span data-testid="toggle-icon">Toggle</span>
          </button>
          <div v-click-outside="onOutside" data-testid="panel">
            <span data-testid="inside">Panel content</span>
          </div>
          <div data-testid="outside">Outside area</div>
        </div>
      `,
    })

    const wrapper = track(mount(Comp, { attachTo: document.body }))

    // Click on panel itself -> ignored
    wrapper
      .get('[data-testid="panel"]')
      .element.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    expect(onOutside).not.toHaveBeenCalled()

    // Click on descendant inside panel -> ignored
    wrapper
      .get('[data-testid="inside"]')
      .element.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    expect(onOutside).not.toHaveBeenCalled()

    // Click on data-click-outside-ignore button or its child -> ignored
    wrapper
      .get('[data-testid="toggle"]')
      .element.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    wrapper
      .get('[data-testid="toggle-icon"]')
      .element.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    expect(onOutside).not.toHaveBeenCalled()

    // Click outside, even when target stops propagation -> caught in capture phase
    const outsideEl = wrapper.get('[data-testid="outside"]').element
    outsideEl.addEventListener('pointerdown', (e) => e.stopPropagation())
    const event = new PointerEvent('pointerdown', { bubbles: true })
    outsideEl.dispatchEvent(event)

    expect(onOutside).toHaveBeenCalledTimes(1)
    expect(onOutside).toHaveBeenCalledWith(event)
  })

  it('removes the capture listener when unmounted', () => {
    const onOutside = vi.fn()
    const Comp = defineComponent({
      directives: { clickOutside: vClickOutside },
      setup() {
        return { onOutside }
      },
      template: '<div><div v-click-outside="onOutside">Box</div></div>',
    })

    const wrapper = mount(Comp, { attachTo: document.body })
    wrapper.unmount()

    document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    expect(onOutside).not.toHaveBeenCalled()
  })
})
