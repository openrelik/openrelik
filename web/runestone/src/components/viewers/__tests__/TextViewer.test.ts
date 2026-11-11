// @vitest-environment happy-dom
import { createPinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { api } from '@/api'
import TextViewer from '@/components/viewers/TextViewer.vue'
import { useConfirm } from '@/composables/useConfirm'
import { forgetTextFiles } from '@/composables/useTextStream'
import directives from '@/directives'
import { ROW_CHARS } from '@/utils/lines'
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

class MockHighlight {
  ranges: Range[] = []
  add(range: Range) {
    this.ranges.push(range)
  }
  clear() {
    this.ranges = []
  }
}

function stubBrowserApis(height = 200) {
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
  vi.stubGlobal('Highlight', MockHighlight)
  vi.stubGlobal('CSS', { highlights: new Map<string, MockHighlight>() })
}

function mockLines(lines: string[]) {
  const content = `${lines.join('\n')}\n`
  const bytes = encoder.encode(content)
  vi.mocked(api.files.readRange).mockImplementation(async (_id, start, end) => {
    return bytes.slice(start, end + 1)
  })
  return bytes.length
}

function mountTextViewer(props: {
  fileId: number
  size: number
  active?: boolean
  mark?: Span | null
}) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/', component: { template: '<div />' } }],
  })
  const wrapper = mount(TextViewer, {
    attachTo: document.body,
    props: {
      fileId: props.fileId,
      size: props.size,
      active: props.active ?? true,
      mark: props.mark ?? null,
    },
    global: {
      plugins: [createPinia(), router, directives],
    },
  })
  wrappers.push(wrapper)
  return wrapper
}

beforeEach(() => {
  vi.useFakeTimers()
  stubBrowserApis(200)
  forgetTextFiles()
  window.getSelection()?.removeAllRanges()
})

afterEach(() => {
  useConfirm().cancel()
  while (wrappers.length > 0) {
    wrappers.pop()?.unmount()
  }
  forgetTextFiles()
  window.getSelection()?.removeAllRanges()
  vi.useRealTimers()
})

