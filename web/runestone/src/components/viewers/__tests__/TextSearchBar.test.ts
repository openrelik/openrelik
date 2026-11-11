// @vitest-environment happy-dom
import { createPinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'

import TextSearchBar from '@/components/viewers/TextSearchBar.vue'
import directives from '@/directives'

interface SearchBarProps {
  query?: string
  caseSensitive?: boolean
  regex?: boolean
  count?: number
  current?: number
  overflow?: boolean
  searching?: boolean
  error?: string | null
}

const wrappers: { unmount: () => void }[] = []

function mountSearchBar(overrides: SearchBarProps = {}, attach = false) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/', component: { template: '<div />' } }],
  })
  const wrapper = mount(TextSearchBar, {
    attachTo: attach ? document.body : undefined,
    props: {
      query: overrides.query ?? '',
      caseSensitive: overrides.caseSensitive ?? false,
      regex: overrides.regex ?? false,
      count: overrides.count ?? 0,
      current: overrides.current ?? -1,
      overflow: overrides.overflow ?? false,
      searching: overrides.searching ?? false,
      error: overrides.error ?? null,
    },
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

describe('TextSearchBar', () => {
  it.each([
    {
      label: 'empty when query is blank',
      props: { query: '', count: 5, current: 0 },
      expected: '',
    },
    {
      label: 'invalid when regex error is present',
      props: { query: '[unclosed', error: 'Invalid regular expression', count: 0 },
      expected: 'invalid',
    },
    {
      label: 'ellipsis while still searching with zero hits so far',
      props: { query: 'needle', count: 0, searching: true },
      expected: '…',
    },
    {
      label: 'no hits when finished with zero matches',
      props: { query: 'needle', count: 0, searching: false },
      expected: 'no hits',
    },
    {
      label: 'dash over total when current is -1',
      props: { query: 'needle', count: 12, current: -1 },
      expected: '– / 12',
    },
    {
      label: '1-based index over formatted total with overflow plus sign',
      props: { query: 'needle', count: 10000, current: 0, overflow: true },
      expected: '1 / 10,000+',
    },
  ])('formats the match counter as $label', ({ props, expected }) => {
    const wrapper = mountSearchBar(props)
    const status = wrapper.get('[aria-live="polite"]')
    expect(status.text()).toBe(expected)

    const input = wrapper.get('input[aria-label="Find in the file"]')
    if (props.error) {
      expect(input.classes()).toContain('border-danger')
      expect(status.classes()).toContain('text-danger')
    } else {
      expect(input.classes()).not.toContain('border-danger')
    }
  })

  it('updates query, caseSensitive, and regex models on user input and toggle clicks', async () => {
    const wrapper = mountSearchBar({ query: 'init', caseSensitive: false, regex: false })

    const input = wrapper.get('input[aria-label="Find in the file"]')
    await input.setValue('updated')
    expect(wrapper.emitted('update:query')?.[0]).toEqual(['updated'])

    const caseBtn = wrapper.get('button[aria-label="Match case"]')
    const regexBtn = wrapper.get('button[aria-label="Regular expression"]')
    expect(caseBtn.attributes('aria-pressed')).toBe('false')
    expect(regexBtn.attributes('aria-pressed')).toBe('false')

    await caseBtn.trigger('click')
    expect(wrapper.emitted('update:caseSensitive')?.[0]).toEqual([true])

    await regexBtn.trigger('click')
    expect(wrapper.emitted('update:regex')?.[0]).toEqual([true])
  })

  it('renders active styling when caseSensitive and regex are enabled', () => {
    const wrapper = mountSearchBar({ query: 'a+', caseSensitive: true, regex: true })

    const caseBtn = wrapper.get('button[aria-label="Match case"]')
    const regexBtn = wrapper.get('button[aria-label="Regular expression"]')
    expect(caseBtn.attributes('aria-pressed')).toBe('true')
    expect(caseBtn.classes()).toContain('bg-brand-tint')
    expect(regexBtn.attributes('aria-pressed')).toBe('true')
    expect(regexBtn.classes()).toContain('bg-brand-tint')
  })

  it('emits next, prev, and close on Enter, Shift+Enter, Escape, and navigation buttons', async () => {
    const wrapper = mountSearchBar({ query: 'hit', count: 3, current: 0 })
    const input = wrapper.get('input[aria-label="Find in the file"]')

    await input.trigger('keydown', { key: 'a' })
    expect(wrapper.emitted('next')).toBeUndefined()
    expect(wrapper.emitted('prev')).toBeUndefined()
    expect(wrapper.emitted('close')).toBeUndefined()

    await input.trigger('keydown', { key: 'Enter' })
    expect(wrapper.emitted('next')).toHaveLength(1)

    await input.trigger('keydown', { key: 'Enter', shiftKey: true })
    expect(wrapper.emitted('prev')).toHaveLength(1)

    await input.trigger('keydown', { key: 'Escape' })
    expect(wrapper.emitted('close')).toHaveLength(1)

    const prevBtn = wrapper.get('button[aria-label="Previous hit"]')
    const nextBtn = wrapper.get('button[aria-label="Next hit"]')
    expect(prevBtn.attributes('disabled')).toBeUndefined()
    expect(nextBtn.attributes('disabled')).toBeUndefined()

    await prevBtn.trigger('click')
    await nextBtn.trigger('click')
    expect(wrapper.emitted('prev')).toHaveLength(2)
    expect(wrapper.emitted('next')).toHaveLength(2)
  })

  it('disables previous and next buttons when count is 0 and exposes focus()', () => {
    const wrapper = mountSearchBar({ query: 'none', count: 0 }, true)

    expect(wrapper.get('button[aria-label="Previous hit"]').attributes('disabled')).toBeDefined()
    expect(wrapper.get('button[aria-label="Next hit"]').attributes('disabled')).toBeDefined()

    wrapper.vm.focus()
    expect(document.activeElement).toBe(wrapper.get('input[aria-label="Find in the file"]').element)
  })
})
