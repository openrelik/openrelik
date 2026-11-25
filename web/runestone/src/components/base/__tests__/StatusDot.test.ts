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

import StatusDot from '@/components/base/StatusDot.vue'

describe('StatusDot', () => {
  it.each([
    ['brand', true, 'bg-brand'],
    ['success', false, 'bg-success'],
    ['warning', true, 'bg-warning'],
    ['danger', false, 'bg-danger'],
    ['idle', false, 'bg-idle'],
  ] as const)('renders tone=%s pulse=%s with aria-hidden', (tone, pulse, bgClass) => {
    const wrapper = mount(StatusDot, { props: { tone, pulse } })
    expect(wrapper.attributes('aria-hidden')).toBe('true')
    expect(wrapper.classes()).toContain('rounded-full')
    expect(wrapper.classes()).toContain(bgClass)
    expect(wrapper.classes().includes('animate-pulse')).toBe(pulse)
  })
})
