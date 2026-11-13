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

import PriorityBadge from '@/components/reports/PriorityBadge.vue'
import { directives } from '@/directives'
import { PRIORITY_TONE, type PriorityLevel } from '@/utils/report'

describe('PriorityBadge', () => {
  it.each<[number, PriorityLevel]>([
    [95, 'critical'],
    [80, 'critical'],
    [50, 'high'],
    [25, 'medium'],
    [12, 'low'],
    [5, 'info'],
  ])('maps priority %d to %s badge level and tone', (priority, expectedLevel) => {
    const wrapper = mount(PriorityBadge, {
      props: { priority },
      global: { plugins: [directives] },
    })

    expect(wrapper.text()).toBe(expectedLevel)
    for (const cls of PRIORITY_TONE[expectedLevel].split(' ')) {
      expect(wrapper.classes()).toContain(cls)
    }

    wrapper.unmount()
  })
})
