// @vitest-environment happy-dom
import { defineComponent, nextTick, ref } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'
import { createPinia, setActivePinia } from 'pinia'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import HexViewer from '@/components/viewers/HexViewer.vue'
import directives from '@/directives'
import { clearQueryCache } from '@/composables/useQueryCache'
import { hideTooltip } from '@/composables/useTooltip'
import { api } from '@/api'
import type { Span } from '@/utils/marks'

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

const DummyRoute = defineComponent({ render: () => null })
const wrappers: VueWrapper[] = []
let sideTarget: HTMLDivElement | null = null

function makeSampleBytes(length: number): Uint8Array {
  const out = new Uint8Array(length)
  // Put 'MZ\x90\x00' at 0..3 and an in-bounds pointer (0x00000060 = 96) at 4..7
  const header = [0x4d, 0x5a, 0x90, 0x00, 0x60, 0x00, 0x00, 0x00]
  for (let i = 0; i < length; i++) {
    out[i] = i < header.length ? header[i]! : 0x41 + (i % 26)
  }
  return out
}

function mockReadRangeFrom(source: Uint8Array) {
  vi.mocked(api.files.readRange).mockImplementation(async (_fileId, start, end) =>
    source.slice(start, Math.min(source.length, end + 1)),
  )
}

function makeRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/', component: DummyRoute }],
  })
}

