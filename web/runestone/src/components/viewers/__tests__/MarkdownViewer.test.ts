// @vitest-environment happy-dom
import { createPinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { api } from '@/api'
import MarkdownViewer from '@/components/viewers/MarkdownViewer.vue'
import { forgetTextFiles } from '@/composables/useTextStream'
import directives from '@/directives'
import type { Span } from '@/utils/marks'

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

function mockFileContent(content: string) {
  const bytes = encoder.encode(content)
  vi.mocked(api.files.readRange).mockImplementation(async (_id, start, end) => {
    return bytes.slice(start, end + 1)
  })
  return bytes.length
}

function mountViewer(props: { fileId: number; size: number; mark?: Span | null }, attach = false) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/', component: { template: '<div />' } }],
  })
  const wrapper = mount(MarkdownViewer, {
    attachTo: attach ? document.body : undefined,
    props,
    global: {
      plugins: [createPinia(), router, directives],
    },
  })
  wrappers.push(wrapper)
  return wrapper
}

beforeEach(() => {
  vi.useFakeTimers()
  forgetTextFiles()
  window.getSelection()?.removeAllRanges()
})

afterEach(() => {
  while (wrappers.length > 0) {
    wrappers.pop()?.unmount()
  }
  forgetTextFiles()
  window.getSelection()?.removeAllRanges()
  vi.useRealTimers()
})

