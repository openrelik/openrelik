// @vitest-environment happy-dom
import { createPinia, setActivePinia } from 'pinia'
import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import PromptResults from '@/components/prompt/PromptResults.vue'
import type { PromptResult } from '@/composables/usePrompt'
import { directives } from '@/directives'
import { useItemsStore } from '@/stores/items'
import type { Item } from '@/types/item'

function makeItem(overrides: Partial<Item> & Pick<Item, 'id' | 'kind' | 'name'>): Item {
  return {
    parent: null,
    owner: 'analyst',
    modified: '2026-11-10T00:00:00Z',
    ...overrides,
  }
}

describe('PromptResults', () => {
  let pinia: ReturnType<typeof createPinia>

  beforeEach(() => {
    pinia = createPinia()
    setActivePinia(pinia)
  })

  it('renders item metadata, highlights, case/remote badges, and emits hover and go', async () => {
    const itemsStore = useItemsStore()
    const folder = makeItem({ id: 1, kind: 'folder', name: 'evidence' })
    const childFile = makeItem({
      id: 10,
      kind: 'file',
      name: 'syslog.txt',
      parent: 1,
      size: 2048,
      mime: 'text/plain',
    })
    const bareFile = makeItem({ id: 11, kind: 'file', name: 'raw.bin', parent: 1 })
    const wfFolder = makeItem({ id: 2, kind: 'folder', name: 'plaso-run', workflowId: 77 })
    itemsStore.upsertItems([folder, childFile, bareFile, wfFolder])

    const results: PromptResult[] = [
      { item: folder, path: '/evidence/', label: 'evidence/', hits: [0, 1] },
      { item: wfFolder, path: '/plaso-run/', label: 'plaso-run/', hits: [] },
      { item: childFile, path: '/evidence/syslog.txt', label: 'syslog.txt', hits: [] },
      { item: bareFile, path: '/evidence/raw.bin', label: 'raw.bin', hits: [] },
      {
        item: folder,
        path: '/case/',
        label: '/case/',
        hits: [],
        caseRef: 'INC-42',
      },
      {
        item: makeItem({ id: 9, kind: 'folder', name: 'remote-dir' }),
        path: 'remote-dir',
        label: 'remote-dir/',
        hits: [],
        remote: true,
      },
    ]

    const wrapper = mount(PromptResults, {
      props: {
        results,
        index: 0,
        query: 'ev',
        cwdPath: '/cases',
        scopePath: '/cases',
        serverSearch: { searching: false, error: null, total: 4 },
      },
      global: { plugins: [pinia, directives] },
    })

    expect(wrapper.text()).toContain('6 matches in /cases')
    expect(wrapper.text()).toContain('4 folders on the server')
    expect(wrapper.text()).toContain('2 items')
    expect(wrapper.text()).toContain('workflow')
    expect(wrapper.text()).toContain('0 B')
    expect(wrapper.text()).toContain('text/plain')
    expect(wrapper.text()).toContain('case INC-42')
    expect(wrapper.text()).toContain('server')

    const options = wrapper.findAll('[role="option"]')
    expect(options).toHaveLength(6)
    expect(options[0]!.attributes('aria-selected')).toBe('true')

    await options[2]!.trigger('pointermove')
    expect(wrapper.emitted('hover')?.[0]).toEqual([2])

    await options[2]!.trigger('click')
    expect(wrapper.emitted('go')?.[0]).toEqual([results[2]])

    wrapper.unmount()
  })

  it('renders command headers for mkdir, rm, cd home, cd prev, and directory contents', () => {
    const scenarios: {
      results: PromptResult[]
      query: string
      expected: string
    }[] = [
      {
        results: [
          {
            item: null,
            path: 'logs',
            label: 'mkdir logs/',
            hits: [],
            mkdir: true,
            folderName: 'logs',
          },
        ],
        query: 'mkdir logs',
        expected: 'mkdir: create folder',
      },
      {
        results: [
          { item: null, path: 'mkdir ', label: 'mkdir: enter folder name', hits: [], mkdir: true },
        ],
        query: 'mkdir',
        expected: 'mkdir: create folder',
      },
      {
        results: [
          {
            item: makeItem({ id: 3, kind: 'folder', name: 'old' }),
            path: 'rm old',
            label: 'rm old/',
            hits: [],
            rm: true,
          },
        ],
        query: 'rm old',
        expected: 'rm: delete folder in /work',
      },
      {
        results: [{ item: null, path: '~', label: '~ (home)', hits: [], home: true }],
        query: '~',
        expected: 'cd: home',
      },
      {
        results: [{ item: null, path: '/', label: '- (~)', hits: [], prev: true }],
        query: '-',
        expected: 'cd: previous directory',
      },
      {
        results: [{ item: null, path: '..', label: '..', hits: [], up: true }],
        query: '',
        expected: 'contents of /work',
      },
    ]

    for (const scenario of scenarios) {
      const wrapper = mount(PromptResults, {
        props: {
          results: scenario.results,
          index: 0,
          query: scenario.query,
          cwdPath: '/work',
          scopePath: '/work',
        },
        global: { plugins: [pinia, directives] },
      })
      expect(wrapper.text()).toContain(scenario.expected)
      wrapper.unmount()
    }
  })

  it('renders empty states for rm, active server search, server error, and scoped fallback hint', () => {
    const rmEmpty = mount(PromptResults, {
      props: {
        results: [],
        index: 0,
        query: 'rm nope',
        cwdPath: '/cases',
        scopePath: '/cases',
      },
      global: { plugins: [pinia, directives] },
    })
    expect(rmEmpty.text()).toContain('no folder matching "nope" in /cases')
    rmEmpty.unmount()

    const searching = mount(PromptResults, {
      props: {
        results: [],
        index: 0,
        query: 'disk',
        cwdPath: '/',
        scopePath: '/',
        serverSearch: { searching: true, error: null, total: null },
      },
      global: { plugins: [pinia, directives] },
    })
    expect(searching.text()).toContain('searching server…')
    expect(searching.text()).toContain('no loaded folder matches "disk" — asking the server…')
    searching.unmount()

    const failedAndScoped = mount(PromptResults, {
      props: {
        results: [],
        index: 0,
        query: '../missing',
        cwdPath: '/cases/sub',
        scopePath: '/cases',
        serverSearch: { searching: false, error: 'Timeout', total: null },
      },
      global: { plugins: [pinia, directives] },
    })
    expect(failedAndScoped.text()).toContain('server search failed: Timeout')
    expect(failedAndScoped.text()).toContain('no match for "../missing" in /cases')
    expect(failedAndScoped.text()).toContain('/missing')
    failedAndScoped.unmount()

    // cd rm (mode: 'search') does not show rm empty-state text.
    const cdRm = mount(PromptResults, {
      props: {
        results: [],
        index: 0,
        query: 'rm',
        mode: 'search',
        cwdPath: '/cases',
        scopePath: '/cases',
      },
      global: { plugins: [pinia, directives] },
    })
    expect(cdRm.text()).toContain('no match for "rm" in /cases')
    cdRm.unmount()
  })

  it('keys same-named remote folders uniquely and shows 50+ indicator at cap', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const results: PromptResult[] = Array.from({ length: 50 }, (_, idx) => ({
      item: makeItem({ id: 100 + idx, kind: 'folder', name: 'evidence' }),
      path: 'evidence',
      label: 'evidence/',
      hits: [],
      remote: true,
    }))

    const wrapper = mount(PromptResults, {
      props: {
        results,
        index: 0,
        query: 'evidence',
        cwdPath: '/',
        scopePath: '/',
      },
      global: { plugins: [pinia, directives] },
    })
    expect(wrapper.text()).toContain('50 matches+ in /')
    expect(wrapper.findAll('[role="option"]')).toHaveLength(50)
    expect(warnSpy).not.toHaveBeenCalled()
    wrapper.unmount()
  })
})
