// @vitest-environment happy-dom
import { defineComponent, nextTick, ref } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'
import { createPinia, setActivePinia } from 'pinia'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import TableViewer from '@/components/viewers/TableViewer.vue'
import directives from '@/directives'
import { useConfirm } from '@/composables/useConfirm'
import { clearQueryCache } from '@/composables/useQueryCache'
import { hideTooltip } from '@/composables/useTooltip'
import { api } from '@/api'
import type { Span } from '@/utils/marks'
import type { TableKind } from '@/utils/preview'

vi.mock('@/api', () => ({
  api: {
    files: {
      readRange: vi.fn(),
    },
  },
  ApiError: class ApiError extends Error {
    status: number
    constructor(opts: { status: number; message: string }) {
      super(opts.message)
      this.status = opts.status
    }
  },
  errorMessage: (err: unknown, fallback: string) => (err instanceof Error ? err.message : fallback),
}))

interface MockResizeEntry {
  contentRect: { height: number }
}
type MockResizeCallback = (entries: MockResizeEntry[]) => void

const DummyRoute = defineComponent({ render: () => null })
const wrappers: VueWrapper[] = []
let sideRowTarget: HTMLDivElement | null = null
let resizeCallbacks: MockResizeCallback[] = []

function encode(text: string): Uint8Array {
  return new TextEncoder().encode(text)
}

function makeRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/', component: DummyRoute }],
  })
}

beforeEach(() => {
  vi.useFakeTimers()
  clearQueryCache()
  setActivePinia(createPinia())
  resizeCallbacks = []

  sideRowTarget = document.createElement('div')
  sideRowTarget.id = 'file-side-row'
  document.body.appendChild(sideRowTarget)

  // 240px viewport height = 10 rows at ROW_H=24
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(240)
  HTMLElement.prototype.setPointerCapture = vi.fn()
  Element.prototype.scrollTo = vi.fn()

  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(cb: MockResizeCallback) {
        resizeCallbacks.push(cb)
      }
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  )

  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText: vi.fn().mockResolvedValue(undefined) },
    configurable: true,
  })
})

afterEach(() => {
  useConfirm().cancel()
  while (wrappers.length > 0) {
    wrappers.pop()?.unmount()
  }
  sideRowTarget?.remove()
  sideRowTarget = null
  clearQueryCache()
  hideTooltip()
  vi.useRealTimers()
})