beforeEach(() => {
  Object.defineProperty(AbortController.prototype, Symbol.toStringTag, {
    value: 'AbortController',
    configurable: true,
  })
  vi.useFakeTimers()
  clearQueryCache()
  setActivePinia(createPinia())

  sideTarget = document.createElement('div')
  sideTarget.id = 'file-side-bytes'
  document.body.appendChild(sideTarget)

  // 8 visible rows (160px / 20px row height = 8 rows = 128 bytes per viewport)
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(160)
  HTMLElement.prototype.setPointerCapture = vi.fn()

  vi.stubGlobal(
    'ResizeObserver',
    class {
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
  while (wrappers.length > 0) {
    wrappers.pop()?.unmount()
  }
  sideTarget?.remove()
  sideTarget = null
  clearQueryCache()
  hideTooltip()
  vi.useRealTimers()
})

describe('HexViewer', () => {
  it('shows delayed loading state while reading, renders hex + ASCII columns and HexInspector when resolved, and hides trailing cells on partial final rows', async () => {
    let resolveChunk!: (bytes: Uint8Array) => void
    vi.mocked(api.files.readRange).mockImplementation(
      () =>
        new Promise<Uint8Array>((res) => {
          resolveChunk = res
        }),
    )

    // 20 bytes = 1 full row (0..15) + 1 partial row (16..19, with 20..31 invisible)
    const sample = makeSampleBytes(20)
    const wrapper = mount(HexViewer, {
      props: { fileId: 10, size: 20 },
      global: { plugins: [createPinia(), directives, makeRouter()] },
    })
    wrappers.push(wrapper)

    // Unloaded cells render placeholders '··' and '·'
    expect(wrapper.text()).toContain('··')
    expect(wrapper.text()).not.toContain('reading bytes…')

    // Delayed loading label appears at 200ms
    vi.advanceTimersByTime(200)
    await nextTick()
    expect(wrapper.text()).toContain('reading bytes…')

    resolveChunk(sample)
    await flushPromises()
    vi.advanceTimersByTime(300)
    await nextTick()
    expect(wrapper.text()).not.toContain('reading bytes…')

    expect(api.files.readRange).toHaveBeenCalledWith(
      10,
      0,
      19,
      expect.objectContaining({ background: true }),
    )

    const gridText = wrapper.get('[role="grid"]').text()
    // Column headers 00..0f + offset + text
    expect(gridText).toContain('offset')
    expect(gridText).toContain('00')
    expect(gridText).toContain('0f')
    expect(gridText).toContain('text')
    // Hex bytes 4d 5a 90 00 and ASCII 'MZ··'
    expect(gridText).toContain('4d')
    expect(gridText).toContain('5a')
    expect(gridText).toContain('90')
    expect(gridText).toContain('MZ··')

    // Partial second row has invisible cells past offset 19
    const invisibleCells = wrapper.findAll('.invisible')
    expect(invisibleCells.length).toBeGreaterThan(0)

    // Teleported HexInspector rendered in #file-side-bytes
    expect(sideTarget?.textContent).toContain('uint8')
    expect(sideTarget?.textContent).toContain('77') // 0x4d = 'M' = 77
  })

  it('displays an error alert in the status bar when api.files.readRange rejects', async () => {
    vi.mocked(api.files.readRange).mockRejectedValue(new Error('Disk image offline'))

    const wrapper = mount(HexViewer, {
      props: { fileId: 11, size: 64 },
      global: { plugins: [createPinia(), directives, makeRouter()] },
    })
    wrappers.push(wrapper)

    await flushPromises()
    await nextTick()

    expect(wrapper.get('[role="alert"]').text()).toBe('Disk image offline')
  })

  it('selects byte ranges via pointer drag and shift-click across hex and ASCII columns, syncs mark, and clears mark on plain byte click', async () => {
    mockReadRangeFrom(makeSampleBytes(128))

    const Host = defineComponent({
      components: { HexViewer },
      setup() {
        const mark = ref<Span | null>(null)
        return { mark }
      },
      template: `<HexViewer :file-id="12" :size="128" v-model:mark="mark" />`,
    })

    const wrapper = mount(Host, {
      global: { plugins: [createPinia(), directives, makeRouter()] },
    })
    wrappers.push(wrapper)
    await flushPromises()

    // Find the first row's hex cells (16 spans inside the first row's hex group)
    const firstRowGroups = wrapper.find('[role="grid"]').findAll('.flex.h-5.items-center')[0]!
    const hexSpans = firstRowGroups.findAll('span.cursor-default.w-\\[2\\.5ch\\]')
    const asciiSpans = firstRowGroups.findAll('span.cursor-default.w-\\[1ch\\]')
    expect(hexSpans).toHaveLength(16)
    expect(asciiSpans).toHaveLength(16)

    // Right-click (button 2) is ignored
    await hexSpans[3]!.trigger('pointerdown', { button: 2 })
    expect(wrapper.text()).toContain('0x00000000')

    // Hovering without dragging highlights hovered byte and clears on pointerleave
    await hexSpans[4]!.trigger('pointerenter')
    expect(hexSpans[4]!.classes()).toContain('bg-sunken')
    expect(asciiSpans[4]!.classes()).toContain('bg-sunken')
    await wrapper.get('[role="grid"]').trigger('pointerleave')
    expect(hexSpans[4]!.classes()).not.toContain('bg-sunken')

    // Drag from byte 2 to byte 5 across hex -> ASCII columns
    await hexSpans[2]!.trigger('pointerdown', { button: 0 })
    await asciiSpans[5]!.trigger('pointerenter')
    window.dispatchEvent(new PointerEvent('pointerup'))
    await nextTick()

    expect(wrapper.text()).toContain('4 bytes selected')
    expect(hexSpans[2]!.classes()).toContain('bg-selection')
    expect(asciiSpans[5]!.classes()).toContain('bg-selection')
    expect((wrapper.vm as { mark: Span | null }).mark).toEqual({ from: 2, to: 5 })

    // Shift+pointerdown on byte 9 extends selection to 2..9 (8 bytes)
    await hexSpans[9]!.trigger('pointerdown', { button: 0, shiftKey: true })
    window.dispatchEvent(new PointerEvent('pointerup'))
    await nextTick()
    expect(wrapper.text()).toContain('8 bytes selected')
    expect((wrapper.vm as { mark: Span | null }).mark).toEqual({ from: 2, to: 9 })

    // Plain single-byte click (pointerdown + click on grid) collapses selection and clears mark
    await hexSpans[1]!.trigger('pointerdown', { button: 0 })
    window.dispatchEvent(new PointerEvent('pointerup'))
    await hexSpans[1]!.trigger('click')
    await nextTick()
    expect(wrapper.text()).toContain('0x00000001')
    expect(wrapper.text()).not.toContain('bytes selected')
    expect((wrapper.vm as { mark: Span | null }).mark).toBeNull()
  })

  it('supports keyboard arrow, PageDown/PageUp, Home/End, Ctrl+Home/End, Shift selection, Escape, and o shortcut', async () => {
    mockReadRangeFrom(makeSampleBytes(512))

    const Host = defineComponent({
      components: { HexViewer },
      setup() {
        const mark = ref<Span | null>(null)
        return { mark }
      },
      template: `<HexViewer :file-id="13" :size="512" v-model:mark="mark" />`,
    })

    const wrapper = mount(Host, {
      attachTo: document.body,
      global: { plugins: [createPinia(), directives, makeRouter()] },
    })
    wrappers.push(wrapper)
    await flushPromises()

    const grid = wrapper.get('[role="grid"]')

    // Unhandled key leaves cursor at 0
    await grid.trigger('keydown', { key: 'x' })
    expect(wrapper.text()).toContain('0x00000000')

    await grid.trigger('keydown', { key: 'ArrowRight' })
    expect(wrapper.text()).toContain('0x00000001')

    await grid.trigger('keydown', { key: 'ArrowLeft' })
    expect(wrapper.text()).toContain('0x00000000')

    await grid.trigger('keydown', { key: 'ArrowRight' })
    await grid.trigger('keydown', { key: 'ArrowDown' })
    expect(wrapper.text()).toContain('0x00000011')

    await grid.trigger('keydown', { key: 'End' })
    expect(wrapper.text()).toContain('0x0000001f')

    await grid.trigger('keydown', { key: 'Home' })
    expect(wrapper.text()).toContain('0x00000010')

    await grid.trigger('keydown', { key: 'ArrowUp' })
    expect(wrapper.text()).toContain('0x00000000')

    // PageDown moves by 8 visible rows * 16 = 128 (0x80)
    await grid.trigger('keydown', { key: 'PageDown' })
    expect(wrapper.text()).toContain('0x00000080')

    await grid.trigger('keydown', { key: 'PageUp' })
    expect(wrapper.text()).toContain('0x00000000')

    // Ctrl+End / Ctrl+Home and Ctrl+ArrowDown / Ctrl+ArrowUp jump to file bounds
    await grid.trigger('keydown', { key: 'End', ctrlKey: true })
    expect(wrapper.text()).toContain('0x000001ff')

    await grid.trigger('keydown', { key: 'Home', ctrlKey: true })
    expect(wrapper.text()).toContain('0x00000000')

    await grid.trigger('keydown', { key: 'ArrowDown', metaKey: true })
    expect(wrapper.text()).toContain('0x000001ff')

    await grid.trigger('keydown', { key: 'ArrowUp', metaKey: true })
    expect(wrapper.text()).toContain('0x00000000')

    // Shift+ArrowRight extends selection and keyup syncs mark
    await grid.trigger('keydown', { key: 'ArrowRight', shiftKey: true })
    await grid.trigger('keydown', { key: 'ArrowRight', shiftKey: true })
    await grid.trigger('keyup', { key: 'ArrowRight' })
    expect(wrapper.text()).toContain('3 bytes selected')
    expect((wrapper.vm as { mark: Span | null }).mark).toEqual({ from: 0, to: 2 })

    // First Escape collapses selection; second Escape clears mark
    await grid.trigger('keydown', { key: 'Escape' })
    expect(wrapper.text()).not.toContain('bytes selected')
    expect((wrapper.vm as { mark: Span | null }).mark).toEqual({ from: 0, to: 2 })

    await grid.trigger('keydown', { key: 'Escape' })
    expect((wrapper.vm as { mark: Span | null }).mark).toBeNull()

    // 'o' focuses the go-to-offset input
    await grid.trigger('keydown', { key: 'o' })
    const gotoInput = wrapper.get('input[placeholder="go to offset"]')
    expect(document.activeElement).toBe(gotoInput.element)
  })

  it('jumps to hex, decimal, and range offsets, validates invalid input, and steps back/forward through history and inspector jumps', async () => {
    mockReadRangeFrom(makeSampleBytes(512))

    const Host = defineComponent({
      components: { HexViewer },
      setup() {
        const mark = ref<Span | null>(null)
        return { mark }
      },
      template: `<HexViewer :file-id="14" :size="512" v-model:mark="mark" />`,
    })

    const wrapper = mount(Host, {
      attachTo: document.body,
      global: { plugins: [createPinia(), directives, makeRouter()] },
    })
    wrappers.push(wrapper)
    await flushPromises()

    const form = wrapper.get('form')
    const input = wrapper.get('input[placeholder="go to offset"]')
    const grid = wrapper.get('[role="grid"]')

    // Invalid offset highlights input with border-danger; typing clears error
    await input.setValue('not-hex')
    await form.trigger('submit')
    expect(input.classes()).toContain('border-danger')

    await input.trigger('input')
    expect(input.classes()).not.toContain('border-danger')

    // Out-of-bounds offset also flags error
    await input.setValue('0x9999')
    await form.trigger('submit')
    expect(input.classes()).toContain('border-danger')

    // Esc in goto input clears text and returns focus to grid
    await input.trigger('keydown.esc')
    expect((input.element as HTMLInputElement).value).toBe('')
    expect(document.activeElement).toBe(grid.element)

    // Jump to decimal offset 32 (0x20)
    await input.setValue('32')
    await form.trigger('submit')
    expect(wrapper.text()).toContain('0x00000020')
    expect((wrapper.vm as { mark: Span | null }).mark).toEqual({ from: 32, to: 32 })

    // Jump to hex range 0x40-0x4f (whole row -> marks bytes 0x40–0x4f)
    await input.setValue('0x40-0x4f')
    await form.trigger('submit')
    expect(wrapper.text()).toContain('0x00000040')
    expect((wrapper.vm as { mark: Span | null }).mark).toEqual({ from: 0x40, to: 0x4f })
    expect(wrapper.text()).toContain('bytes 0x40–0x4f marked')

    // Step back via '[' and toolbar Back button, then forward via ']' and Forward button
    await grid.trigger('keydown', { key: '[' })
    expect(wrapper.text()).toContain('0x00000020')

    const backBtn = wrapper.get('button[aria-label="Back to where the last jump left from"]')
    await backBtn.trigger('click')
    expect(wrapper.text()).toContain('0x00000000')
    expect(backBtn.attributes('disabled')).toBeDefined()

    await grid.trigger('keydown', { key: ']' })
    expect(wrapper.text()).toContain('0x00000020')

    const forwardBtn = wrapper.get('button[aria-label="Forward again"]')
    await forwardBtn.trigger('click')
    expect(wrapper.text()).toContain('0x00000040')
    expect(forwardBtn.attributes('disabled')).toBeDefined()

    // Jump from HexInspector pointer button at offset 4 (bytes 4..7 hold 0x60 = 96)
    await grid.trigger('keydown', { key: 'Home', ctrlKey: true })
    for (let i = 0; i < 4; i++) {
      await grid.trigger('keydown', { key: 'ArrowRight' })
    }
    await flushPromises()
    const inspectorJump = sideTarget?.querySelector<HTMLButtonElement>(
      'button[aria-label="Go to offset 96"]',
    )
    expect(inspectorJump).not.toBeNull()
    inspectorJump!.click()
    await nextTick()
    expect(wrapper.text()).toContain('0x00000060')
  })

  it('copies selected bytes as hex or ASCII, handles clipboard failure, and syncs #0x... byte marks and gutter clicks', async () => {
    mockReadRangeFrom(makeSampleBytes(512))
    const writeText = vi.mocked(navigator.clipboard.writeText)

    const Host = defineComponent({
      components: { HexViewer },
      setup() {
        const fileId = ref(15)
        // Start with an incoming URL mark #0x100-0x10f
        const mark = ref<Span | null>({ from: 0x100, to: 0x10f })
        return { fileId, mark }
      },
      template: `<HexViewer :file-id="fileId" :size="512" v-model:mark="mark" />`,
    })

    const wrapper = mount(Host, {
      global: { plugins: [createPinia(), directives, makeRouter()] },
    })
    wrappers.push(wrapper)
    await flushPromises()
    await nextTick()

    // External mark landed cursor at 0x00000100 and highlighted whole-row gutter
    expect(wrapper.text()).toContain('0x00000100')
    expect(wrapper.text()).toContain('bytes 0x100–0x10f marked')

    // Copy link button copies URL with #0x100-0x10f hash
    await wrapper.get('button[aria-label="Copy a link to bytes 0x100–0x10f"]').trigger('click')
    await flushPromises()
    expect(writeText).toHaveBeenLastCalledWith(expect.stringContaining('#0x100-0x10f'))
    expect(wrapper.text()).toContain('Copied a link to bytes 0x100–0x10f')

    // Jump back to 0 and select 4 bytes ('MZ\x90\x00')
    const grid = wrapper.get('[role="grid"]')
    await grid.trigger('keydown', { key: 'Home', ctrlKey: true })
    for (let i = 0; i < 3; i++) {
      await grid.trigger('keydown', { key: 'ArrowRight', shiftKey: true })
    }
    await grid.trigger('keyup', { key: 'ArrowRight' })

    // Ctrl+C copies hex
    await grid.trigger('keydown', { key: 'c', ctrlKey: true })
    await flushPromises()
    expect(writeText).toHaveBeenLastCalledWith('4d 5a 90 00')
    expect(wrapper.text()).toContain('Copied 4 bytes as hex')

    // Notice clears after 2500ms
    vi.advanceTimersByTime(2500)
    await nextTick()
    expect(wrapper.text()).not.toContain('Copied 4 bytes as hex')

    // Ctrl+Shift+C copies printable ASCII
    await grid.trigger('keydown', { key: 'C', ctrlKey: true, shiftKey: true })
    await flushPromises()
    expect(writeText).toHaveBeenLastCalledWith('MZ··')
    expect(wrapper.text()).toContain('Copied 4 bytes as text')

    // Clipboard failure shows fallback notice
    writeText.mockRejectedValueOnce(new Error('Denied'))
    await grid.trigger('keydown', { key: 'c', metaKey: true })
    await flushPromises()
    expect(wrapper.text()).toContain('Could not copy the selection')

    // Pressing 'm' marks selection, collapses selection highlight, and copies #0x0-0x3 link
    await grid.trigger('keydown', { key: 'm' })
    await flushPromises()
    expect((wrapper.vm as { mark: Span | null }).mark).toEqual({ from: 0, to: 3 })
    expect(writeText).toHaveBeenLastCalledWith(expect.stringContaining('#0x0-0x3'))

    // Gutter click marks whole row 0 (0..15), clicking again unmarks it
    const firstGutter = wrapper.get('[data-mark-from="0"]')
    await firstGutter.trigger('pointerdown', { button: 0 })
    window.dispatchEvent(new PointerEvent('pointerup'))
    await nextTick()
    expect((wrapper.vm as { mark: Span | null }).mark).toEqual({ from: 0, to: 15 })

    await firstGutter.trigger('pointerdown', { button: 0 })
    window.dispatchEvent(new PointerEvent('pointerup'))
    await nextTick()
    expect((wrapper.vm as { mark: Span | null }).mark).toBeNull()

    // Wheel scroll, scrollbar track/thumb drag, and changing fileId resets state to top
    await grid.trigger('wheel', { deltaX: 0, deltaY: 60, deltaMode: 0 })
    const thumb = wrapper.find('[aria-hidden="true"]')
    expect(thumb.exists()).toBe(true)
    const track = thumb.element.parentElement!
    track.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    await thumb.trigger('pointerdown', { pointerId: 1, clientY: 10 })
    await thumb.trigger('pointermove', { clientY: 50 })
    await thumb.trigger('pointerup')
    ;(wrapper.vm as { fileId: number }).fileId = 16
    await flushPromises()
    await nextTick()
    expect(wrapper.text()).toContain('0x00000000')
  })
})
