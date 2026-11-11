// @vitest-environment happy-dom
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { api, type MetricSeries } from '@/api'
import MetricCard from '@/components/metrics/MetricCard.vue'
import { clearQueryCache } from '@/composables/useQueryCache'
import { directives } from '@/directives'

describe('MetricCard', () => {
  beforeEach(() => {
    Object.defineProperty(AbortController.prototype, Symbol.toStringTag, {
      value: 'AbortController',
      configurable: true,
    })
    clearQueryCache()

    class MockResizeObserver {
      observe = vi.fn()
      unobserve = vi.fn()
      disconnect = vi.fn()
    }
    vi.stubGlobal('ResizeObserver', MockResizeObserver)
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(480)
  })

  afterEach(() => {
    clearQueryCache()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('loads metric series via query cache, shortens worker names, and reloads on refresh or prop change', async () => {
    const now = Date.now()
    const payload: MetricSeries[] = [
      {
        name: 'openrelik-worker-strings.tasks',
        data: [
          [now - 30_000, 2],
          [now - 5_000, 7],
        ],
      },
      {
        name: 'openrelik-worker-yara.tasks',
        data: [
          [now - 30_000, 1],
          [now - 5_000, 3],
        ],
      },
    ]
    const tasksSpy = vi.spyOn(api.metrics, 'tasks').mockResolvedValue(payload)

    const wrapper = mount(MetricCard, {
      props: {
        title: 'Completed tasks',
        metric: 'celery_task_succeeded_total',
        aggregate: false,
        range: 3600,
        step: 60,
        resolution: '1m',
        refresh: 0,
      },
      global: { plugins: [directives] },
    })

    await vi.waitFor(() => {
      expect(tasksSpy).toHaveBeenCalledTimes(1)
      expect(wrapper.find('svg').exists()).toBe(true)
    })
    expect(wrapper.get('h2').text()).toBe('Completed tasks')
    expect(wrapper.get('code').text()).toBe('celery_task_succeeded_total')
    expect(wrapper.text()).toContain('strings')
    expect(wrapper.text()).toContain('yara')

    // Changing aggregate updates key and header suffix.
    await wrapper.setProps({ aggregate: true })
    await flushPromises()
    expect(wrapper.get('code').text()).toBe('celery_task_succeeded_total · sum')
    expect(tasksSpy).toHaveBeenCalledTimes(2)

    // Bumping refresh forces a reload on the same key.
    await wrapper.setProps({ refresh: 1 })
    await vi.waitFor(() => {
      expect(tasksSpy).toHaveBeenCalledTimes(3)
    })

    // Reconnect event triggers useAutoRefresh callback.
    window.dispatchEvent(new Event('online'))
    await flushPromises()

    wrapper.unmount()
  })

  it('displays LoadState error on failure and retries when Retry is clicked', async () => {
    const tasksSpy = vi.spyOn(api.metrics, 'tasks').mockRejectedValueOnce(new Error('Backend down'))

    const wrapper = mount(MetricCard, {
      props: {
        title: 'Failed tasks',
        metric: 'celery_task_failed_total',
        aggregate: true,
        range: 3600,
        step: 60,
        resolution: '1m',
        refresh: 0,
      },
      global: { plugins: [directives] },
    })

    await vi.waitFor(() => {
      expect(wrapper.find('[role="alert"]').exists()).toBe(true)
    })
    const alert = wrapper.get('[role="alert"]')
    expect(alert.text()).toContain('Could not load metrics: Backend down')

    tasksSpy.mockResolvedValueOnce([])
    await alert.get('button').trigger('click')
    await vi.waitFor(() => {
      expect(tasksSpy).toHaveBeenCalledTimes(2)
      expect(wrapper.text()).toContain('No counts in this period.')
    })

    wrapper.unmount()
  })
})
