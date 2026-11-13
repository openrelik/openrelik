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
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import MetricsView from '@/views/MetricsView.vue'
import directives from '@/directives'
import { clearQueryCache } from '@/composables/useQueryCache'
import { api, ApiError, type MetricSeries } from '@/api'

vi.mock('@/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api')>()
  return {
    ...actual,
    api: {
      ...actual.api,
      metrics: {
        ...actual.api.metrics,
        tasks: vi.fn(),
      },
    },
  }
})

class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

function buildRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'folders', component: { template: '<div>Folders</div>' } },
      { path: '/metrics', name: 'metrics', component: MetricsView },
    ],
  })
}

const sampleSeries: MetricSeries[] = [
  {
    name: 'openrelik-worker-strings.tasks',
    data: [
      [Date.now() - 120_000, 3],
      [Date.now() - 60_000, 7],
    ],
  },
]

let wrapper: VueWrapper | null = null

beforeEach(() => {
  Object.defineProperty(AbortController.prototype, Symbol.toStringTag, {
    value: 'AbortController',
    configurable: true,
  })
  vi.stubGlobal('ResizeObserver', ResizeObserverStub)
  localStorage.clear()
  clearQueryCache()
  setActivePinia(createPinia())
})

afterEach(() => {
  Object.defineProperty(document, 'hidden', { value: false, configurable: true })
  Object.defineProperty(navigator, 'onLine', { value: true, configurable: true })
  wrapper?.unmount()
  wrapper = null
  document.body.innerHTML = ''
  vi.useRealTimers()
})

