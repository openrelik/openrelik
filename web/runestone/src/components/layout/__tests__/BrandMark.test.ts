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

import BrandMark from '@/components/layout/BrandMark.vue'

describe('BrandMark', () => {
  it('renders the monochrome dark SVG mark and original light PNG mark', () => {
    const wrapper = mount(BrandMark)
    const svg = wrapper.get('svg')
    expect(svg.attributes('aria-hidden')).toBe('true')
    const maskId = svg.get('mask').attributes('id')
    expect(maskId).toBeTruthy()
    expect(svg.get('circle[mask]').attributes('mask')).toBe(`url(#${maskId})`)
    expect(svg.findAll('circle[stroke="currentColor"]')).toHaveLength(1)
    expect(svg.findAll('circle[fill="currentColor"]')).toHaveLength(2)
    expect(wrapper.get('img').attributes('src')).toBe('/logo-light-round.png')
  })
})