describe('TextViewer', () => {
  it('streams lines, virtualizes visible rows, wraps lines past ROW_CHARS, and scrolls via wheel, keys, and scrollbar', async () => {
    const fiftyLines = Array.from({ length: 50 }, (_, i) => `Line ${i + 1}: event record`)
    fiftyLines[0] = `A${'x'.repeat(ROW_CHARS + 50)}`
    const size = mockLines(fiftyLines)

    const wrapper = mountTextViewer({ fileId: 201, size })
    await flushPromises()
    await vi.advanceTimersByTimeAsync(20)
    await flushPromises()

    expect(wrapper.text()).toContain('50 lines')

    // 200px height / 20px row = 10 visible rows + 1 overscan = 11 rendered rows out of 51 total rows
    const renderedRows = wrapper.findAll('[data-row]')
    expect(renderedRows).toHaveLength(11)

    // Line 1 wrapped into 2 rows: row 0 shows line number "1", continuation row 1 shows blank gutter
    const gutters = wrapper.findAll('[data-gutter]')
    expect(gutters[0]?.text()).toBe('1')
    expect(gutters[1]?.text()).toBe('')
    expect(gutters[2]?.text()).toBe('2')

    const body = wrapper.get('[aria-label="File text"]')
    await body.trigger('keydown', { key: 'ArrowDown' })
    expect(wrapper.find('[data-row="1"]')?.exists()).toBe(true)

    await body.trigger('keydown', { key: 'PageDown' })
    expect(Number(wrapper.findAll('[data-row]')[0]?.attributes('data-row'))).toBeGreaterThan(5)

    await body.trigger('keydown', { key: 'End' })
    expect(wrapper.find('[data-row="50"]')?.exists()).toBe(true)

    await body.trigger('keydown', { key: 'Home' })
    expect(wrapper.find('[data-row="0"]')?.exists()).toBe(true)

    await body.trigger('keydown', { key: 'ArrowDown', ctrlKey: true })
    expect(wrapper.find('[data-row="50"]')?.exists()).toBe(true)

    await body.trigger('keydown', { key: 'ArrowUp', ctrlKey: true })
    expect(wrapper.find('[data-row="0"]')?.exists()).toBe(true)

    await body.trigger('wheel', { deltaX: 0, deltaY: 60, deltaMode: 0 })
    expect(wrapper.findAll('[data-row]')[0]?.attributes('data-row')).toBe('3')

    // Switching fileId resets scroll position to top
    const nextSize = mockLines(['Single line'])
    await wrapper.setProps({ fileId: 202, size: nextSize })
    await flushPromises()
    await vi.advanceTimersByTimeAsync(20)
    expect(wrapper.text()).toContain('1 line')
    expect(wrapper.findAll('[data-row]')[0]?.attributes('data-row')).toBe('0')
  })

  it('handles empty files, slow reading indicator with stop, read errors with Retry, and capped large files with confirmation', async () => {
    // 1. Empty file (size 0 does not need a range request)
    const emptyWrapper = mountTextViewer({ fileId: 210, size: 0 })
    await flushPromises()
    await vi.advanceTimersByTimeAsync(20)
    expect(emptyWrapper.text()).toContain('Empty file.')

    // 2. Slow reading indicator + stop button
    let resolveSlow!: (bytes: Uint8Array) => void
    vi.mocked(api.files.readRange).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveSlow = resolve
        }),
    )
    const slowWrapper = mountTextViewer({ fileId: 211, size: 1024 })
    await vi.advanceTimersByTimeAsync(250)
    expect(slowWrapper.text()).toContain('reading…')
    const stopBtn = slowWrapper.findAll('button').find((b) => b.text() === 'stop')
    expect(stopBtn).toBeDefined()
    await stopBtn!.trigger('click')
    resolveSlow(new Uint8Array(0))
    await flushPromises()

    // 3. Error + Retry
    const okBytes = encoder.encode('recovered line\n')
    vi.mocked(api.files.readRange)
      .mockRejectedValueOnce(new Error('Range read timeout'))
      .mockResolvedValueOnce(okBytes)
    const errWrapper = mountTextViewer({ fileId: 212, size: okBytes.length })
    await flushPromises()
    await vi.advanceTimersByTimeAsync(20)
    expect(errWrapper.get('[role="alert"]').text()).toContain('Range read timeout')

    const retryBtn = errWrapper.findAll('button').find((b) => b.text() === 'Retry')
    await retryBtn!.trigger('click')
    await flushPromises()
    await vi.advanceTimersByTimeAsync(20)
    expect(errWrapper.text()).toContain('recovered line')

    // 4. Huge capped file (> LOAD_ALL_ASK = 256 MiB remaining) asks for confirmation before loadAll
    const chunk = new Uint8Array(1024 * 1024).fill(65)
    chunk[chunk.length - 1] = 10
    vi.mocked(api.files.readRange).mockImplementation(async (_id, start, end) => {
      return chunk.slice(0, end - start + 1)
    })
    const hugeSize = 300 * 1024 * 1024
    const hugeWrapper = mountTextViewer({ fileId: 213, size: hugeSize })
    await flushPromises()
    await vi.advanceTimersByTimeAsync(50)
    await flushPromises()

    expect(hugeWrapper.text()).toContain('Load 10 MB more')
    const loadFullBtn = hugeWrapper.findAll('button').find((b) => b.text() === 'Load full file')
    expect(loadFullBtn).toBeDefined()

    // Cancel confirmation -> does not start reading all
    const callsBefore = vi.mocked(api.files.readRange).mock.calls.length
    await loadFullBtn!.trigger('click')
    expect(useConfirm().isOpen.value).toBe(true)
    useConfirm().cancel()
    await flushPromises()
    expect(vi.mocked(api.files.readRange).mock.calls.length).toBe(callsBefore)

    // Confirm -> triggers loadAll()
    await loadFullBtn!.trigger('click')
    useConfirm().accept()
    await flushPromises()
    expect(vi.mocked(api.files.readRange).mock.calls.length).toBeGreaterThan(callsBefore)
    hugeWrapper.unmount()
  })

  it('opens search via / or Ctrl+F, highlights hits and scrollbar ticks, navigates hits via Ctrl+G / F3, and closes on Escape', async () => {
    const lines = Array.from({ length: 40 }, (_, i) =>
      i === 2 || i === 30 ? `line ${i + 1} needle target` : `line ${i + 1} plain`,
    )
    const size = mockLines(lines)

    const wrapper = mountTextViewer({ fileId: 220, size, active: false })
    await flushPromises()
    await vi.advanceTimersByTimeAsync(20)

    const searchInput = wrapper.get('input[aria-label="Find in the file"]')

    // Ctrl+F ignored when active=false
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', ctrlKey: true, bubbles: true }))
    expect(document.activeElement).not.toBe(searchInput.element)

    // Ctrl+F focuses search input when active=true
    await wrapper.setProps({ active: true })
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', ctrlKey: true, bubbles: true }))
    expect(document.activeElement).toBe(searchInput.element)

    // Also '/' from body focuses search input
    const body = wrapper.get('[aria-label="File text"]')
    ;(body.element as HTMLElement).focus()
    await body.trigger('keydown', { key: '/' })
    expect(document.activeElement).toBe(searchInput.element)

    // Search for 'needle' -> 2 hits (line 3 and line 31)
    await searchInput.setValue('needle')
    await vi.advanceTimersByTimeAsync(200)
    await flushPromises()

    expect(wrapper.text()).toContain('1 / 2')
    expect(wrapper.find('[data-hit="current"]').exists()).toBe(true)

    // Step to second hit off-screen via Ctrl+G -> scrolls to reveal line 31
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'g', ctrlKey: true, bubbles: true }))
    await flushPromises()
    expect(wrapper.text()).toContain('2 / 2')
    expect(Number(wrapper.findAll('[data-row]')[0]?.attributes('data-row'))).toBeGreaterThan(15)

    // Step back via Shift+F3
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'F3', shiftKey: true, bubbles: true }))
    await flushPromises()
    expect(wrapper.text()).toContain('1 / 2')

    // Escape in search input clears query and returns focus to body
    await searchInput.trigger('keydown', { key: 'Escape' })
    expect((searchInput.element as HTMLInputElement).value).toBe('')
    expect(document.activeElement).toBe(body.element)
  })

  it('jumps to a line or range via : go-to input and marks invalid line numbers', async () => {
    const lines = Array.from({ length: 30 }, (_, i) => `row content ${i + 1}`)
    const size = mockLines(lines)

    const wrapper = mountTextViewer({ fileId: 230, size })
    await flushPromises()
    await vi.advanceTimersByTimeAsync(20)

    const body = wrapper.get('[aria-label="File text"]')
    const gotoInput = wrapper.get('input[placeholder="go to line"]')

    await body.trigger('keydown', { key: ':' })
    expect(document.activeElement).toBe(gotoInput.element)

    // Out-of-range line sets error state
    await gotoInput.setValue('999')
    await wrapper.get('form').trigger('submit')
    expect(gotoInput.classes()).toContain('border-danger')

    // Typing clears error; submitting valid range 22-25 marks and scrolls
    await gotoInput.trigger('input')
    expect(gotoInput.classes()).not.toContain('border-danger')

    await gotoInput.setValue('22-25')
    await wrapper.get('form').trigger('submit')
    await flushPromises()

    expect(wrapper.emitted('update:mark')?.at(-1)).toEqual([{ from: 22, to: 25 }])
    expect(Number(wrapper.findAll('[data-row]')[0]?.attributes('data-row'))).toBeGreaterThan(10)

    // Escape in gotoInput clears text and focuses body
    await gotoInput.setValue('10')
    await gotoInput.trigger('keydown', { key: 'Escape' })
    expect((gotoInput.element as HTMLInputElement).value).toBe('')
    expect(document.activeElement).toBe(body.element)
  })

  it('supports gutter click/shift-click, exact text selection, CSS highlight painting, shift-click extend, and copy link', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    })

    const size = mockLines(['alpha beta gamma', 'delta epsilon zeta', 'eta theta iota', 'kappa'])
    const wrapper = mountTextViewer({ fileId: 240, size })
    await flushPromises()
    await vi.advanceTimersByTimeAsync(20)
    await flushPromises()

    const gutters = wrapper.findAll('[data-gutter]')
    await gutters[1]!.trigger('pointerdown', { button: 0 })
    expect(wrapper.emitted('update:mark')?.at(-1)).toEqual([{ from: 2, to: 2 }])
    await wrapper.setProps({ mark: { from: 2, to: 2 } })
    expect(wrapper.text()).toContain('line 2')

    await gutters[3]!.trigger('pointerdown', { button: 0, shiftKey: true })
    expect(wrapper.emitted('update:mark')?.at(-1)).toEqual([{ from: 2, to: 4 }])
    await wrapper.setProps({ mark: { from: 2, to: 4 } })
    expect(wrapper.text()).toContain('lines 2–4')

    // Plain click in text clears whole-line mark
    const body = wrapper.get('[aria-label="File text"]')
    const row0 = wrapper.get('[data-row="0"]')
    await row0.trigger('pointerdown', { button: 0 })
    document.dispatchEvent(new PointerEvent('pointerup'))
    await row0.trigger('click')
    expect(wrapper.emitted('update:mark')?.at(-1)).toEqual([null])
    await wrapper.setProps({ mark: null })

    // Select exact text across row 0 ("alpha" -> cols 1..6) and release pointer
    const textNode0 = row0.element.querySelector('span')?.firstChild
    const row1 = wrapper.get('[data-row="1"]')
    const textNode1 = row1.element.querySelector('span')?.firstChild
    expect(textNode0).toBeTruthy()
    expect(textNode1).toBeTruthy()

    await row0.trigger('pointerdown', { button: 0 })
    const sel = window.getSelection()!
    const domRange = document.createRange()
    domRange.setStart(textNode0!, 0)
    domRange.setEnd(textNode0!, 5)
    sel.removeAllRanges()
    sel.addRange(domRange)
    document.dispatchEvent(new Event('selectionchange'))
    document.dispatchEvent(new PointerEvent('pointerup'))
    await flushPromises()

    expect(wrapper.emitted('update:mark')?.at(-1)).toEqual([
      { from: 1, fromCol: 1, to: 1, toCol: 6 },
    ])
    await wrapper.setProps({ mark: { from: 1, fromCol: 1, to: 1, toCol: 6 } })
    await flushPromises()

    // CSS.highlights 'text-mark' received the painted range
    const highlight = (CSS as unknown as { highlights: Map<string, MockHighlight> }).highlights.get(
      'text-mark',
    )
    expect(highlight?.ranges.length).toBeGreaterThan(0)

    // Press 'm' with an active multi-line selection ending at col 1 of row 1 (normalizes to end of line 1)
    const multiRange = document.createRange()
    multiRange.setStart(textNode0!, 6)
    multiRange.setEnd(textNode1!, 0)
    sel.removeAllRanges()
    sel.addRange(multiRange)
    document.dispatchEvent(new Event('selectionchange'))

    await body.trigger('keydown', { key: 'm' })
    await flushPromises()
    expect(writeText).toHaveBeenCalled()
    expect(String(writeText.mock.calls.at(-1)?.[0])).toContain('#L1C7-L1C17')
    expect(wrapper.text()).toContain('Copied a link')

    await wrapper.setProps({ mark: { from: 1, fromCol: 7, to: 1, toCol: 17 } })

    // Shift-click in text extends exact column mark using caretRangeFromPoint
    const caretRange = document.createRange()
    caretRange.setStart(textNode1!, 5)
    caretRange.setEnd(textNode1!, 5)
    ;(
      document as Document & { caretRangeFromPoint?: (x: number, y: number) => Range | null }
    ).caretRangeFromPoint = () => caretRange

    await row1.trigger('pointerdown', { button: 0, shiftKey: true, clientX: 50, clientY: 30 })
    expect(wrapper.emitted('update:mark')?.at(-1)).toEqual([
      { from: 1, fromCol: 7, to: 2, toCol: 6 },
    ])

    // Clicking the header Copy link button copies current mark link
    const copyBtn = wrapper
      .findAll('button')
      .find((b) => b.attributes('aria-label')?.startsWith('Copy a link to'))
    expect(copyBtn).toBeDefined()
    await copyBtn!.trigger('click')
    await flushPromises()
    expect(writeText).toHaveBeenCalledTimes(2)

    // Escape clears the range mark
    await body.trigger('keydown', { key: 'Escape' })
    expect(wrapper.emitted('update:mark')?.at(-1)).toEqual([null])
  })
})