describe('MetricsView', () => {
  it('loads all 10 metric cards on mount and renders series charts', async () => {
    vi.mocked(api.metrics.tasks).mockResolvedValue(sampleSeries)
    const pinia = createPinia()
    setActivePinia(pinia)
    const router = buildRouter()
    await router.push('/metrics')
    await router.isReady()

    wrapper = mount(MetricsView, {
      attachTo: document.body,
      global: { plugins: [pinia, router, directives] },
    })
    await flushPromises()

    expect(api.metrics.tasks).toHaveBeenCalledTimes(10)
    expect(api.metrics.tasks).toHaveBeenCalledWith(
      {
        metric: 'celery_task_started_total',
        aggregate: true,
        range: 3600,
        step: 60,
        resolution: '1m',
      },
      expect.objectContaining({ background: false }),
    )
    expect(wrapper.findAll('section.card')).toHaveLength(10)
    expect(wrapper.text()).toContain('Total active tasks')
    expect(wrapper.text()).toContain('Tasks in queue')
  })

  it('updates step and resolution when period range changes, and supports manual Refresh and auto-refresh timer', async () => {
    vi.mocked(api.metrics.tasks).mockResolvedValue(sampleSeries)
    const pinia = createPinia()
    setActivePinia(pinia)
    const router = buildRouter()
    await router.push('/metrics')
    await router.isReady()

    wrapper = mount(MetricsView, {
      attachTo: document.body,
      global: { plugins: [pinia, router, directives] },
    })
    await flushPromises()
    vi.mocked(api.metrics.tasks).mockClear()

    const selects = wrapper.findAll('select')
    const rangeSelect = selects[0]!
    const stepSelect = selects[1]!
    const autoRefreshSelect = wrapper.get('select[aria-label="Auto-refresh"]')

    // Changing range to 300 ('Last 5 minutes') sets step to 15 ('15s') via watch(range).
    await rangeSelect.setValue('300')
    await flushPromises()

    expect((stepSelect.element as HTMLSelectElement).value).toBe('15')
    expect(api.metrics.tasks).toHaveBeenCalledWith(
      expect.objectContaining({ range: 300, step: 15, resolution: '15s' }),
      expect.anything(),
    )

    // Changing step independently updates resolution to '5m'.
    vi.mocked(api.metrics.tasks).mockClear()
    await stepSelect.setValue('300')
    await flushPromises()

    expect(api.metrics.tasks).toHaveBeenCalledWith(
      expect.objectContaining({ range: 300, step: 300, resolution: '5m' }),
      expect.anything(),
    )

    // Manual Refresh button forces a foreground reload.
    vi.mocked(api.metrics.tasks).mockClear()
    const refreshButton = wrapper
      .findAll('button')
      .find((button) => button.text().includes('Refresh'))
    expect(refreshButton).toBeDefined()
    await refreshButton!.trigger('click')
    await flushPromises()

    expect(api.metrics.tasks).toHaveBeenCalledTimes(10)
    expect(api.metrics.tasks).toHaveBeenCalledWith(
      expect.objectContaining({ range: 300, step: 300 }),
      expect.objectContaining({ background: false }),
    )

    // Enabling auto-refresh every 15 seconds triggers background reloads on interval.
    vi.useFakeTimers()
    vi.mocked(api.metrics.tasks).mockClear()
    await autoRefreshSelect.setValue('15')
    await vi.advanceTimersByTimeAsync(15_000)

    expect(api.metrics.tasks).toHaveBeenCalledTimes(10)
    expect(api.metrics.tasks).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ background: true }),
    )
  })

  it('displays error alerts when metrics fail to load and retries when Retry is clicked', async () => {
    vi.mocked(api.metrics.tasks).mockRejectedValue(
      new ApiError({ status: 502, statusText: 'Bad Gateway', message: 'Prometheus unavailable' }),
    )
    const pinia = createPinia()
    setActivePinia(pinia)
    const router = buildRouter()
    await router.push('/metrics')
    await router.isReady()

    wrapper = mount(MetricsView, {
      attachTo: document.body,
      global: { plugins: [pinia, router, directives] },
    })
    await flushPromises()

    const alerts = wrapper.findAll('[role="alert"]')
    expect(alerts).toHaveLength(10)
    expect(alerts[0]!.text()).toContain('Could not load metrics: Prometheus unavailable')

    // Retry on the first card recovers once Prometheus responds.
    vi.mocked(api.metrics.tasks).mockResolvedValue(sampleSeries)
    await alerts[0]!.get('button').trigger('click')
    await flushPromises()

    expect(wrapper.findAll('[role="alert"]')).toHaveLength(9)
  })

  it('sanitizes invalid remembered settings and skips auto-refresh while hidden or offline', async () => {
    localStorage.setItem('openrelik.metrics.range', JSON.stringify(999999))
    localStorage.setItem('openrelik.metrics.step', JSON.stringify('bad'))
    localStorage.setItem('openrelik.metrics.refresh', JSON.stringify(15))

    vi.mocked(api.metrics.tasks).mockResolvedValue(sampleSeries)
    const pinia = createPinia()
    setActivePinia(pinia)
    const router = buildRouter()
    await router.push('/metrics')
    await router.isReady()

    vi.useFakeTimers()
    wrapper = mount(MetricsView, {
      attachTo: document.body,
      global: { plugins: [pinia, router, directives] },
    })
    await flushPromises()

    expect(api.metrics.tasks).toHaveBeenCalledWith(
      expect.objectContaining({ range: 3600, step: 60, resolution: '1m' }),
      expect.anything(),
    )

    vi.mocked(api.metrics.tasks).mockClear()

    // Hidden tab skips auto-refresh ticks.
    Object.defineProperty(document, 'hidden', { value: true, configurable: true })
    await vi.advanceTimersByTimeAsync(15_000)
    expect(api.metrics.tasks).not.toHaveBeenCalled()

    // Offline skips auto-refresh ticks.
    Object.defineProperty(document, 'hidden', { value: false, configurable: true })
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true })
    await vi.advanceTimersByTimeAsync(15_000)
    expect(api.metrics.tasks).not.toHaveBeenCalled()

    // Visible and online resumes auto-refresh ticks.
    Object.defineProperty(navigator, 'onLine', { value: true, configurable: true })
    await vi.advanceTimersByTimeAsync(15_000)
    expect(api.metrics.tasks).toHaveBeenCalledTimes(10)
  })
})
