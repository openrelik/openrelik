// @vitest-environment happy-dom
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import KeyHint from '@/components/base/KeyHint.vue'

describe('KeyHint', () => {
  it('renders keys in a kbd element followed by the action label', () => {
    const wrapper = mount(KeyHint, {
      props: { keys: '⌘K', label: 'open prompt' },
    })

    expect(wrapper.get('kbd').text()).toBe('⌘K')
    expect(wrapper.text()).toContain('open prompt')

    wrapper.unmount()
  })
})
