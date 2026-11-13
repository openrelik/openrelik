// @vitest-environment happy-dom
import { createPinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import FileSidePanel, { type SideTab } from '@/components/viewers/FileSidePanel.vue'
import directives from '@/directives'
import type { Item } from '@/types/item'

const wrappers: { unmount: () => void }[] = []

function makeFile(): Item {
  return {
    id: 9,
    parent: 1,
    kind: 'file',
    name: 'disk.raw',
    owner: 'Operator',
    modified: '2026-11-01T00:00:00Z',
    size: 1024,
    mime: 'application/octet-stream',
  }
}

function mountPanel(overrides: {
  open?: boolean
  inspector?: 'bytes' | 'row' | null
  modelValue?: SideTab
}) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/', component: { template: '<div />' } }],
  })
  const wrapper = mount(FileSidePanel, {
    attachTo: document.body,
    props: {
      open: overrides.open ?? true,
      file: makeFile(),
      inspector: overrides.inspector ?? null,
      modelValue: overrides.modelValue ?? 'details',
    },
    global: {
      plugins: [createPinia(), router, directives],
    },
  })
  wrappers.push(wrapper)
  return wrapper
}

beforeEach(() => {
  localStorage.clear()
  Object.defineProperty(window, 'innerWidth', {
    value: 1400,
    configurable: true,
    writable: true,
  })
})

afterEach(() => {
  while (wrappers.length > 0) {
    wrappers.pop()?.unmount()
  }
  localStorage.clear()
})

describe('FileSidePanel', () => {
  it('slides open and closed while keeping inspector teleport targets mounted in the DOM', async () => {
    const wrapper = mountPanel({ open: true, inspector: null, modelValue: 'details' })

    expect(wrapper.classes()).not.toContain('invisible')
    expect(wrapper.attributes('style')).toContain('1fr')
    expect(wrapper.find('h2').text()).toBe('Details')
    expect(wrapper.find('[role="tablist"]').exists()).toBe(false)
    expect(wrapper.find('#file-side-bytes').exists()).toBe(true)
    expect(wrapper.find('#file-side-row').exists()).toBe(true)

    await wrapper.setProps({ open: false })
    expect(wrapper.classes()).toContain('invisible')
    expect(wrapper.attributes('style')).toContain('0fr')
    expect(wrapper.find('#file-side-bytes').exists()).toBe(true)
    expect(wrapper.find('#file-side-row').exists()).toBe(true)
  })

  it('renders Details and Inspector tabs for bytes and row inspectors and toggles visibility', async () => {
    const wrapper = mountPanel({ open: true, inspector: 'bytes', modelValue: 'details' })

    const tabs = wrapper.findAll('[role="tab"]')
    expect(tabs.map((t) => t.text())).toEqual(['Details', 'Inspector'])
    expect(tabs[0]?.attributes('aria-selected')).toBe('true')
    expect(tabs[1]?.attributes('aria-selected')).toBe('false')

    expect(wrapper.get('[aria-label="File details"]').isVisible()).toBe(true)
    expect(wrapper.get('#file-side-bytes').isVisible()).toBe(false)
    expect(wrapper.get('#file-side-row').isVisible()).toBe(false)

    await tabs[1]!.trigger('click')
    expect(wrapper.emitted('update:modelValue')?.[0]).toEqual(['inspector'])

    await wrapper.setProps({ modelValue: 'inspector' })
    expect(tabs[1]?.attributes('aria-selected')).toBe('true')
    expect(wrapper.get('[aria-label="File details"]').isVisible()).toBe(false)
    expect(wrapper.get('#file-side-bytes').isVisible()).toBe(true)
    expect(wrapper.get('#file-side-row').isVisible()).toBe(false)

    await wrapper.setProps({ inspector: 'row' })
    expect(wrapper.get('#file-side-bytes').isVisible()).toBe(false)
    expect(wrapper.get('#file-side-row').isVisible()).toBe(true)
  })

  it('emits close when the panel toggle button is clicked', async () => {
    const wrapper = mountPanel({ open: true })
    await wrapper.get('button[aria-label="Hide details"]').trigger('click')
    expect(wrapper.emitted('close')).toHaveLength(1)
  })

  it('resizes width via the resize handle and resets to initial width on double-click', async () => {
    const wrapper = mountPanel({ open: true })
    const aside = wrapper.get('aside[aria-label="Side panel"]')
    const handle = wrapper.get('[role="separator"][aria-label="Resize the side panel"]')
    ;(
      handle.element as HTMLElement & { setPointerCapture: (id: number) => void }
    ).setPointerCapture = vi.fn()

    expect(aside.attributes('style')).toContain('width: 416px')

    await handle.trigger('pointerdown', { clientX: 900, pointerId: 1 })
    await handle.trigger('pointermove', { clientX: 800 })
    await handle.trigger('pointerup')
    expect(aside.attributes('style')).toContain('width: 516px')

    await handle.trigger('dblclick')
    expect(aside.attributes('style')).toContain('width: 416px')
  })
})
