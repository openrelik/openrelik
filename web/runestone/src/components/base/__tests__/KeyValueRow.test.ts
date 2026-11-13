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
import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import KeyValueRow from '@/components/base/KeyValueRow.vue'
import { directives } from '@/directives'

describe('KeyValueRow', () => {
  const writeText = vi.fn<(text: string) => Promise<void>>()

  beforeEach(() => {
    writeText.mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    })
  })

  it('renders label and plain value inline by default', () => {
    const wrapper = mount(KeyValueRow, {
      props: { label: 'Size', value: 4096 },
      global: { plugins: [directives] },
    })

    expect(wrapper.get('dt').text()).toBe('Size')
    expect(wrapper.get('dd').text()).toBe('4096')
    expect(wrapper.classes()).toContain('flex')

    wrapper.unmount()
  })

  it.each([
    ['undefined', undefined],
    ['empty string', ''],
  ])('renders an en-dash placeholder when value is %s', (_case, value) => {
    const wrapper = mount(KeyValueRow, {
      props: { label: 'MIME', value },
      global: { plugins: [directives] },
    })

    const placeholder = wrapper.get('dd span')
    expect(placeholder.text()).toBe('–')
    expect(placeholder.classes()).toContain('text-ink-muted')

    wrapper.unmount()
  })

  it('applies stacked layout classes when stacked is true', () => {
    const wrapper = mount(KeyValueRow, {
      props: { label: 'SHA-256', value: 'abcd1234', stacked: true },
      global: { plugins: [directives] },
    })

    expect(wrapper.classes()).toContain('py-2')
    expect(wrapper.classes()).not.toContain('flex')
    expect(wrapper.get('dd').classes()).toContain('select-all')

    wrapper.unmount()
  })

  it('copies value on click when copyable is true', async () => {
    const wrapper = mount(KeyValueRow, {
      props: { label: 'ID', value: 'file-99', copyable: true },
      global: { plugins: [directives] },
    })

    const copySpan = wrapper.get('dd span')
    await copySpan.trigger('click')

    await vi.waitFor(() => {
      expect(writeText).toHaveBeenCalledWith('file-99')
      expect(copySpan.attributes('data-copied')).toBe('true')
    })

    wrapper.unmount()
  })

  it('renders custom default slot content instead of value prop', () => {
    const wrapper = mount(KeyValueRow, {
      props: { label: 'Owner', value: 'ignored' },
      slots: { default: '<strong data-custom>analyst</strong>' },
      global: { plugins: [directives] },
    })

    expect(wrapper.get('[data-custom]').text()).toBe('analyst')
    expect(wrapper.text()).not.toContain('ignored')

    wrapper.unmount()
  })
})
