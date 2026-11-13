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
