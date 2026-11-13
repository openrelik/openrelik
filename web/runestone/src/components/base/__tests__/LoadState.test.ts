// @vitest-environment happy-dom
import { nextTick } from 'vue'
import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import LoadState from '@/components/base/LoadState.vue'
import { directives } from '@/directives'
import type { QueryState } from '@/composables/useQueryCache'

function makeState(overrides: Partial<QueryState> = {}): QueryState {
  return {
    status: 'idle',
    isFetching: false,
    error: null,
    errorStatus: null,
    fetchedAt: 0,
    ...overrides,
  }
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('LoadState', () => {
  it('renders aria-busy hidden before 200ms and reveals the loading text at 200ms on initial load', async () => {
    const wrapper = mount(LoadState, {
      props: {
        state: makeState({ status: 'loading', isFetching: true }),
        noun: 'folders',
        hasContent: false,
      },
      global: { plugins: [directives] },
    })

    const busy = wrapper.get('[aria-busy="true"]')
    const label = busy.get('span')
    expect(label.text()).toBe('Loading folders…')
    expect(label.classes()).toContain('invisible')

    vi.advanceTimersByTime(199)
    await nextTick()
    expect(label.classes()).toContain('invisible')

    vi.advanceTimersByTime(1)
    await nextTick()
    expect(label.classes()).not.toContain('invisible')

    wrapper.unmount()
  })

  it('renders nothing while refreshing when cached rows are already on screen', async () => {
    const wrapper = mount(LoadState, {
      props: {
        state: makeState({ status: 'success', isFetching: true, fetchedAt: 1_000 }),
        noun: 'folders',
        hasContent: true,
      },
      global: { plugins: [directives] },
    })

    expect(wrapper.find('p').exists()).toBe(false)
    expect(wrapper.text()).toBe('')

    vi.advanceTimersByTime(500)
    await nextTick()
    expect(wrapper.find('p').exists()).toBe(false)
    expect(wrapper.text()).toBe('')

    wrapper.unmount()
  })

  it('renders role="alert" and emits retry on initial failure without content', async () => {
    const wrapper = mount(LoadState, {
      props: {
        state: makeState({ status: 'error', error: 'Timeout', isFetching: false }),
        noun: 'folders',
        hasContent: false,
      },
      global: { plugins: [directives] },
    })

    const alert = wrapper.get('[role="alert"]')
    expect(alert.text()).toContain('Could not load folders: Timeout')

    await alert.get('button').trigger('click')
    expect(wrapper.emitted('retry')).toHaveLength(1)

    wrapper.unmount()
  })

  it('renders role="status" with saved-data notice and emits retry when refresh fails', async () => {
    const wrapper = mount(LoadState, {
      props: {
        state: makeState({
          status: 'success',
          error: 'Offline',
          isFetching: false,
          fetchedAt: 1_000,
        }),
        noun: 'folders',
        hasContent: true,
      },
      global: { plugins: [directives] },
    })

    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
    const status = wrapper.get('[role="status"]')
    expect(status.text()).toContain('Could not refresh — showing saved data (Offline)')

    await status.get('button').trigger('click')
    expect(wrapper.emitted('retry')).toHaveLength(1)

    wrapper.unmount()
  })

  it('renders the empty slot when loaded with no content and no error', () => {
    const wrapper = mount(LoadState, {
      props: {
        state: makeState({ status: 'success', isFetching: false, fetchedAt: 1_000 }),
        noun: 'folders',
        hasContent: false,
      },
      slots: {
        empty: 'No folders in this workspace.',
      },
      global: { plugins: [directives] },
    })

    expect(wrapper.find('[aria-busy="true"]').exists()).toBe(false)
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
    expect(wrapper.find('[role="status"]').exists()).toBe(false)
    expect(wrapper.text()).toBe('No folders in this workspace.')

    wrapper.unmount()
  })
})
