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
import { defineComponent, ref } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'
import { createPinia, setActivePinia } from 'pinia'
import { mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import HexInspector from '@/components/viewers/HexInspector.vue'
import directives from '@/directives'
import { hideTooltip } from '@/composables/useTooltip'
import { decodings, readings, type Reading } from '@/utils/bytes'

vi.mock('@/api', () => ({
  api: {
    files: {
      readRange: vi.fn(),
    },
  },
  errorMessage: (err: unknown, fallback: string) => (err instanceof Error ? err.message : fallback),
}))

const FIXED_NOW = Date.UTC(2026, 5, 1, 12, 0, 0)
const DummyRoute = defineComponent({ render: () => null })

const wrappers: VueWrapper[] = []

function makeRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/', component: DummyRoute }],
  })
}

function mountInspector(options: {
  selectionStart?: number
  selectionLength?: number
  width?: number
  readings?: Reading[]
  decodings?: Reading[]
  decodedLimit?: number
  last?: number
  littleEndian?: boolean
}) {
  const wrapper = mount(HexInspector, {
    props: {
      selectionStart: options.selectionStart ?? 0,
      selectionLength: options.selectionLength ?? 1,
      width: options.width ?? 8,
      readings: options.readings ?? [],
      decodings: options.decodings ?? [],
      decodedLimit: options.decodedLimit ?? 256,
      last: options.last ?? 1023,
      littleEndian: options.littleEndian ?? true,
    },
    global: {
      plugins: [createPinia(), directives, makeRouter()],
    },
  })
  wrappers.push(wrapper)
  return wrapper
}

beforeEach(() => {
  setActivePinia(createPinia())
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  )
})

afterEach(() => {
  while (wrappers.length > 0) {
    wrappers.pop()?.unmount()
  }
  hideTooltip()
})

