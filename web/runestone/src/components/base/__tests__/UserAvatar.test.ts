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
import { describe, expect, it } from 'vitest'

import UserAvatar from '@/components/base/UserAvatar.vue'
import { directives } from '@/directives'

describe('UserAvatar', () => {
  it('renders uppercase initial and owner aria-label when no picture is given', () => {
    const wrapper = mount(UserAvatar, {
      props: { name: 'alice analyst', username: 'alice' },
      global: { plugins: [directives] },
    })

    expect(wrapper.attributes('role')).toBe('img')
    expect(wrapper.attributes('aria-label')).toBe('Owner: alice')
    expect(wrapper.find('img').exists()).toBe(false)
    expect(wrapper.text()).toBe('A')

    wrapper.unmount()
  })

  it('falls back to name for aria-label and question mark when both name and username are blank', () => {
    const wrapper = mount(UserAvatar, {
      props: { name: '' },
      global: { plugins: [directives] },
    })

    expect(wrapper.attributes('aria-label')).toBe('Owner: ')
    expect(wrapper.text()).toBe('?')

    wrapper.unmount()
  })

  it('renders profile image when src is provided, falls back on load error, and retries when src changes', async () => {
    const wrapper = mount(UserAvatar, {
      props: { name: 'Bob', src: 'https://example.com/bob.png' },
      global: { plugins: [directives] },
    })

    const img = wrapper.get('img')
    expect(img.attributes('src')).toBe('https://example.com/bob.png')
    expect(img.attributes('referrerpolicy')).toBe('no-referrer')

    await img.trigger('error')
    expect(wrapper.find('img').exists()).toBe(false)
    expect(wrapper.text()).toBe('B')

    await wrapper.setProps({ src: 'https://example.com/bob-v2.png' })
    expect(wrapper.get('img').attributes('src')).toBe('https://example.com/bob-v2.png')

    wrapper.unmount()
  })
})
