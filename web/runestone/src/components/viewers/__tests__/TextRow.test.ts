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
import { createPinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'

import TextRow from '@/components/viewers/TextRow.vue'
import directives from '@/directives'

interface RowProps {
  row: number
  text: string
  start: number
  hits: { start: number; end: number; current: boolean }[]
}

const wrappers: { unmount: () => void }[] = []

function mountRow(props: RowProps) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/', component: { template: '<div />' } }],
  })
  const wrapper = mount(TextRow, {
    props,
    global: {
      plugins: [createPinia(), router, directives],
    },
  })
  wrappers.push(wrapper)
  return wrapper
}

afterEach(() => {
  while (wrappers.length > 0) {
    wrappers.pop()?.unmount()
  }
})

describe('TextRow', () => {
  it('renders plain text with data-row attribute and preserves tabs', () => {
    const wrapper = mountRow({
      row: 7,
      text: 'col1\tcol2  end',
      start: 0,
      hits: [],
    })

    expect(wrapper.attributes('data-row')).toBe('7')
    expect(wrapper.classes()).toContain('whitespace-pre')
    expect(wrapper.text()).toBe('col1\tcol2  end')
    expect(wrapper.findAll('[data-hit]')).toHaveLength(0)
  })

  it('highlights regular search hits and marks the current hit distinctly', () => {
    const wrapper = mountRow({
      row: 0,
      text: 'foo bar foo baz',
      start: 0,
      hits: [
        { start: 0, end: 3, current: false },
        { start: 8, end: 11, current: true },
      ],
    })

    const spans = wrapper.element.querySelectorAll('span')
    expect(spans).toHaveLength(4)

    expect(spans[0]?.textContent).toBe('foo')
    expect(spans[0]?.getAttribute('data-hit')).toBeNull()
    expect(spans[0]?.className).toContain('bg-warning-tint')
    expect(spans[0]?.className).toContain('outline-warning/60')

    expect(spans[1]?.textContent).toBe(' bar ')
    expect(spans[1]?.className).toBe('')

    expect(spans[2]?.textContent).toBe('foo')
    expect(spans[2]?.getAttribute('data-hit')).toBe('current')
    expect(spans[2]?.className).toContain('bg-warning')
    expect(spans[2]?.className).toContain('text-surface')

    expect(spans[3]?.textContent).toBe(' baz')
    expect(spans[3]?.className).toBe('')
  })

  it('slices line hits relative to non-zero row start offsets on wrapped lines', () => {
    const wrapper = mountRow({
      row: 1,
      text: 'world and match',
      start: 2000,
      hits: [
        { start: 1995, end: 2005, current: true },
        { start: 2010, end: 2015, current: false },
      ],
    })

    const spans = wrapper.element.querySelectorAll('span')
    expect(spans).toHaveLength(3)
    expect(spans[0]?.textContent).toBe('world')
    expect(spans[0]?.getAttribute('data-hit')).toBe('current')
    expect(spans[1]?.textContent).toBe(' and ')
    expect(spans[2]?.textContent).toBe('match')
    expect(spans[2]?.className).toContain('bg-warning-tint')
  })

  it('escapes control characters and renders hostile markup strictly as literal text', () => {
    const wrapper = mountRow({
      row: 2,
      text: 'null\x00cr\rlf\ndel\x7fesc\x1b<script>alert(1)</script>',
      start: 0,
      hits: [{ start: 4, end: 5, current: true }],
    })

    expect(wrapper.element.querySelectorAll('script')).toHaveLength(0)
    expect(wrapper.text()).toBe('null\\x00cr\\rlf\\ndel\\x7fesc\\x1b<script>alert(1)</script>')
    const currentHit = wrapper.get('[data-hit="current"]')
    expect(currentHit.text()).toBe('\\x00')
  })
})
