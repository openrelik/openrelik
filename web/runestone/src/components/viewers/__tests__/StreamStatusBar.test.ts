// @vitest-environment happy-dom
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import StreamStatusBar from '@/components/viewers/StreamStatusBar.vue'
import { useConfirm } from '@/composables/useConfirm'
import { hideTooltip } from '@/composables/useTooltip'
import directives from '@/directives'

const wrappers: VueWrapper[] = []

function mountBar(
  overrides: Partial<{
    fileId: number
    size: number
    bytesRead: number
    reading: boolean
    capped: boolean
    error: string | null
    notice: string | null
    stopTooltip: string
  }> = {},
) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/', component: { template: '<div />' } }],
  })
  const wrapper = mount(StreamStatusBar, {
    props: {
      fileId: overrides.fileId ?? 1,
      size: overrides.size ?? 1024,
      bytesRead: overrides.bytesRead ?? 0,
      reading: overrides.reading ?? false,
      capped: overrides.capped ?? false,
      error: overrides.error ?? null,
      notice: overrides.notice ?? null,
      stopTooltip: overrides.stopTooltip ?? 'Stop reading',
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
  setActivePinia(createPinia())
})

afterEach(() => {
  useConfirm().cancel()
  while (wrappers.length > 0) {
    wrappers.pop()?.unmount()
  }
  hideTooltip()
  vi.useRealTimers()
})

describe('StreamStatusBar', () => {
  it('renders notice with priority over error, reading, and capped states', () => {
    const wrapper = mountBar({
      notice: 'Copied a link',
      error: 'Network error',
      reading: true,
      capped: true,
    })

    expect(wrapper.get('[aria-live="polite"]').text()).toBe('Copied a link')
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
  })

  it('renders error with Retry button that emits loadMore', async () => {
    const wrapper = mountBar({ error: 'Timeout', capped: true })
    expect(wrapper.get('[role="alert"]').text()).toBe('Timeout')

    await wrapper.get('button').trigger('click')
    expect(wrapper.emitted('loadMore')).toHaveLength(1)
  })

  it('delays reading indicator and emits stop when clicked', async () => {
    const wrapper = mountBar({ reading: true, bytesRead: 512, size: 1024 })
    expect(wrapper.text()).toBe('')

    await vi.advanceTimersByTimeAsync(200)
    expect(wrapper.text()).toContain('reading… 512 B of 1.02 kB')

    await wrapper.get('button').trigger('click')
    expect(wrapper.emitted('stop')).toHaveLength(1)
  })

  it('renders capped controls, emits loadAll directly under 256 MiB, and confirms past 256 MiB', async () => {
    const small = mountBar({ capped: true, bytesRead: 5_000_000, size: 10_000_000 })
    expect(small.text()).toContain('Load 5.00 MB more')

    await small.findAll('button')[0]!.trigger('click')
    expect(small.emitted('loadMore')).toHaveLength(1)

    await small.findAll('button')[1]!.trigger('click')
    expect(small.emitted('loadAll')).toHaveLength(1)
    expect(useConfirm().isOpen.value).toBe(false)

    // Past 256 MiB remaining: confirm dialog required and guarded by fileId/unmount
    const huge = mountBar({
      fileId: 10,
      capped: true,
      bytesRead: 5_000_000,
      size: 300 * 1024 * 1024,
    })
    expect(huge.text()).toContain('Load 10 MB more')

    await huge.findAll('button')[1]!.trigger('click')
    expect(useConfirm().isOpen.value).toBe(true)
    useConfirm().cancel()
    await flushPromises()
    expect(huge.emitted('loadAll')).toBeUndefined()

    await huge.findAll('button')[1]!.trigger('click')
    await huge.setProps({ fileId: 11 })
    useConfirm().accept()
    await flushPromises()
    expect(huge.emitted('loadAll')).toBeUndefined()

    await huge.findAll('button')[1]!.trigger('click')
    useConfirm().accept()
    await flushPromises()
    expect(huge.emitted('loadAll')).toHaveLength(1)
  })
})
