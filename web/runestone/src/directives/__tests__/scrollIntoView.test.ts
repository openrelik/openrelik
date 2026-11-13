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
import { defineComponent, nextTick, ref } from 'vue'
import { mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { vScrollIntoView, type ScrollIntoViewInput } from '@/directives/scrollIntoView'

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

describe('vScrollIntoView', () => {
  it('scrolls on mount when active with default options or modifiers', async () => {
    const scrollSpy = vi.fn()
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: scrollSpy,
    })

    const Comp = defineComponent({
      directives: { scrollIntoView: vScrollIntoView },
      template: `
        <ul>
          <li v-scroll-into-view="false">Inactive</li>
          <li v-scroll-into-view="true">Default active</li>
          <li v-scroll-into-view.center.smooth="true">Centered smooth</li>
        </ul>
      `,
    })

    track(mount(Comp, { attachTo: document.body }))
    await nextTick()

    expect(scrollSpy).toHaveBeenCalledTimes(2)
    expect(scrollSpy).toHaveBeenNthCalledWith(1, {
      block: 'nearest',
      inline: 'nearest',
      behavior: 'auto',
    })
    expect(scrollSpy).toHaveBeenNthCalledWith(2, {
      block: 'center',
      inline: 'nearest',
      behavior: 'smooth',
    })
  })

  it('supports object configuration and scrolls only when transitioning from inactive to active', async () => {
    const scrollSpy = vi.fn()
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: scrollSpy,
    })

    const input = ref<ScrollIntoViewInput>({
      active: false,
      block: 'start',
      inline: 'center',
      behavior: 'instant',
    })

    const Comp = defineComponent({
      directives: { scrollIntoView: vScrollIntoView },
      setup() {
        return { input }
      },
      template: '<div v-scroll-into-view="input">Row</div>',
    })

    track(mount(Comp, { attachTo: document.body }))
    await nextTick()
    expect(scrollSpy).not.toHaveBeenCalled()

    // Transition inactive -> active triggers scrollIntoView
    input.value = {
      active: true,
      block: 'start',
      inline: 'center',
      behavior: 'instant',
    }
    await nextTick()
    await nextTick()

    expect(scrollSpy).toHaveBeenCalledTimes(1)
    expect(scrollSpy).toHaveBeenCalledWith({
      block: 'start',
      inline: 'center',
      behavior: 'instant',
    })

    // Updating while still active does not re-scroll
    input.value = {
      active: true,
      block: 'end',
      inline: 'nearest',
      behavior: 'smooth',
    }
    await nextTick()
    await nextTick()
    expect(scrollSpy).toHaveBeenCalledTimes(1)

    // Deactivating does not scroll
    input.value = false
    await nextTick()
    await nextTick()
    expect(scrollSpy).toHaveBeenCalledTimes(1)
  })

  it('scrolls only the nearest overflow container and respects scroll-margin-top', async () => {
    const outer = document.createElement('div')
    outer.style.overflowY = 'auto'
    const outerScrollBy = vi.fn()
    outer.scrollBy = outerScrollBy

    const Comp = defineComponent({
      directives: { scrollIntoView: vScrollIntoView },
      template: `
        <div style="overflow-y: auto" data-testid="box">
          <div style="scroll-margin-top: 28px" v-scroll-into-view="true" data-testid="row">Row</div>
        </div>
      `,
    })

    document.body.appendChild(outer)
    const wrapper = track(mount(Comp, { attachTo: outer }))
    const box = wrapper.get('[data-testid="box"]').element as HTMLElement
    const row = wrapper.get('[data-testid="row"]').element as HTMLElement

    const boxScrollBy = vi.fn()
    box.scrollBy = boxScrollBy
    vi.spyOn(box, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 100, 300, 200))
    vi.spyOn(row, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 110, 400, 28))

    await nextTick()

    // row.top (110) is inside box (100..300) but occluded by 28px sticky header (100 + 28 = 128) -> scroll -18
    expect(boxScrollBy).toHaveBeenCalledWith({ top: -18, left: 0, behavior: 'auto' })
    expect(outerScrollBy).not.toHaveBeenCalled()
  })
})
