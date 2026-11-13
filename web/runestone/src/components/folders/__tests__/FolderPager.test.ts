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

import FolderPager from '@/components/folders/FolderPager.vue'
import { directives } from '@/directives'

describe('FolderPager', () => {
  it('renders an empty range when total is null while first page loads', () => {
    const wrapper = mount(FolderPager, {
      props: {
        page: 1,
        lastPage: 1,
        from: 0,
        to: 0,
        total: null,
        hasPrev: false,
        hasNext: false,
      },
      global: { plugins: [directives] },
    })

    const nav = wrapper.get('nav[aria-label="Pages"]')
    const rangeSpan = nav.findAll('span')[0]!
    expect(rangeSpan.text()).toBe('')
    expect(rangeSpan.attributes('style')).toContain('width: 10ch')
    expect(nav.text()).toContain('page 1 of 1')

    const prevBtn = wrapper.get('button[aria-label="Previous page"]')
    const nextBtn = wrapper.get('button[aria-label="Next page"]')
    expect(prevBtn.attributes('disabled')).toBeDefined()
    expect(nextBtn.attributes('disabled')).toBeDefined()

    wrapper.unmount()
  })

  it('renders "no folders" when total is zero', () => {
    const wrapper = mount(FolderPager, {
      props: {
        page: 1,
        lastPage: 1,
        from: 0,
        to: 0,
        total: 0,
        hasPrev: false,
        hasNext: false,
      },
      global: { plugins: [directives] },
    })

    expect(wrapper.text()).toContain('no folders')
    expect(wrapper.text()).toContain('page 1 of 1')

    wrapper.unmount()
  })

  it('renders item range, page numbers, fixed widths, and emits prev and next', async () => {
    const wrapper = mount(FolderPager, {
      props: {
        page: 2,
        lastPage: 12,
        from: 51,
        to: 100,
        total: 580,
        hasPrev: true,
        hasNext: true,
      },
      global: { plugins: [directives] },
    })

    const spans = wrapper.findAll('nav > span, nav div > span')
    expect(spans[0]?.text()).toBe('51–100 of 580')
    expect(spans[0]?.attributes('style')).toContain('width: 14ch')
    expect(spans[1]?.text()).toBe('page 2 of 12')
    expect(spans[1]?.attributes('style')).toContain('width: 13ch')

    const prevBtn = wrapper.get('button[aria-label="Previous page"]')
    const nextBtn = wrapper.get('button[aria-label="Next page"]')
    expect(prevBtn.attributes('disabled')).toBeUndefined()
    expect(nextBtn.attributes('disabled')).toBeUndefined()

    await prevBtn.trigger('click')
    expect(wrapper.emitted('prev')).toHaveLength(1)

    await nextBtn.trigger('click')
    expect(wrapper.emitted('next')).toHaveLength(1)

    wrapper.unmount()
  })

  it('disables Previous on first page and Next on last page without emitting', async () => {
    const wrapper = mount(FolderPager, {
      props: {
        page: 1,
        lastPage: 3,
        from: 1,
        to: 50,
        total: 120,
        hasPrev: false,
        hasNext: true,
      },
      global: { plugins: [directives] },
    })

    const prevBtn = wrapper.get('button[aria-label="Previous page"]')
    const nextBtn = wrapper.get('button[aria-label="Next page"]')
    expect(prevBtn.attributes('disabled')).toBeDefined()
    expect(nextBtn.attributes('disabled')).toBeUndefined()

    await prevBtn.trigger('click')
    expect(wrapper.emitted('prev')).toBeUndefined()

    await wrapper.setProps({ page: 3, from: 101, to: 120, hasPrev: true, hasNext: false })
    expect(prevBtn.attributes('disabled')).toBeUndefined()
    expect(nextBtn.attributes('disabled')).toBeDefined()

    await nextBtn.trigger('click')
    expect(wrapper.emitted('next')).toBeUndefined()

    wrapper.unmount()
  })
})
