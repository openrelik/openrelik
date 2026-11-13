// @vitest-environment happy-dom
import { nextTick } from 'vue'
import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import CopyValue from '@/components/base/CopyValue.vue'
import { directives } from '@/directives'

describe('CopyValue', () => {
  const writeText = vi.fn<(text: string) => Promise<void>>()

  beforeEach(() => {
    vi.useFakeTimers()
    writeText.mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('renders the value in monospace with copy and check icons', () => {
    const wrapper = mount(CopyValue, {
      props: { value: 'sha256:deadbeef' },
      global: { plugins: [directives] },
    })

    expect(wrapper.text()).toBe('sha256:deadbeef')
    expect(wrapper.find('.font-mono').text()).toBe('sha256:deadbeef')
    expect(wrapper.findAll('svg')).toHaveLength(2)
    expect(wrapper.attributes('role')).toBe('button')
    expect(wrapper.attributes('tabindex')).toBe('0')

    wrapper.unmount()
  })

  it('copies the value to clipboard on click and shows transient copied state', async () => {
    const wrapper = mount(CopyValue, {
      props: { value: 'abc-123' },
      global: { plugins: [directives] },
    })

    await wrapper.trigger('click')
    await vi.waitFor(() => {
      expect(writeText).toHaveBeenCalledWith('abc-123')
      expect(wrapper.attributes('data-copied')).toBe('true')
    })

    vi.advanceTimersByTime(1500)
    await nextTick()
    expect(wrapper.attributes('data-copied')).toBeUndefined()

    wrapper.unmount()
  })

  it('copies updated prop value when triggered via Enter key', async () => {
    const wrapper = mount(CopyValue, {
      props: { value: 'initial' },
      global: { plugins: [directives] },
    })

    await wrapper.setProps({ value: 'updated-hash' })
    await wrapper.trigger('keydown', { key: 'Enter' })

    await vi.waitFor(() => {
      expect(writeText).toHaveBeenCalledWith('updated-hash')
    })

    wrapper.unmount()
  })
})
