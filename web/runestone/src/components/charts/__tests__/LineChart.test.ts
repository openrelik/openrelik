// @vitest-environment happy-dom
import { nextTick } from 'vue'
import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import LineChart, { type ChartSeries } from '@/components/charts/LineChart.vue'
import { directives } from '@/directives'

describe('LineChart', () => {
  let resizeCallback: ResizeObserverCallback | null = null
  const disconnectSpy = vi.fn()

  beforeEach(() => {
    resizeCallback = null
    disconnectSpy.mockReset()

    class MockResizeObserver {
      constructor(cb: ResizeObserverCallback) {
        resizeCallback = cb
      }
      observe = vi.fn()
      unobserve = vi.fn()
      disconnect = disconnectSpy
    }

    vi.stubGlobal('ResizeObserver', MockResizeObserver)
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(600)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('renders the empty message when series have no points and ignores hover', async () => {
    const wrapper = mount(LineChart, {
      props: {
        series: [{ name: 'strings', data: [] }],
        start: 1_000,
        end: 61_000,
        empty: 'Nothing recorded.',
      },
      global: { plugins: [directives] },
    })
    await nextTick()

    expect(wrapper.text()).toContain('Nothing recorded.')
    const svg = wrapper.get('svg')
    vi.spyOn(svg.element, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 600, 200))

    await svg.trigger('pointermove', { clientX: 300 })
    expect(wrapper.find('.shadow-\\(--shadow-popover\\)').exists()).toBe(false)

    wrapper.unmount()
    expect(disconnectSpy).toHaveBeenCalledTimes(1)
  })

  it('renders a lone point as a circle and multi-point series as line and area paths', async () => {
    const series: ChartSeries[] = [
      {
        name: 'plaso',
        data: [
          [500, 99], // outside [start, end], filtered out
          [10_000, 4],
          [30_000, 12],
          [50_000, 8],
        ],
      },
      {
        name: 'yara',
        data: [[25_000, 6]],
      },
    ]

    const wrapper = mount(LineChart, {
      props: { series, start: 1_000, end: 61_000 },
      global: { plugins: [directives] },
    })
    await nextTick()

    expect(wrapper.find('p').exists()).toBe(false)
    // plaso has 2 paths (area + stroke line); yara has 1 circle dot.
    expect(wrapper.findAll('svg path')).toHaveLength(2)
    expect(wrapper.findAll('svg circle')).toHaveLength(1)

    // Trigger ResizeObserver update and verify SVG width updates.
    resizeCallback?.([{ contentRect: { width: 800 } } as ResizeObserverEntry], {} as ResizeObserver)
    await nextTick()
    expect(wrapper.get('svg').attributes('width')).toBe('800')

    // Legend toggle hides and restores a series.
    const legendButtons = wrapper.findAll('ul button')
    expect(legendButtons).toHaveLength(2)
    expect(legendButtons[0]!.attributes('aria-pressed')).toBe('true')

    await legendButtons[0]!.trigger('click')
    expect(legendButtons[0]!.attributes('aria-pressed')).toBe('false')
    expect(wrapper.findAll('svg path')).toHaveLength(0)

    await legendButtons[0]!.trigger('click')
    expect(legendButtons[0]!.attributes('aria-pressed')).toBe('true')
    expect(wrapper.findAll('svg path')).toHaveLength(2)

    wrapper.unmount()
  })

  it('shows crosshair and reading tooltip on pointermove across left/right halves and clears on leave', async () => {
    const series: ChartSeries[] = Array.from({ length: 9 }, (_, i) => ({
      name: `worker-${i + 1}`,
      data: [
        [10_000, (i + 1) * 2],
        [55_000, (i + 1) * 3],
      ],
    }))

    const wrapper = mount(LineChart, {
      props: { series, start: 1_000, end: 61_000 },
      global: { plugins: [directives] },
    })
    await nextTick()

    const svg = wrapper.get('svg')
    vi.spyOn(svg.element, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 600, 200))

    // Hover near left point -> tooltip positioned using `left:` and caps at 8 entries + "and 1 more".
    await svg.trigger('pointermove', { clientX: 120 })
    const leftTooltip = wrapper.get('div.pointer-events-none.min-w-40')
    expect(leftTooltip.attributes('style')).toContain('left:')
    expect(leftTooltip.text()).toContain('worker-9')
    expect(leftTooltip.text()).toContain('and 1 more')

    // Hover near right point -> tooltip flips to `right:`.
    await svg.trigger('pointermove', { clientX: 540 })
    const rightTooltip = wrapper.get('div.pointer-events-none.min-w-40')
    expect(rightTooltip.attributes('style')).toContain('right:')

    // Pointer outside plot bounds clears hover reading.
    await svg.trigger('pointermove', { clientX: 1 })
    expect(wrapper.find('div.pointer-events-none.min-w-40').exists()).toBe(false)

    // Re-enter then pointerleave clears reading.
    await svg.trigger('pointermove', { clientX: 120 })
    expect(wrapper.find('div.pointer-events-none.min-w-40').exists()).toBe(true)
    await svg.trigger('pointerleave')
    expect(wrapper.find('div.pointer-events-none.min-w-40').exists()).toBe(false)

    wrapper.unmount()
  })
})
