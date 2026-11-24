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

  it('supports size variants and decorative mode without role or tooltip label', () => {
    const wrapper = mount(UserAvatar, {
      props: { name: 'Carol', size: 'lg', decorative: true },
      global: { plugins: [directives] },
    })

    expect(wrapper.classes()).toContain('size-8')
    expect(wrapper.attributes('role')).toBeUndefined()
    expect(wrapper.attributes('aria-label')).toBeUndefined()
    expect(wrapper.attributes('aria-hidden')).toBe('true')

    wrapper.unmount()
  })

  it('colors the placeholder deterministically from uuid and omits the color when an image renders', async () => {
    const uuid = '550e8400-e29b-41d4-a716-446655440000'
    const first = mount(UserAvatar, {
      props: { name: 'Alice', uuid },
      global: { plugins: [directives] },
    })
    const second = mount(UserAvatar, {
      props: { name: 'Alice', uuid },
      global: { plugins: [directives] },
    })
    const other = mount(UserAvatar, {
      props: { name: 'Bob', uuid: '6ba7b810-9dad-11d1-80b4-00c04fd430c8' },
      global: { plugins: [directives] },
    })
    const neutral = mount(UserAvatar, {
      props: { name: 'Carol' },
      global: { plugins: [directives] },
    })

    const firstStyle = first.attributes('style')
    expect(firstStyle).toMatch(/--avatar-bg:\s*oklch\(0\.52 0\.12 \d+\)/)
    expect(second.attributes('style')).toBe(firstStyle)
    expect(other.attributes('style')).not.toBe(firstStyle)
    expect(first.classes()).toContain('border-transparent')
    expect(first.classes()).toContain('bg-(--avatar-bg)')
    expect(first.get('span > span').classes()).toContain('text-white')

    expect(neutral.attributes('style')).toBeUndefined()
    expect(neutral.classes()).toContain('bg-sunken')
    expect(neutral.get('span > span').classes()).toContain('text-ink-secondary')

    await first.setProps({ src: 'https://example.com/alice.png' })
    expect(first.find('img').exists()).toBe(true)
    expect(first.attributes('style')).toBeUndefined()

    await first.get('img').trigger('error')
    expect(first.find('img').exists()).toBe(false)
    expect(first.attributes('style')).toBe(firstStyle)

    first.unmount()
    second.unmount()
    other.unmount()
    neutral.unmount()
  })
})
