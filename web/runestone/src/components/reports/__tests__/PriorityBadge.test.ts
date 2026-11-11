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
