// @vitest-environment happy-dom
import { nextTick } from 'vue'
import { DOMWrapper, mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import ItemMenu from '@/components/folders/ItemMenu.vue'
import { Copy, FolderOpen, Trash2 } from '@/components/icons'
import type { ItemAction } from '@/composables/useItemActions'
import { directives } from '@/directives'
import type { Item } from '@/types/item'

function makeItem(overrides: Partial<Item> = {}): Item {
  return {
    id: 42,
    parent: 1,
    kind: 'folder',
    name: 'evidence',
    owner: 'Jane Doe',
    created: '2026-05-01T10:00:00Z',
    modified: '2026-05-02T12:00:00Z',
    ...overrides,
  }
}

function makeActions() {
  const openRun = vi.fn()
  const copyRun = vi.fn()
  const deleteRun = vi.fn()
  const actions: ItemAction[] = [
    { key: 'open', label: 'Open', icon: FolderOpen, run: openRun },
    { key: 'copy-id', label: 'Copy id', icon: Copy, run: copyRun },
    { key: 'delete', label: 'Delete', icon: Trash2, danger: true, run: deleteRun },
  ]
  return { actions, openRun, copyRun, deleteRun }
}

describe('ItemMenu', () => {
  let wrapper: VueWrapper | undefined

  beforeEach(() => {
    vi.useFakeTimers()
    Object.defineProperty(window, 'innerWidth', { value: 1024, configurable: true })
    Object.defineProperty(window, 'innerHeight', { value: 768, configurable: true })
  })

  afterEach(() => {
    wrapper?.unmount()
    wrapper = undefined
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('renders item metadata, danger separator, clamps placement on screen, and focuses first item', async () => {
    const { actions } = makeActions()
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(
      new DOMRect(0, 0, 256, 180),
    )

    wrapper = mount(ItemMenu, {
      attachTo: document.body,
      props: {
        item: makeItem(),
        actions,
        x: 900,
        y: 700,
      },
      global: { plugins: [directives] },
    })

    await nextTick()
    await nextTick()

    const body = new DOMWrapper(document.body)
    const menu = body.get('[role="menu"]')
    expect(menu.attributes('aria-label')).toBe('Actions for evidence')
    // x=900 clamped to 1024 - 256 - 8 = 760; y=700 + 180 + 8 > 768 flips upward to 700 - 180 = 520
    expect(menu.attributes('style')).toContain('left: 760px')
    expect(menu.attributes('style')).toContain('top: 520px')

    expect(menu.text()).toContain('evidence/')
    expect(menu.text()).toContain('id 42')
    expect(menu.find('[role="separator"]').exists()).toBe(true)

    const items = menu.findAll('[role="menuitem"]')
    expect(items).toHaveLength(3)
    expect(items[2]?.classes()).toContain('text-danger')
    expect(document.activeElement).toBe(items[0]?.element)
  })

  it('keeps downward y placement for file items and falls back to modified timestamp when created is absent', async () => {
    const { actions } = makeActions()
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(
      new DOMRect(0, 0, 256, 120),
    )

    wrapper = mount(ItemMenu, {
      attachTo: document.body,
      props: {
        item: makeItem({ kind: 'file', name: 'disk.raw', created: undefined }),
        actions,
        x: 100,
        y: 150,
      },
      global: { plugins: [directives] },
    })

    await nextTick()
    await nextTick()

    const body = new DOMWrapper(document.body)
    const menu = body.get('[role="menu"]')
    expect(menu.attributes('style')).toContain('left: 100px')
    expect(menu.attributes('style')).toContain('top: 150px')
    expect(menu.text()).toContain('disk.raw')
    expect(menu.text()).not.toContain('disk.raw/')
    expect(menu.text()).toContain('2026-05-02 12:00')
  })

  it('navigates items with ArrowDown/Up, j/k, Home/End, closes on Escape/Tab, and ignores other keys', async () => {
    const { actions } = makeActions()
    wrapper = mount(ItemMenu, {
      attachTo: document.body,
      props: {
        item: makeItem(),
        actions,
        x: 40,
        y: 40,
      },
      global: { plugins: [directives] },
    })

    await nextTick()
    await nextTick()

    const body = new DOMWrapper(document.body)
    const menu = body.get('[role="menu"]')
    const items = menu.findAll('[role="menuitem"]')
    expect(document.activeElement).toBe(items[0]?.element)

    await menu.trigger('keydown', { key: 'ArrowDown' })
    expect(document.activeElement).toBe(items[1]?.element)

    await menu.trigger('keydown', { key: 'j' })
    expect(document.activeElement).toBe(items[2]?.element)

    // Wraps around from last to first
    await menu.trigger('keydown', { key: 'ArrowDown' })
    expect(document.activeElement).toBe(items[0]?.element)

    // Wraps around from first to last
    await menu.trigger('keydown', { key: 'ArrowUp' })
    expect(document.activeElement).toBe(items[2]?.element)

    await menu.trigger('keydown', { key: 'k' })
    expect(document.activeElement).toBe(items[1]?.element)

    await menu.trigger('keydown', { key: 'End' })
    expect(document.activeElement).toBe(items[2]?.element)

    await menu.trigger('keydown', { key: 'Home' })
    expect(document.activeElement).toBe(items[0]?.element)

    // Unhandled key neither moves focus nor closes
    await menu.trigger('keydown', { key: 'x' })
    expect(document.activeElement).toBe(items[0]?.element)
    expect(wrapper.emitted('close')).toBeUndefined()

    // Context menu inside menu is suppressed
    const ctxEvent = new MouseEvent('contextmenu', { bubbles: true, cancelable: true })
    menu.element.dispatchEvent(ctxEvent)
    expect(ctxEvent.defaultPrevented).toBe(true)

    await menu.trigger('keydown', { key: 'Escape' })
    expect(wrapper.emitted('close')).toHaveLength(1)

    await menu.trigger('keydown', { key: 'Tab' })
    expect(wrapper.emitted('close')).toHaveLength(2)
  })

  it('invokes action.run before emitting close, closes on outside pointerdown, and reveals pending access notice after 200ms', async () => {
    const { actions, copyRun } = makeActions()
    const callOrder: string[] = []
    copyRun.mockImplementation(() => callOrder.push('run'))

    wrapper = mount(ItemMenu, {
      attachTo: document.body,
      props: {
        item: makeItem(),
        actions,
        x: 40,
        y: 40,
        pending: true,
        onClose: () => callOrder.push('close'),
      },
      global: { plugins: [directives] },
    })

    const body = new DOMWrapper(document.body)
    const menu = body.get('[role="menu"]')
    expect(menu.text()).not.toContain('checking your access…')

    vi.advanceTimersByTime(200)
    await nextTick()
    expect(menu.text()).toContain('checking your access…')

    const items = menu.findAll('[role="menuitem"]')
    await items[1]!.trigger('click')
    expect(copyRun).toHaveBeenCalledTimes(1)
    expect(callOrder).toEqual(['run', 'close'])

    document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    expect(wrapper.emitted('close')).toHaveLength(2)
  })
})
