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
import { createPinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { api } from '@/api'
import FileContent from '@/components/viewers/FileContent.vue'
import { clearQueryCache } from '@/composables/useQueryCache'
import { forgetTextFiles } from '@/composables/useTextStream'
import directives from '@/directives'
import type { Item } from '@/types/item'
import type { Mark } from '@/utils/marks'

vi.mock('@/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api')>()
  return {
    ...actual,
    api: {
      ...actual.api,
      files: {
        ...actual.api.files,
        readRange: vi.fn(),
      },
    },
  }
})

const encoder = new TextEncoder()
const wrappers: { unmount: () => void }[] = []
let sideBytesEl: HTMLDivElement | null = null
let sideRowEl: HTMLDivElement | null = null

function stubResizeObserver(height = 200) {
  class MockResizeObserver {
    private cb: ResizeObserverCallback
    constructor(cb: ResizeObserverCallback) {
      this.cb = cb
    }
    observe(target: Element) {
      this.cb(
        [{ target, contentRect: { height, width: 600 } } as unknown as ResizeObserverEntry],
        this as unknown as ResizeObserver,
      )
    }
    unobserve() {}
    disconnect() {}
  }
  vi.stubGlobal('ResizeObserver', MockResizeObserver)
}

function makeFile(overrides: Partial<Item> = {}): Item {
  return {
    id: 1,
    parent: 10,
    kind: 'file',
    name: 'sample.txt',
    owner: 'Analyst',
    modified: '2026-11-01T00:00:00Z',
    size: 24,
    mime: 'text/plain',
    ...overrides,
  }
}

function mockBytes(text: string) {
  const bytes = encoder.encode(text)
  vi.mocked(api.files.readRange).mockImplementation(async (_id, start, end) => {
    return bytes.slice(start, end + 1)
  })
  return bytes.length
}

function mountContent(
  props: {
    file: Item
    prefer?: 'rendered'
    mark?: Mark | null
  },
  endSlot = '',
) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/', component: { template: '<div />' } }],
  })
  const wrapper = mount(FileContent, {
    attachTo: document.body,
    props,
    slots: endSlot ? { end: endSlot } : undefined,
    global: {
      plugins: [createPinia(), router, directives],
    },
  })
  wrappers.push(wrapper)
  return wrapper
}

beforeEach(() => {
  vi.useFakeTimers()
  stubResizeObserver(200)
  forgetTextFiles()
  clearQueryCache()

  sideBytesEl = document.createElement('div')
  sideBytesEl.id = 'file-side-bytes'
  document.body.appendChild(sideBytesEl)

  sideRowEl = document.createElement('div')
  sideRowEl.id = 'file-side-row'
  document.body.appendChild(sideRowEl)
})

afterEach(() => {
  while (wrappers.length > 0) {
    wrappers.pop()?.unmount()
  }
  sideBytesEl?.remove()
  sideRowEl?.remove()
  sideBytesEl = null
  sideRowEl = null
  forgetTextFiles()
  clearQueryCache()
  vi.useRealTimers()
})

