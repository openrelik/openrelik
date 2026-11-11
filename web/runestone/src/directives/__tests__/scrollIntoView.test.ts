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
})