describe('TableViewer', () => {
  it('streams CSV, sniffed semicolon CSV, TSV, and JSONL (including malformed lines and >10k truncated cells)', async () => {
    const csvText = 'host,port,note\nweb-02,443,ok\nweb-01,80,fast\ndb-01,,empty\n'
    const csvBytes = encode(csvText)
    vi.mocked(api.files.readRange).mockResolvedValueOnce(csvBytes)

    const Host = defineComponent({
      components: { TableViewer },
      setup() {
        const fileId = ref(1)
        const size = ref(csvBytes.length)
        const kind = ref<TableKind>('csv')
        return { fileId, size, kind }
      },
      template: `<TableViewer :file-id="fileId" :size="size" :kind="kind" />`,
    })

    const wrapper = mount(Host, {
      global: { plugins: [createPinia(), directives, makeRouter()] },
    })
    wrappers.push(wrapper)
    await vi.advanceTimersByTimeAsync(10)

    expect(wrapper.text()).toContain('3 rows')
    expect(wrapper.text()).toContain('3 columns')
    expect(wrapper.text()).toContain('","-separated')
    const headers = wrapper.findAll('[role="columnheader"]').map((h) => h.text())
    expect(headers).toEqual(['host', 'port', 'note'])

    // Switch to semicolon-delimited CSV (sniffDelimiter -> ";"-separated)
    const semiBytes = encode('user;role\nalice;admin\n')
    vi.mocked(api.files.readRange).mockResolvedValueOnce(semiBytes)
    ;(wrapper.vm as { fileId: number; size: number }).size = semiBytes.length
    ;(wrapper.vm as { fileId: number }).fileId = 2
    await vi.advanceTimersByTimeAsync(10)
    expect(wrapper.text()).toContain('";"-separated')
    expect(wrapper.findAll('[role="columnheader"]').map((h) => h.text())).toEqual(['user', 'role'])

    // Switch to TSV -> tab-separated
    const tsvBytes = encode('pid\tcmd\n100\tinit\n')
    vi.mocked(api.files.readRange).mockResolvedValueOnce(tsvBytes)
    ;(wrapper.vm as { size: number }).size = tsvBytes.length
    ;(wrapper.vm as { kind: TableKind }).kind = 'tsv'
    ;(wrapper.vm as { fileId: number }).fileId = 3
    await vi.advanceTimersByTimeAsync(10)
    expect(wrapper.text()).toContain('tab-separated')

    // Switch to JSONL with a >10,000-char cell and a malformed JSON line
    const huge = 'X'.repeat(10_050)
    const jsonlBytes = encode(
      `${JSON.stringify({ ev: 'login', payload: huge })}\n{bad json\n${JSON.stringify({ ev: 'logout', payload: 'bye' })}\n`,
    )
    vi.mocked(api.files.readRange).mockResolvedValueOnce(jsonlBytes)
    ;(wrapper.vm as { size: number }).size = jsonlBytes.length
    ;(wrapper.vm as { kind: TableKind }).kind = 'jsonl'
    ;(wrapper.vm as { fileId: number }).fileId = 4
    await vi.advanceTimersByTimeAsync(10)

    expect(wrapper.text()).toContain('3 rows')
    expect(wrapper.text()).not.toContain('-separated')
    // Grid cell truncates >10,000 characters with an ellipsis
    expect(wrapper.get('[role="grid"]').text()).toContain(`${'X'.repeat(20)}…`)
    // Malformed row renders in danger tint
    expect(wrapper.get('[role="grid"]').text()).toContain('{bad json')
  })

  it('cycles column sort ascending -> descending -> none, sorts empty/error rows last, and resizes columns', async () => {
    const csvBytes = encode('name,score\nbeta,20\nalpha,\ngamma,5\ndelta,100\n')
    vi.mocked(api.files.readRange).mockResolvedValue(csvBytes)

    const wrapper = mount(TableViewer, {
      props: { fileId: 20, size: csvBytes.length, kind: 'csv' },
      global: { plugins: [createPinia(), directives, makeRouter()] },
    })
    wrappers.push(wrapper)
    await vi.advanceTimersByTimeAsync(10)

    const headers = wrapper.findAll('[role="columnheader"]')
    const nameHeader = headers[0]!
    const scoreHeader = headers[1]!

    const readFirstColOrder = () =>
      wrapper
        .get('[role="grid"]')
        .findAll('div.absolute')
        .map((rowEl) => rowEl.findAll('span')[1]?.text())

    expect(scoreHeader.attributes('aria-sort')).toBe('none')
    expect(readFirstColOrder()).toEqual(['beta', 'alpha', 'gamma', 'delta'])

    // 1st click on numeric `score`: ascending (5, 20, 100, then empty `alpha` last!)
    await scoreHeader.trigger('click')
    expect(scoreHeader.attributes('aria-sort')).toBe('ascending')
    expect(scoreHeader.text()).toContain('↑')
    expect(readFirstColOrder()).toEqual(['gamma', 'beta', 'delta', 'alpha'])

    // 2nd click on `score`: descending (100, 20, 5, with empty `alpha` STILL last!)
    await scoreHeader.trigger('click')
    expect(scoreHeader.attributes('aria-sort')).toBe('descending')
    expect(scoreHeader.text()).toContain('↓')
    expect(readFirstColOrder()).toEqual(['delta', 'beta', 'gamma', 'alpha'])

    // 3rd click on `score`: back to none (file order)
    await scoreHeader.trigger('click')
    expect(scoreHeader.attributes('aria-sort')).toBe('none')
    expect(readFirstColOrder()).toEqual(['beta', 'alpha', 'gamma', 'delta'])

    // Switching directly from one sorted column to another
    await scoreHeader.trigger('click')
    await nameHeader.trigger('click')
    expect(nameHeader.attributes('aria-sort')).toBe('ascending')
    expect(scoreHeader.attributes('aria-sort')).toBe('none')
    expect(readFirstColOrder()).toEqual(['alpha', 'beta', 'delta', 'gamma'])

    // Drag column resize handle on `name`
    const resizeHandle = nameHeader.get('.cursor-col-resize')
    const initialStyle = nameHeader.attributes('style')
    await resizeHandle.trigger('pointerdown', { pointerId: 1, clientX: 100 })
    await resizeHandle.trigger('pointermove', { clientX: 180 })
    await resizeHandle.trigger('pointerup')
    expect(nameHeader.attributes('style')).not.toBe(initialStyle)
  })

  it('filters rows by plain text and column:value syntax, handles empty states, and supports / and Escape in filter input', async () => {
    const jsonlBytes = encode(
      [
        JSON.stringify({ host: 'web-01', msg: 'started' }),
        JSON.stringify({ host: 'db-01', msg: 'web-01 connected' }),
        '{corrupt_entry',
      ].join('\n') + '\n',
    )
    vi.mocked(api.files.readRange).mockResolvedValue(jsonlBytes)

    const wrapper = mount(TableViewer, {
      attachTo: document.body,
      props: { fileId: 30, size: jsonlBytes.length, kind: 'jsonl' },
      global: { plugins: [createPinia(), directives, makeRouter()] },
    })
    wrappers.push(wrapper)
    await vi.advanceTimersByTimeAsync(10)

    const grid = wrapper.get('[role="grid"]')
    const filterInput = wrapper.get('input[placeholder="filter rows"]')

    // '/' key on grid focuses filter input
    await grid.trigger('keydown', { key: '/' })
    expect(document.activeElement).toBe(filterInput.element)

    // Plain text filter matches both cells and malformed raw JSON lines
    await filterInput.setValue('web-01')
    await vi.advanceTimersByTimeAsync(150)
    expect(wrapper.text()).toContain('2 of 3 rows')

    await filterInput.setValue('corrupt_entry')
    await vi.advanceTimersByTimeAsync(150)
    expect(wrapper.text()).toContain('1 of 3 rows')

    // Column-scoped filter `host:web-01` narrows strictly to `host` column (only row 1)
    await filterInput.setValue('host:web-01')
    await vi.advanceTimersByTimeAsync(150)
    expect(wrapper.text()).toContain('1 of 3 rows')

    // Unmatched filter shows empty filter message
    await filterInput.setValue('nonexistent-xyz')
    await vi.advanceTimersByTimeAsync(150)
    expect(wrapper.text()).toContain('No rows match the filter.')

    // Enter returns focus to scroller; Escape clears filterText and restores all rows
    await filterInput.trigger('keydown.enter')
    expect(document.activeElement).toBe(grid.element)

    await filterInput.trigger('keydown.esc')
    await vi.advanceTimersByTimeAsync(150)
    expect(wrapper.text()).toContain('3 rows')
    expect(wrapper.text()).not.toContain('of 3 rows')
  })

  it('opens TableDetail on row click, navigates rows via keyboard, copies rows, syncs #R marks, and toggles fullscreen', async () => {
    const rows = Array.from({ length: 15 }, (_, i) => `row-${i + 1},${(i + 1) * 10}`).join('\n')
    const csvBytes = encode(`label,val\n${rows}\n`)
    vi.mocked(api.files.readRange).mockResolvedValue(csvBytes)
    const writeText = vi.mocked(navigator.clipboard.writeText)

    const Host = defineComponent({
      components: { TableViewer },
      setup() {
        const mark = ref<Span | null>({ from: 3, to: 3 })
        const selectedEvents: boolean[] = []
        const onRowSelected = (sel: boolean) => selectedEvents.push(sel)
        return { mark, selectedEvents, onRowSelected }
      },
      template: `<TableViewer :file-id="40" :size="${csvBytes.length}" kind="csv" v-model:mark="mark" @row-selected="onRowSelected" />`,
    })

    const wrapper = mount(Host, {
      attachTo: document.body,
      global: { plugins: [createPinia(), directives, makeRouter()] },
    })
    wrappers.push(wrapper)
    await vi.advanceTimersByTimeAsync(10)
    await nextTick()

    // Incoming mark={from:3,to:3} landed on row 3 and populated TableDetail in #file-side-row
    expect(sideRowTarget?.textContent).toContain('row 3')
    expect(sideRowTarget?.textContent).toContain('row-3')
    expect((wrapper.vm as { selectedEvents: boolean[] }).selectedEvents).toContain(true)

    // Copy link button copies #R3 hash
    await wrapper.get('button[aria-label="Copy a link to row 3"]').trigger('click')
    await flushPromises()
    expect(writeText).toHaveBeenLastCalledWith(expect.stringContaining('#R3'))

    // Clicking row 0 selects row 1, updates TableDetail, and clears non-gutter mark
    const firstRowEl = wrapper.get('[role="grid"]').findAll('div.absolute')[0]!
    await firstRowEl.trigger('click')
    expect(sideRowTarget?.textContent).toContain('row 1')
    expect(sideRowTarget?.textContent).toContain('row-1')
    expect((wrapper.vm as { mark: Span | null }).mark).toBeNull()

    // Keyboard row navigation: unhandled key, ArrowDown, PageDown, End, PageUp, ArrowUp, Home
    const grid = wrapper.get('[role="grid"]')
    await grid.trigger('keydown', { key: 'z' })
    expect(sideRowTarget?.textContent).toContain('row 1')

    await grid.trigger('keydown', { key: 'ArrowDown' })
    expect(sideRowTarget?.textContent).toContain('row 2')

    await grid.trigger('keydown', { key: 'PageDown' })
    expect(sideRowTarget?.textContent).toContain('row 11')

    await grid.trigger('keydown', { key: 'End' })
    expect(sideRowTarget?.textContent).toContain('row 15')

    await grid.trigger('keydown', { key: 'PageUp' })
    expect(sideRowTarget?.textContent).toContain('row 6')

    await grid.trigger('keydown', { key: 'ArrowUp' })
    expect(sideRowTarget?.textContent).toContain('row 5')

    await grid.trigger('keydown', { key: 'Home' })
    expect(sideRowTarget?.textContent).toContain('row 1')

    // Ctrl+C copies row cells joined by tab; clipboard error shows fallback message
    await grid.trigger('keydown', { key: 'c', ctrlKey: true })
    await flushPromises()
    expect(writeText).toHaveBeenLastCalledWith('row-1\t10')
    expect(wrapper.text()).toContain('Copied the row')

    writeText.mockRejectedValueOnce(new Error('Clipboard blocked'))
    await grid.trigger('keydown', { key: 'c', metaKey: true })
    await flushPromises()
    expect(wrapper.text()).toContain('Could not copy the row')

    // Gutter click marks row 1; Escape clears cursor first (closing TableDetail), second Escape clears mark
    const gutter = wrapper.get('[data-gutter]')
    await gutter.trigger('pointerdown', { button: 0 })
    window.dispatchEvent(new PointerEvent('pointerup'))
    await nextTick()
    expect((wrapper.vm as { mark: Span | null }).mark).toEqual({ from: 1, to: 1 })

    await grid.trigger('keydown', { key: 'Escape' })
    expect(sideRowTarget?.textContent).toContain('Select a row to see it in full.')

    await grid.trigger('keydown', { key: 'Escape' })
    expect((wrapper.vm as { mark: Span | null }).mark).toBeNull()

    // Fullscreen toggle via 'f', plus Escape sequence in fullscreen (cursor -> mark -> exit fullscreen)
    await firstRowEl.trigger('click')
    await gutter.trigger('pointerdown', { button: 0 })
    window.dispatchEvent(new PointerEvent('pointerup'))
    await grid.trigger('keydown', { key: 'f' })
    await nextTick()

    expect(
      document.body.querySelector('[role="dialog"][aria-label="Table, full screen"]'),
    ).not.toBeNull()

    // 1st window Escape in fullscreen clears selected row
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await nextTick()
    expect(
      document.body.querySelector('[role="dialog"][aria-label="Table, full screen"]'),
    ).not.toBeNull()

    // 2nd window Escape clears mark
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await nextTick()
    expect((wrapper.vm as { mark: Span | null }).mark).toBeNull()
    expect(
      document.body.querySelector('[role="dialog"][aria-label="Table, full screen"]'),
    ).not.toBeNull()

    // 3rd window Escape exits fullscreen
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await nextTick()
    expect(
      document.body.querySelector('[role="dialog"][aria-label="Table, full screen"]'),
    ).toBeNull()

    // Landing on an external mark hidden by an active filter clears the filter and selects that row
    const filterInput = wrapper.get('input[placeholder="filter rows"]')
    await filterInput.setValue('row-15')
    await vi.advanceTimersByTimeAsync(150)
    expect(wrapper.text()).toContain('1 of 15 rows')
    ;(wrapper.vm as { mark: Span | null }).mark = { from: 4, to: 4 }
    await flushPromises()
    await nextTick()
    expect(wrapper.text()).toContain('15 rows')
    expect(sideRowTarget?.textContent).toContain('row 4')

    // Scroll & ResizeObserver updates
    await grid.trigger('scroll')
    resizeCallbacks[0]?.([{ contentRect: { height: 300 } }])
  })

  it('handles reading/stop indicator, capped Load more / Load full file (with >256 MiB confirmation), and stream errors', async () => {
    // 1. In-flight reading indicator + stop button + empty file state
    let resolveFirst!: (bytes: Uint8Array) => void
    vi.mocked(api.files.readRange).mockImplementationOnce(
      () =>
        new Promise<Uint8Array>((res) => {
          resolveFirst = res
        }),
    )

    const stopWrapper = mount(TableViewer, {
      props: { fileId: 50, size: 2_000_000, kind: 'csv' },
      global: { plugins: [createPinia(), directives, makeRouter()] },
    })
    wrappers.push(stopWrapper)

    vi.advanceTimersByTime(200)
    await nextTick()
    expect(stopWrapper.text()).toContain('reading…')

    // Click stop while reading -> pauses; after useDelayedFlag's 300ms hold, exposes capped controls
    const stopBtn = stopWrapper.findAll('button').find((b) => b.text() === 'stop')
    expect(stopBtn).toBeDefined()
    await stopBtn!.trigger('click')
    resolveFirst(new Uint8Array())
    await vi.advanceTimersByTimeAsync(300)
    expect(stopWrapper.text()).toContain('Load full file')

    // 2. Large file (> 256 MiB remaining) caps at 5 MB, shows sorted-partly warning, Load 10 MB more, and asks confirmation for Load full file
    const HUGE_SIZE = 300 * 1024 * 1024 // 300 MiB -> remaining > 256 MiB after 5 MiB cap
    vi.mocked(api.files.readRange).mockImplementation(async (_id, start) =>
      start === 0 ? encode('id,val\n1,a\n2,b\n') : encode('3,c\n'),
    )

    const cappedWrapper = mount(TableViewer, {
      props: { fileId: 51, size: HUGE_SIZE, kind: 'csv' },
      global: { plugins: [createPinia(), directives, makeRouter()] },
    })
    wrappers.push(cappedWrapper)
    await vi.advanceTimersByTimeAsync(50)

    expect(cappedWrapper.text()).toContain('read')
    expect(cappedWrapper.text()).toContain('Load 10 MB more')
    expect(cappedWrapper.text()).toContain('Load full file')

    // Sorting while capped warns that only rows read so far are sorted
    await cappedWrapper.findAll('[role="columnheader"]')[0]!.trigger('click')
    expect(cappedWrapper.text()).toContain('sorted: rows read so far')

    // Clicking Load 10 MB more reads additional chunks up to +10 MB
    const callsBeforeMore = vi.mocked(api.files.readRange).mock.calls.length
    const loadMoreBtn = cappedWrapper
      .findAll('button')
      .find((b) => b.text().includes('Load 10 MB more'))!
    await loadMoreBtn.trigger('click')
    await vi.advanceTimersByTimeAsync(50)
    expect(vi.mocked(api.files.readRange).mock.calls.length).toBeGreaterThan(callsBeforeMore)

    // Clicking Load full file when >256 MiB remains opens confirmation; cancel aborts, accept proceeds
    const confirm = useConfirm()
    const loadFullBtn = cappedWrapper.findAll('button').find((b) => b.text() === 'Load full file')!

    const callsBeforeCancel = vi.mocked(api.files.readRange).mock.calls.length
    await loadFullBtn.trigger('click')
    expect(confirm.isOpen.value).toBe(true)
    confirm.cancel()
    await flushPromises()
    expect(vi.mocked(api.files.readRange).mock.calls.length).toBe(callsBeforeCancel)

    await loadFullBtn.trigger('click')
    expect(confirm.isOpen.value).toBe(true)
    // Pause after accepting so we don't loop 285 chunks in the test
    vi.mocked(api.files.readRange).mockRejectedValueOnce(new Error('Stream interrupted'))
    confirm.accept()
    await vi.advanceTimersByTimeAsync(20)

    // 3. Error alert shows when readRange fails
    expect(cappedWrapper.get('[role="alert"]').text()).toBe('Stream interrupted')
  })
})