describe('FileContent', () => {
  it('shows waiting message and emits undefined view when MIME type is not known yet', () => {
    const wrapper = mountContent(
      { file: makeFile({ id: 10, mime: undefined, size: undefined }) },
      '<button data-test="end-btn">Toggle</button>',
    )

    expect(wrapper.text()).toContain("Waiting for the file's type…")
    expect(wrapper.find('[data-test="end-btn"]').exists()).toBe(true)
    expect(wrapper.emitted('view')?.[0]).toEqual([undefined])
  })

  it('renders single Hex title (no tablist) for binary files', async () => {
    const size = mockBytes('\x7fELF\x02\x01\x01\x00binarypayload')
    const wrapper = mountContent({
      file: makeFile({ id: 11, name: 'elf.bin', mime: 'application/octet-stream', size }),
    })
    await flushPromises()

    expect(wrapper.find('[role="tablist"]').exists()).toBe(false)
    expect(wrapper.get('h2').text()).toBe('Hex')
    expect(wrapper.emitted('view')?.[0]).toEqual(['hex'])
  })

  it('switches between Text and Hex for plain text and empty files while keeping TextViewer mounted', async () => {
    const size = mockBytes('first line\nsecond line\n')
    const wrapper = mountContent({
      file: makeFile({ id: 12, name: 'auth.log', mime: 'text/plain', size }),
    })
    await flushPromises()
    await vi.advanceTimersByTimeAsync(20)
    await flushPromises()

    const tabs = wrapper.findAll('[role="tab"]')
    expect(tabs.map((t) => t.text())).toEqual(['Text', 'Hex'])
    expect(wrapper.emitted('view')?.[0]).toEqual(['text'])
    expect(wrapper.get('[aria-label="File text"]').isVisible()).toBe(true)

    // Clicking line 1 gutter in TextViewer updates FileContent's mark model with kind: 'line'
    const gutter = wrapper.get('[data-gutter]')
    await gutter.trigger('pointerdown', { button: 0 })
    expect(wrapper.emitted('update:mark')?.at(-1)).toEqual([{ kind: 'line', from: 1, to: 1 }])

    // Switching to Hex hides TextViewer without unmounting it
    await tabs[1]!.trigger('click')
    expect(wrapper.emitted('view')?.at(-1)).toEqual(['hex'])
    expect(wrapper.get('[aria-label="File text"]').isVisible()).toBe(false)

    // Switching to an empty file resets view and handles size 0
    mockBytes('')
    await wrapper.setProps({
      file: makeFile({ id: 13, name: 'empty.txt', mime: 'text/plain', size: 0 }),
      mark: null,
    })
    await flushPromises()
    await vi.advanceTimersByTimeAsync(20)
    expect(wrapper.text()).toContain('Empty file.')
  })

  it('defaults Markdown files to Rendered, labels text tab as Source, and jumps to Source on @source', async () => {
    const size = mockBytes('# Title\n\nBody paragraph\n')
    const wrapper = mountContent({
      file: makeFile({ id: 14, name: 'README.md', mime: 'text/markdown', size }),
    })
    await flushPromises()
    await vi.advanceTimersByTimeAsync(20)
    await flushPromises()

    const tabs = wrapper.findAll('[role="tab"]')
    expect(tabs.map((t) => t.text())).toEqual(['Rendered', 'Source', 'Hex'])
    expect(wrapper.emitted('view')?.[0]).toEqual(['rendered'])

    // Hovering block 3 in MarkdownViewer and clicking its line button jumps to Source at line 3
    await wrapper.get('[data-line="3"]').trigger('pointerover')
    const lineBtn = wrapper.findAll('button').find((b) => b.text().includes('line 3'))
    expect(lineBtn).toBeDefined()
    await lineBtn!.trigger('click')
    await flushPromises()

    expect(wrapper.emitted('update:mark')?.at(-1)).toEqual([{ kind: 'line', from: 3, to: 3 }])
    expect(wrapper.emitted('view')?.at(-1)).toEqual(['text'])

    // Updating prefer='rendered' switches back to rendered Markdown
    await wrapper.setProps({ prefer: 'rendered' })
    expect(wrapper.emitted('view')?.at(-1)).toEqual(['rendered'])

    // Line marks while in rendered Markdown leave it in rendered view, while offset marks switch to Hex
    await wrapper.setProps({ mark: { kind: 'line', from: 1, to: 1 } })
    expect(tabs[0]?.attributes('aria-selected')).toBe('true')

    await wrapper.setProps({ mark: { kind: 'offset', from: 0, to: 7 } })
    expect(wrapper.emitted('view')?.at(-1)).toEqual(['hex'])
  })

  it('defaults CSV files to Table, honors deep-linked line marks and prefer prop, and forwards rowSelected', async () => {
    const size = mockBytes('ts,message\n2026-01-01,login\n2026-01-02,logout\n')
    const csvFile = makeFile({ id: 15, name: 'events.csv', mime: 'text/csv', size })

    // Deep-linked line mark opens Text instead of Table
    const linkedWrapper = mountContent({
      file: csvFile,
      mark: { kind: 'line', from: 2, to: 3 },
    })
    await flushPromises()
    expect(linkedWrapper.emitted('view')?.[0]).toEqual(['text'])

    // Changing mark kind to row switches to Table
    await linkedWrapper.setProps({ mark: { kind: 'row', from: 1, to: 1 } })
    await flushPromises()
    await vi.advanceTimersByTimeAsync(20)
    await flushPromises()
    expect(linkedWrapper.emitted('view')?.at(-1)).toEqual(['table'])

    // Clicking a table row forwards rowSelected(true) and clears rowMark
    const rowEl = linkedWrapper.get('[role="grid"]').findAll('div.absolute')[1]!
    await rowEl.trigger('click')
    expect(linkedWrapper.emitted('rowSelected')?.at(-1)).toEqual([true])
    expect(linkedWrapper.emitted('update:mark')?.at(-1)).toEqual([null])

    // If MIME changes from text/plain to binary, TextViewer unmounts rather than staying mounted
    const textSize = mockBytes('hello\n')
    const mimeWrapper = mountContent({
      file: makeFile({ id: 16, name: 'data.txt', mime: 'text/plain', size: textSize }),
    })
    await flushPromises()
    expect(mimeWrapper.find('[aria-label="File text"]').exists()).toBe(true)

    await mimeWrapper.setProps({
      file: makeFile({
        id: 16,
        name: 'data.txt',
        mime: 'application/octet-stream',
        size: textSize,
      }),
    })
    await flushPromises()
    expect(mimeWrapper.find('[aria-label="File text"]').exists()).toBe(false)
    expect(mimeWrapper.emitted('view')?.at(-1)).toEqual(['hex'])
  })
})