describe('MarkdownViewer', () => {
  it('streams and renders Markdown safely with line counts and hover source jump', async () => {
    const content = ['# Investigation Report', '', 'Paragraph line three.', '', '- item five'].join(
      '\n',
    )
    const size = mockFileContent(content)

    const wrapper = mountViewer({ fileId: 101, size }, true)
    await flushPromises()
    await vi.advanceTimersByTimeAsync(20)
    await flushPromises()

    expect(wrapper.text()).toContain('5 lines')
    expect(wrapper.text()).toContain('Investigation Report')
    expect(wrapper.text()).toContain('Paragraph line three.')

    const paragraph = wrapper.get('[data-line="3"]')
    await paragraph.trigger('pointerover')
    const lineBtn = wrapper.findAll('button').find((b) => b.text().includes('line 3'))
    expect(lineBtn).toBeDefined()

    await lineBtn!.trigger('click')
    expect(wrapper.emitted('source')?.[0]).toEqual([3])

    await wrapper.get('[role="document"]').trigger('pointerleave')
    expect(wrapper.findAll('button').find((b) => b.text().includes('line 3'))).toBeUndefined()
  })

  it('shows empty state for a zero-byte Markdown file', async () => {
    vi.mocked(api.files.readRange).mockResolvedValue(new Uint8Array(0))
    const wrapper = mountViewer({ fileId: 102, size: 0 })
    await flushPromises()
    await vi.advanceTimersByTimeAsync(20)

    expect(wrapper.text()).toContain('Nothing to render: the file is empty.')
  })

  it('renders error state when range loading fails and recovers on Retry', async () => {
    const content = '# Recovered\n\nBody text.'
    const bytes = encoder.encode(content)
    vi.mocked(api.files.readRange)
      .mockRejectedValueOnce(new Error('Storage backend unreachable'))
      .mockResolvedValueOnce(bytes)

    const wrapper = mountViewer({ fileId: 103, size: bytes.length })
    await flushPromises()
    await vi.advanceTimersByTimeAsync(20)
    await flushPromises()

    expect(wrapper.text()).toContain('Storage backend unreachable')
    const retryBtn = wrapper.findAll('button').find((b) => b.text() === 'Retry')
    expect(retryBtn).toBeDefined()

    await retryBtn!.trigger('click')
    await flushPromises()
    await vi.advanceTimersByTimeAsync(20)
    await flushPromises()

    expect(wrapper.text()).toContain('Recovered')
    expect(wrapper.text()).toContain('Body text.')
  })

  it('caps rendered Markdown at RENDER_MAX and offers Show source for the remainder', async () => {
    const lineA = `# Header\n`
    const hugeLine = `${'x'.repeat(1_050_000)}\n`
    const fullText = lineA + hugeLine + hugeLine + 'Trailing unrendered line\n'
    const size = mockFileContent(fullText)

    const wrapper = mountViewer({ fileId: 104, size })
    await flushPromises()
    await vi.advanceTimersByTimeAsync(50)
    await flushPromises()

    const status = wrapper.get('[role="status"]')
    expect(status.text()).toContain('rendered up to line 2')
    expect(status.text()).toContain('2.00 MB')
    expect(status.text()).toContain('the rest is in the source')

    const showSourceBtn = status.get('button')
    expect(showSourceBtn.text()).toBe('Show source')
    await showSourceBtn.trigger('click')
    expect(wrapper.emitted('source')?.[0]).toEqual([2])
  })

  it('lands on initial marked lines, copies mark links via button or m key, and clears marks via Escape or click', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    })

    const content = ['# Line 1', '', 'Paragraph on line 3', '', 'Paragraph on line 5'].join('\n')
    const size = mockFileContent(content)

    const wrapper = mountViewer({ fileId: 105, size, mark: { from: 3, to: 5 } }, true)
    await flushPromises()
    await vi.advanceTimersByTimeAsync(100)
    await flushPromises()

    expect(wrapper.text()).toContain('lines 3–5')
    expect(wrapper.get('[data-line="3"]').attributes('data-marked')).toBeDefined()
    expect(wrapper.get('[data-line="5"]').attributes('data-marked')).toBeDefined()

    const copyBtn = wrapper.get('button[aria-label="Copy a link to lines 3–5"]')
    await copyBtn.trigger('click')
    await flushPromises()
    expect(writeText).toHaveBeenCalledTimes(1)
    expect(String(writeText.mock.calls[0]?.[0])).toContain('#L3-L5')
    expect(wrapper.text()).toContain('Copied a link to lines 3–5')

    await vi.advanceTimersByTimeAsync(2600)
    expect(wrapper.text()).not.toContain('Copied a link to lines 3–5')

    const doc = wrapper.get('[role="document"]')
    await doc.trigger('keydown', { key: 'm', ctrlKey: true })
    expect(writeText).toHaveBeenCalledTimes(1)

    await doc.trigger('keydown', { key: 'm' })
    await flushPromises()
    expect(writeText).toHaveBeenCalledTimes(2)

    await doc.trigger('keydown', { key: 'Escape' })
    expect(wrapper.emitted('update:mark')?.at(-1)).toEqual([null])

    await wrapper.setProps({ mark: { from: 1, to: 1 } })
    await doc.trigger('click')
    expect(wrapper.emitted('update:mark')?.at(-1)).toEqual([null])
  })

  it('marks whole source blocks on pointer drag selection and clears selection first on Escape', async () => {
    const content = ['# First block', '', 'Second block text', '', 'Third block text'].join('\n')
    const size = mockFileContent(content)

    const wrapper = mountViewer({ fileId: 106, size, mark: null }, true)
    await flushPromises()
    await vi.advanceTimersByTimeAsync(20)
    await flushPromises()

    const doc = wrapper.get('[role="document"]')
    const block1 = wrapper.get('[data-line="1"]').element
    const block3 = wrapper.get('[data-line="3"]').element

    await doc.trigger('pointerdown', { button: 0 })

    const sel = window.getSelection()!
    const domRange = document.createRange()
    domRange.selectNodeContents(block1)
    domRange.setEnd(block3, block3.childNodes.length)
    sel.removeAllRanges()
    sel.addRange(domRange)

    document.dispatchEvent(new PointerEvent('pointerup'))
    await flushPromises()

    expect(wrapper.emitted('update:mark')?.[0]).toEqual([{ from: 1, to: 3 }])
    await wrapper.setProps({ mark: { from: 1, to: 3 } })

    // First Escape collapses the live selection while keeping the mark
    await doc.trigger('keydown', { key: 'Escape' })
    expect(sel.isCollapsed).toBe(true)
    expect(wrapper.emitted('update:mark')).toHaveLength(1)

    // Also resolve between-blocks selection when anchorNode is the container element
    const container = block1.parentElement!
    await doc.trigger('pointerdown', { button: 0 })
    const containerRange = document.createRange()
    containerRange.setStart(container, 1)
    containerRange.setEnd(container, 2)
    sel.removeAllRanges()
    sel.addRange(containerRange)

    document.dispatchEvent(new PointerEvent('pointerup'))
    await flushPromises()
    expect(wrapper.emitted('update:mark')?.at(-1)).toEqual([{ from: 3, to: 5 }])
  })

  it('offers Show source instead of empty state when line 1 alone exceeds RENDER_MAX, and clears hover when fileId changes', async () => {
    const hugeSingleLine = 'x'.repeat(2_050_000)
    const size107 = mockFileContent(hugeSingleLine)

    const wrapper = mountViewer({ fileId: 107, size: size107 }, true)
    await flushPromises()
    await vi.advanceTimersByTimeAsync(50)
    await flushPromises()

    expect(wrapper.text()).not.toContain('Nothing to render: the file is empty.')
    const status = wrapper.get('[role="status"]')
    expect(status.text()).toContain('line 1 exceeds')
    await status.get('button').trigger('click')
    expect(wrapper.emitted('source')?.[0]).toEqual([1])

    // Switch to a normal file, hover a block, then switch fileId and confirm hover clears
    const size108 = mockFileContent('# Alpha\n\nParagraph three.')
    await wrapper.setProps({ fileId: 108, size: size108 })
    await flushPromises()
    await vi.advanceTimersByTimeAsync(20)
    await flushPromises()

    await wrapper.get('[data-line="3"]').trigger('pointerover')
    expect(wrapper.findAll('button').some((b) => b.text().includes('line 3'))).toBe(true)

    const size109 = mockFileContent('# Beta')
    await wrapper.setProps({ fileId: 109, size: size109 })
    await flushPromises()
    expect(wrapper.findAll('button').some((b) => b.text().includes('line 3'))).toBe(false)
  })

  it('finishes landing on a mark beyond RENDER_MAX once streaming ends without rendered.lines changing', async () => {
    const chunk1 = encoder.encode(`${'# Head\n\nBody\n'.repeat(100)}`)
    const chunk2 = encoder.encode('x'.repeat(1_050_000))
    const chunk3 = encoder.encode('y'.repeat(1_050_000))
    const total = chunk1.length + chunk2.length + chunk3.length
    const full = new Uint8Array(total)
    full.set(chunk1, 0)
    full.set(chunk2, chunk1.length)
    full.set(chunk3, chunk1.length + chunk2.length)

    vi.mocked(api.files.readRange).mockImplementation(async (_id, start, end) =>
      full.slice(start, end + 1),
    )

    const wrapper = mountViewer(
      { fileId: 110, size: total, mark: { from: 99999, to: 99999 } },
      true,
    )
    const docEl = wrapper.get('[role="document"]').element as HTMLElement
    vi.spyOn(docEl, 'clientHeight', 'get').mockReturnValue(300)
    const blockSpy = vi
      .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
      .mockImplementation(function (this: HTMLElement) {
        if (this.hasAttribute('data-end')) return new DOMRect(0, 600, 400, 20)
        return new DOMRect(0, 0, 400, 300)
      })

    await flushPromises()
    await vi.advanceTimersByTimeAsync(100)
    await flushPromises()

    expect(docEl.scrollTop).toBeGreaterThan(0)
    blockSpy.mockRestore()
  })
})