describe('HexInspector', () => {
  it('shows single-byte cursor offset and single-byte section labels when selectionLength is 1', () => {
    const bytes = new Uint8Array([0x41])
    const wrapper = mountInspector({
      selectionStart: 0x2a,
      selectionLength: 1,
      width: 8,
      readings: readings(bytes, true, FIXED_NOW),
      decodings: decodings(bytes),
    })

    expect(wrapper.get('[aria-label="Byte inspector"]').text()).toContain('offset')
    expect(wrapper.text()).not.toContain('selection as text')
    expect(wrapper.text()).toContain('0x0000002a')
    expect(wrapper.text()).toContain('(42)')
    expect(wrapper.text()).toContain('as numbers and times')
    expect(wrapper.text()).toContain('as text')
  })

  it('shows byte range, count, and decodedLimit truncation notice for a long multi-byte selection', () => {
    const sample = new TextEncoder().encode('Hello UTF-8 🚀\n')
    const wrapper = mountInspector({
      selectionStart: 0x10,
      selectionLength: 300,
      width: 8,
      decodedLimit: 256,
      readings: readings(sample.subarray(0, 8), true, FIXED_NOW),
      decodings: decodings(sample),
    })

    expect(wrapper.text()).toContain('selection')
    expect(wrapper.text()).toContain('0x00000010–0x0000013b')
    expect(wrapper.text()).toContain('300 bytes')
    expect(wrapper.text()).toContain('its start as numbers and times')
    expect(wrapper.text()).toContain('selection as text')
    expect(wrapper.text()).toContain('(first 256 bytes)')
    expect(wrapper.text()).toContain('Hello UTF-8 🚀\\n')
  })

  it('handles empty and 2-byte short selections by showing only readings with enough bytes', () => {
    const emptyWrapper = mountInspector({
      selectionStart: 0,
      selectionLength: 0,
      readings: readings(new Uint8Array(), true, FIXED_NOW),
      decodings: decodings(new Uint8Array()),
    })

    expect(emptyWrapper.text()).not.toContain('uint8')
    // Empty decoded strings show em-dash placeholders via KeyValueRow
    expect(emptyWrapper.text()).toContain('ascii')
    expect(emptyWrapper.text()).toContain('–')

    const twoBytes = new Uint8Array([0x80, 0x01])
    const shortWrapper = mountInspector({
      selectionStart: 4,
      selectionLength: 2,
      readings: readings(twoBytes, true, FIXED_NOW),
      decodings: decodings(twoBytes),
    })

    const text = shortWrapper.text()
    expect(text).toContain('uint8')
    expect(text).toContain('128')
    expect(text).toContain('int8')
    expect(text).toContain('-128')
    expect(text).toContain('uint16')
    expect(text).toContain('384')
    expect(text).not.toContain('uint32')
    expect(text).not.toContain('uint64')
    expect(text).not.toContain('float32')
    expect(text).not.toContain('unix time')
  })

  it('decodes 8-byte integers, floats, timestamps, and text, and toggles little vs big endian', async () => {
    // 0x66015180 = 1711362432 (2024-03-25 10:27:12 UTC in little-endian uint32)
    const eightBytes = new Uint8Array([0x80, 0x51, 0x01, 0x66, 0x02, 0x00, 0x00, 0x00])
    const textBytes = new TextEncoder().encode('Café\t!')

    const Host = defineComponent({
      components: { HexInspector },
      setup() {
        const le = ref(true)
        return {
          le,
          eightBytes,
          textBytes,
          FIXED_NOW,
          readings,
          decodings,
        }
      },
      template: `
        <HexInspector
          v-model:little-endian="le"
          :selection-start="0"
          :selection-length="6"
          :width="8"
          :readings="readings(eightBytes, le, FIXED_NOW)"
          :decodings="decodings(textBytes)"
          :decoded-limit="256"
          :last="100000"
        />
      `,
    })

    const wrapper = mount(Host, {
      global: {
        plugins: [createPinia(), directives, makeRouter()],
      },
    })
    wrappers.push(wrapper)

    const [leBtn, beBtn] = wrapper.findAll('[role="group"][aria-label="Byte order"] button')
    if (!leBtn || !beBtn) throw new Error('Expected LE and BE buttons')

    expect(leBtn.attributes('aria-pressed')).toBe('true')
    expect(beBtn.attributes('aria-pressed')).toBe('false')

    // Little-endian values
    expect(wrapper.text()).toContain('uint8')
    expect(wrapper.text()).toContain('128')
    expect(wrapper.text()).toContain('int8')
    expect(wrapper.text()).toContain('-128')
    expect(wrapper.text()).toContain('uint16')
    expect(wrapper.text()).toContain('20864') // 0x5180
    expect(wrapper.text()).toContain('uint32')
    expect(wrapper.text()).toContain('1711362432') // 0x66015180
    expect(wrapper.text()).toContain('uint64')
    expect(wrapper.text()).toContain('10301297024') // (2n << 32n) | 0x66015180n
    expect(wrapper.text()).toContain('float32')
    expect(wrapper.text()).toContain('float64')
    expect(wrapper.text()).toContain('2024-03-25 10:27:12')
    expect(wrapper.text()).toContain('dos date/time')
    expect(wrapper.text()).toContain('local')
    expect(wrapper.text()).toContain('FILETIME')
    expect(wrapper.text()).toContain('webkit time')
    expect(wrapper.text()).toContain('hfs+ time')
    expect(wrapper.text()).toContain('apple time')
    // UTF-8 & ASCII decodings
    expect(wrapper.text()).toContain('Caf\\xc3\\xa9\\t!')
    expect(wrapper.text()).toContain('Café\\t!')

    // Switch to Big-Endian
    await beBtn.trigger('click')
    expect(beBtn.attributes('aria-pressed')).toBe('true')
    expect(leBtn.attributes('aria-pressed')).toBe('false')
    // Big-endian uint16 of [0x80, 0x51] = 0x8051 = 32849; uint32 of [0x80, 0x51, 0x01, 0x66] = 2152792422
    expect(wrapper.text()).toContain('32849')
    expect(wrapper.text()).toContain('2152792422')

    // Switch back to Little-Endian
    await leBtn.trigger('click')
    expect(leBtn.attributes('aria-pressed')).toBe('true')
    expect(wrapper.text()).toContain('20864')
  })

  it('flags implausible timestamps with ?, omits ? for unrepresentable dashes, and emits jump only for in-bounds offsets', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    })

    // Zero bytes: uint8=0 (in bounds for last=500), unix time=1970-01-01 (implausible -> ?), dos date/time=month 0 -> '–' (implausible, no ?)
    const zeroBytes = new Uint8Array(8)
    const computedReadings = readings(zeroBytes, true, FIXED_NOW)
    // Add an out-of-bounds integer offset to verify followable() hides jump past `last`
    const customReadings: Reading[] = [
      ...computedReadings,
      { label: 'far_ptr', value: '9999', offset: 9999 },
      { label: 'valid_ptr', value: '256', offset: 256 },
    ]

    const wrapper = mountInspector({
      selectionStart: 0,
      selectionLength: 1,
      last: 500,
      readings: customReadings,
      decodings: decodings(new Uint8Array([0x41])),
    })

    // Implausible non-dash timestamp shows '?'
    expect(wrapper.text()).toContain('1970-01-01 00:00:00')
    const warnings = wrapper.findAll('.text-warning')
    expect(warnings.length).toBeGreaterThan(0)
    expect(warnings[0]?.text()).toBe('?')

    // Unrepresentable DOS date '–' does not append '?' right beside it
    const dosRow = wrapper
      .findAll('div')
      .find((el) => el.find('dt').exists() && el.find('dt').text() === 'dos date/time')
    expect(dosRow?.text()).toContain('–')
    expect(dosRow?.text()).toContain('local')
    expect(dosRow?.find('.text-warning').exists()).toBe(false)

    // In-bounds offset has jump button; out-of-bounds does not
    const jumpValid = wrapper.find('button[aria-label="Go to offset 256"]')
    expect(jumpValid.exists()).toBe(true)
    expect(wrapper.find('button[aria-label="Go to offset 9999"]').exists()).toBe(false)

    await jumpValid.trigger('click')
    expect(wrapper.emitted('jump')).toEqual([[256]])

    // Clicking a reading value copies it to the clipboard
    const validValueSpan = wrapper.findAll('[role="button"]').find((el) => el.text() === '256')
    expect(validValueSpan).toBeDefined()
    await validValueSpan!.trigger('click')
    expect(writeText).toHaveBeenCalledWith('256')
  })
})
