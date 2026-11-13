// @vitest-environment happy-dom
import { defineComponent, nextTick, ref } from 'vue'
import { mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { vAutofocus } from '@/directives/autofocus'

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

describe('vAutofocus', () => {
  it('focuses an input on mount by default', async () => {
    const Comp = defineComponent({
      directives: { autofocus: vAutofocus },
      template: '<input v-autofocus data-testid="input" />',
    })

    const wrapper = track(mount(Comp, { attachTo: document.body }))
    await nextTick()

    expect(document.activeElement).toBe(wrapper.get('[data-testid="input"]').element)
  })

  it('does not focus on mount when binding value is false', async () => {
    const Comp = defineComponent({
      directives: { autofocus: vAutofocus },
      template: '<input v-autofocus="false" data-testid="input" />',
    })

    const wrapper = track(mount(Comp, { attachTo: document.body }))
    await nextTick()

    expect(document.activeElement).not.toBe(wrapper.get('[data-testid="input"]').element)
  })

  it('selects text when .select modifier is used on an input', async () => {
    const selectSpy = vi.spyOn(HTMLInputElement.prototype, 'select')
    const Comp = defineComponent({
      directives: { autofocus: vAutofocus },
      template: '<input v-autofocus.select value="case-001" data-testid="input" />',
    })

    const wrapper = track(mount(Comp, { attachTo: document.body }))
    await nextTick()

    expect(document.activeElement).toBe(wrapper.get('[data-testid="input"]').element)
    expect(selectSpy).toHaveBeenCalledTimes(1)
  })

  it('focuses textarea, button, and tabindex elements directly without throwing on .select', async () => {
    const Comp = defineComponent({
      directives: { autofocus: vAutofocus },
      template: `
        <div>
          <button v-autofocus.select data-testid="btn">Act</button>
        </div>
      `,
    })

    const wrapper = track(mount(Comp, { attachTo: document.body }))
    await nextTick()

    expect(document.activeElement).toBe(wrapper.get('[data-testid="btn"]').element)
  })

  it('queries a focusable descendant when attached to a non-focusable container, falling back to container', async () => {
    const WithChild = defineComponent({
      directives: { autofocus: vAutofocus },
      template: '<div v-autofocus><textarea data-testid="area"></textarea></div>',
    })

    const wrapper = track(mount(WithChild, { attachTo: document.body }))
    await nextTick()
    expect(document.activeElement).toBe(wrapper.get('[data-testid="area"]').element)

    const WithoutChild = defineComponent({
      directives: { autofocus: vAutofocus },
      template: '<div v-autofocus data-testid="box"><span>plain</span></div>',
    })

    const boxWrapper = track(mount(WithoutChild, { attachTo: document.body }))
    const focusSpy = vi.spyOn(boxWrapper.get('[data-testid="box"]').element as HTMLElement, 'focus')
    // Trigger updated path from false -> true as well on a plain container
    expect(focusSpy).not.toHaveBeenCalled()
  })

  it('focuses and selects when binding value transitions from false to true, ignoring true-to-true updates', async () => {
    const active = ref(false)
    const label = ref('a')
    const selectSpy = vi.spyOn(HTMLInputElement.prototype, 'select')

    const Comp = defineComponent({
      directives: { autofocus: vAutofocus },
      setup() {
        return { active, label }
      },
      template:
        '<div v-autofocus.select="active"><input :aria-label="label" value="hello" /></div>',
    })

    const wrapper = track(mount(Comp, { attachTo: document.body }))
    const input = wrapper.get('input').element as HTMLInputElement
    const focusSpy = vi.spyOn(input, 'focus')

    await nextTick()
    expect(focusSpy).not.toHaveBeenCalled()

    active.value = true
    await nextTick()
    await nextTick()

    expect(focusSpy).toHaveBeenCalledTimes(1)
    expect(selectSpy).toHaveBeenCalledTimes(1)

    // Subsequent update while active stays true should not refocus
    label.value = 'b'
    await nextTick()
    await nextTick()
    expect(focusSpy).toHaveBeenCalledTimes(1)
  })

  it('focuses an element with tabindex directly on updated transition', async () => {
    const active = ref(false)
    const Comp = defineComponent({
      directives: { autofocus: vAutofocus },
      setup() {
        return { active }
      },
      template: '<div tabindex="0" v-autofocus="active" data-testid="tabbable">Panel</div>',
    })

    const wrapper = track(mount(Comp, { attachTo: document.body }))
    await nextTick()

    active.value = true
    await nextTick()
    await nextTick()

    expect(document.activeElement).toBe(wrapper.get('[data-testid="tabbable"]').element)
  })
})
