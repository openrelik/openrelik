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

import PopoverSurface from '@/components/base/PopoverSurface.vue'

describe('PopoverSurface', () => {
  it('renders standardized popover border and elevation classes with configurable tag', () => {
    const divWrapper = mount(PopoverSurface, {
      slots: { default: 'Menu body' },
    })
    expect(divWrapper.element.tagName).toBe('DIV')
    expect(divWrapper.classes()).toContain('border-border-strong')
    expect(divWrapper.classes()).toContain('shadow-(--shadow-popover)')
    expect(divWrapper.text()).toBe('Menu body')

    const ulWrapper = mount(PopoverSurface, {
      props: { as: 'ul' },
      slots: { default: '<li>One</li>' },
    })
    expect(ulWrapper.element.tagName).toBe('UL')
  })
})
