// @vitest-environment happy-dom
import { nextTick } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'
import { createPinia, setActivePinia } from 'pinia'
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { api } from '@/api'
import PathBar from '@/components/layout/PathBar.vue'
import { ensureRole, forgetRoles } from '@/composables/useFolderPermissions'
import { clearQueryCache } from '@/composables/useQueryCache'
import { directives } from '@/directives'
import { useItemsStore } from '@/stores/items'
import { useModalStore } from '@/stores/modals'
import { useRootPagesStore } from '@/stores/rootPages'
import type { Item } from '@/types/item'

function makeRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'home', component: { template: '<div />' } },
      { path: '/folder/:id', name: 'folder', component: { template: '<div />' } },
      { path: '/folder/:folderId/file/:fileId', name: 'file', component: { template: '<div />' } },
    ],
  })
}

function makeItem(overrides: Partial<Item> & Pick<Item, 'id' | 'kind' | 'name'>): Item {
  return {
    parent: null,
    owner: 'analyst',
    modified: '2026-11-10T00:00:00Z',
    ...overrides,
  }
}

describe('PathBar', () => {
  let pinia: ReturnType<typeof createPinia>
  const writeText = vi.fn<(text: string) => Promise<void>>()
  const wrappers: { unmount: () => void }[] = []

  beforeEach(() => {
    Object.defineProperty(AbortController.prototype, Symbol.toStringTag, {
      value: 'AbortController',
      configurable: true,
    })
    clearQueryCache()
    forgetRoles()
    pinia = createPinia()
    setActivePinia(pinia)

    writeText.mockReset()
    writeText.mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    })

    vi.spyOn(api.folders, 'getAllFolders').mockResolvedValue({
      folders: [],
      total_count: 0,
      page: 1,
      page_size: 40,
    })
  })

  afterEach(() => {
    while (wrappers.length > 0) {
      wrappers.pop()?.unmount()
    }
    clearQueryCache()
    forgetRoles()
    vi.restoreAllMocks()
  })

  it('renders pending ellipsis when loading path, and renders breadcrumbs with copyable case badge', async () => {
    const router = makeRouter()
    await router.push('/folder/2')
    await router.isReady()

    const pendingWrapper = mount(PathBar, {
      props: { path: [], pending: true },
      global: { plugins: [pinia, router, directives] },
    })
    wrappers.push(pendingWrapper)
    expect(pendingWrapper.get('[aria-label="Loading folder path"]').text()).toBe('…')
    pendingWrapper.unmount()

    const caseRoot = makeItem({ id: 1, kind: 'folder', name: 'Case One', caseRef: 'CASE-101' })
    const evidence = makeItem({ id: 2, kind: 'folder', name: 'evidence', parent: 1 })
    const wrapper = mount(PathBar, {
      attachTo: document.body,
      props: { path: [caseRoot, evidence] },
      global: { plugins: [pinia, router, directives] },
    })
    wrappers.push(wrapper)

    expect(wrapper.text()).toContain('Case One')
    expect(wrapper.text()).toContain('evidence')
    const badge = wrapper.get('.badge')
    expect(badge.text()).toBe('CASE-101')

    await badge.trigger('click')
    await flushPromises()
    expect(writeText).toHaveBeenCalledWith('CASE-101')
  })

  it('opens separator menus, navigates entries with keyboard, and closes on Escape, click-outside, or route change', async () => {
    const router = makeRouter()
    await router.push('/folder/2')
    await router.isReady()

    const itemsStore = useItemsStore()
    const rootPagesStore = useRootPagesStore()
    const caseRoot = makeItem({ id: 1, kind: 'folder', name: 'Case One' })
    const evidence = makeItem({ id: 2, kind: 'folder', name: 'evidence', parent: 1 })
    const timeline = makeItem({
      id: 3,
      kind: 'folder',
      name: 'timeline',
      parent: 1,
      workflowId: 12,
    })
    itemsStore.upsertItems([caseRoot, evidence, timeline])
    rootPagesStore.setRootPage('folders:root:s40:p1', {
      ids: [1],
      total: 1,
      page: 1,
      size: 40,
    })

    const wrapper = mount(PathBar, {
      attachTo: document.body,
      props: { path: [caseRoot, evidence] },
      global: { plugins: [pinia, router, directives] },
    })
    wrappers.push(wrapper)

    const sep0 = wrapper.get('[data-separator="0"]')
    await sep0.trigger('click')
    await nextTick()

    const menu = wrapper.get('[role="menu"]')
    expect(menu.text()).toContain('folders in Case One/')
    expect(menu.text()).toContain('evidence/')
    expect(menu.text()).toContain('timeline/')
    expect(menu.text()).toContain('workflow')

    const menuItems = wrapper.findAll('[data-menu-item]')
    expect(menuItems).toHaveLength(2)
    expect(document.activeElement).toBe(menuItems[0]!.element)

    // Keyboard navigation inside separator menu.
    await menu.trigger('keydown', { key: 'ArrowDown' })
    expect(document.activeElement).toBe(menuItems[1]!.element)

    await menu.trigger('keydown', { key: 'k' })
    expect(document.activeElement).toBe(menuItems[0]!.element)

    await menu.trigger('keydown', { key: 'Enter' })
    await menu.trigger('keydown', { key: 'x' })
    expect(wrapper.find('[role="menu"]').exists()).toBe(true)

    await menu.trigger('keydown', { key: 'Escape' })
    expect(wrapper.find('[role="menu"]').exists()).toBe(false)
    expect(document.activeElement).toBe(sep0.element)

    // Trailing separator on leaf folder lists "(no subfolders)" and toggles closed.
    const sep1 = wrapper.get('[data-separator="1"]')
    await sep1.trigger('click')
    await nextTick()
    expect(wrapper.get('[role="menu"]').text()).toContain('(no subfolders)')

    // Outside pointerdown closes open separator menu.
    document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    await nextTick()
    expect(wrapper.find('[role="menu"]').exists()).toBe(false)

    // Route change also closes open separator menu.
    await sep1.trigger('click')
    await nextTick()
    expect(wrapper.find('[role="menu"]').exists()).toBe(true)
    await router.push('/folder/1')
    await flushPromises()
    expect(wrapper.find('[role="menu"]').exists()).toBe(false)
  })

  it('renames current folder inline when permitted and cancels on Escape or denied permission', async () => {
    const router = makeRouter()
    await router.push('/folder/2')
    await router.isReady()

    const folder = makeItem({ id: 2, kind: 'folder', name: 'evidence' })
    const mayRename = vi.fn<(item: Item) => Promise<boolean>>()

    const wrapper = mount(PathBar, {
      attachTo: document.body,
      props: { path: [folder], mayRename },
      global: { plugins: [pinia, router, directives] },
    })
    wrappers.push(wrapper)

    // Denied by mayRename -> stays button, no input.
    mayRename.mockResolvedValueOnce(false)
    await wrapper.get('button[aria-label="Rename evidence"]').trigger('click')
    await flushPromises()
    expect(wrapper.find('input[aria-label="Rename evidence"]').exists()).toBe(false)

    // Allowed -> opens input; Escape cancels without emitting.
    mayRename.mockResolvedValueOnce(true)
    await wrapper.get('button[aria-label="Rename evidence"]').trigger('click')
    await flushPromises()
    const cancelInput = wrapper.get('input[aria-label="Rename evidence"]')
    await cancelInput.setValue('discarded')
    await cancelInput.trigger('keydown', { key: 'a' })
    await cancelInput.trigger('keydown', { key: 'Escape' })
    expect(wrapper.emitted('rename')).toBeUndefined()

    // Allowed -> Enter commits trimmed new name.
    mayRename.mockResolvedValueOnce(true)
    await wrapper.get('button[aria-label="Rename evidence"]').trigger('click')
    await flushPromises()
    const renameInput = wrapper.get('input[aria-label="Rename evidence"]')
    await renameInput.setValue('  collected-logs  ')
    await renameInput.trigger('keydown', { key: 'Enter' })
    expect(wrapper.emitted('rename')?.[0]).toEqual([2, 'collected-logs'])

    // Viewer role hides rename button and renders plain span.
    vi.spyOn(api.folders, 'getMyFolderRole').mockResolvedValueOnce('Viewer')
    await ensureRole(2)
    await nextTick()
    expect(wrapper.find('button[aria-label="Rename evidence"]').exists()).toBe(false)
  })

  it('manages prompt focus, passes empty-line keys through, opens PromptResults on input, and handles two-step Escape', async () => {
    const router = makeRouter()
    await router.push('/folder/1/file/99')
    await router.isReady()

    const itemsStore = useItemsStore()
    const modalStore = useModalStore()
    const folder = makeItem({ id: 1, kind: 'folder', name: 'Case One' })
    const file = makeItem({ id: 99, kind: 'file', name: 'syslog.txt', parent: 1, size: 100 })
    itemsStore.upsertItems([folder, file])

    const wrapper = mount(PathBar, {
      attachTo: document.body,
      props: { path: [folder, file] },
      global: { plugins: [pinia, router, directives] },
    })
    wrappers.push(wrapper)

    const promptInput = wrapper.get('input[data-prompt]')
    // On a file route, prompt does NOT steal focus on arrival.
    expect(document.activeElement).not.toBe(promptInput.element)

    // Clicking bare bar background focuses the prompt input; triggerPrompt also focuses it.
    await wrapper.trigger('click')
    expect(document.activeElement).toBe(promptInput.element)
    ;(promptInput.element as HTMLInputElement).blur()
    modalStore.triggerPrompt()
    expect(document.activeElement).toBe(promptInput.element)

    // Empty line passes navigation keys (e.g. ArrowDown) through without stopping propagation.
    let propagated = false
    const onBubble = () => {
      propagated = true
    }
    window.addEventListener('keydown', onBubble)
    promptInput.element.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }),
    )
    window.removeEventListener('keydown', onBubble)
    expect(propagated).toBe(true)

    // Typing opens PromptResults dropdown; ArrowDown moves active option; first Escape clears line; second Escape blurs.
    await promptInput.trigger('focus')
    await promptInput.setValue('sys')
    await nextTick()

    expect(wrapper.find('#prompt-results').exists()).toBe(true)
    await wrapper.get('[role="option"]').trigger('pointermove')
    await promptInput.trigger('keydown', { key: 'ArrowDown' })

    await promptInput.trigger('keydown', { key: 'Escape' })
    expect((promptInput.element as HTMLInputElement).value).toBe('')
    expect(document.activeElement).toBe(promptInput.element)

    await promptInput.trigger('keydown', { key: 'Escape' })
    expect(document.activeElement).not.toBe(promptInput.element)

    // Navigating to a folder route auto-focuses the prompt on arrival.
    await router.push('/folder/1')
    await flushPromises()
    await nextTick()
    expect(document.activeElement).toBe(promptInput.element)
  })
})
