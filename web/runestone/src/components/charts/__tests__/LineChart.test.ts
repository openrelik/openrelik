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

  it('ignores non-finite and out-of-window points and picks the closest timestamp across series on hover', async () => {
    // Out-of-window and non-finite points should show the empty message and produce no NaN coordinates.
    const emptyWindowWrapper = mount(LineChart, {
      props: {
        series: [
          {
            name: 'strings',
            data: [
              [500, 9999],
              [20_000, Number.NaN],
              [30_000, Number.POSITIVE_INFINITY],
            ],
          },
        ],
        start: 1_000,
        end: 61_000,
        empty: 'Nothing in window.',
      },
      global: { plugins: [directives] },
    })
    await nextTick()
    expect(emptyWindowWrapper.text()).toContain('Nothing in window.')
    expect(emptyWindowWrapper.find('svg path').exists()).toBe(false)
    expect(emptyWindowWrapper.html()).not.toContain('NaN')
    emptyWindowWrapper.unmount()

    // Series 1 has an old point at 5_000; Series 2 has a point at 55_000.
    // Hovering near the right edge should snap the crosshair to 55_000, not 5_000.
    const wrapper = mount(LineChart, {
      props: {
        series: [
          { name: 'slow-worker', data: [[5_000, 2]] },
          {
            name: 'fast-worker',
            data: [
              [10_000, 4],
              [55_000, 10],
            ],
          },
        ],
        start: 1_000,
        end: 61_000,
      },
      global: { plugins: [directives] },
    })
    await nextTick()

    const svg = wrapper.get('svg')
    vi.spyOn(svg.element, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 600, 200))

    await svg.trigger('pointermove', { clientX: 540 })
    const tooltip = wrapper.get('div.pointer-events-none.min-w-40')
    expect(tooltip.attributes('style')).toContain('right:')

    // Shifting start/end so hoverT falls outside clears the stale crosshair reading.
    await wrapper.setProps({ start: 100_000, end: 160_000 })
    await nextTick()
    expect(wrapper.find('div.pointer-events-none.min-w-40').exists()).toBe(false)

    wrapper.unmount()
  })
})
