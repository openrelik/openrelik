// @vitest-environment happy-dom
import { defineComponent } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'
import { createPinia, setActivePinia } from 'pinia'
import { mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import TableDetail from '@/components/viewers/TableDetail.vue'
import directives from '@/directives'
import { hideTooltip } from '@/composables/useTooltip'
import { jsonlCells, type TableRow } from '@/utils/table'

vi.mock('@/api', () => ({
  api: {
    files: {
      readRange: vi.fn(),
    },
  },
  errorMessage: (err: unknown, fallback: string) => (err instanceof Error ? err.message : fallback),
}))

const DummyRoute = defineComponent({ render: () => null })
const wrappers: VueWrapper[] = []

function mountDetail(props: { row: TableRow; number: number; columns: string[]; cells: string[] }) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/', component: DummyRoute }],
  })
  const wrapper = mount(TableDetail, {
    props,
    global: {
      plugins: [createPinia(), directives, router],
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

describe('TableDetail', () => {
  it('renders formatted row number, key-value cells, escaped control characters, and dash for empty cells', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    })

    const longMessage = `${'A'.repeat(12_000)}\nline2\t\x07`
    const columns = ['timestamp', 'host', 'empty_col', 'message', 'missing_tail']
    const cells = ['2026-06-01T00:00:00Z', 'srv-01', '', longMessage]
    const row: TableRow = { cells }

    const wrapper = mountDetail({
      row,
      number: 1234,
      columns,
      cells,
    })

    const root = wrapper.get('[aria-label="Row details"]')
    expect(root.text()).toContain('row 1,234')
    expect(wrapper.find('.text-danger').exists()).toBe(false)

    const dts = wrapper.findAll('dt').map((dt) => dt.text())
    expect(dts).toEqual(['timestamp', 'host', 'empty_col', 'message', 'missing_tail'])

    const dds = wrapper.findAll('dd')
    expect(dds[0]?.text()).toBe('2026-06-01T00:00:00Z')
    expect(dds[1]?.text()).toBe('srv-01')
    // Empty and missing cells render muted dash without copy directive
    expect(dds[2]?.text()).toBe('–')
    expect(dds[4]?.text()).toBe('–')
    expect(dds[2]?.find('[role="button"]').exists()).toBe(false)

    // Full untrimmed long cell value with escaped control characters (\n, \t, \x07)
    const msgSpan = dds[3]?.get('span')
    expect(msgSpan?.text().length).toBeGreaterThan(12_000)
    expect(msgSpan?.text()).toContain('\\nline2\\t\\x07')

    await dds[1]!.get('span').trigger('click')
    expect(writeText).toHaveBeenCalledWith('srv-01')
  })

  it('pretty-prints nested JSON objects and arrays in <pre> while treating null as a scalar cell', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    })

    const record: Record<string, unknown> = {
      id: 42,
      user: { name: 'alice', roles: ['admin', 'analyst'] },
      tags: ['auth', 'ssh'],
      note: null,
    }
    const columns = ['id', 'user', 'tags', 'note']
    const row: TableRow = { cells: [], record }
    const cells = jsonlCells(row, columns)

    const wrapper = mountDetail({
      row,
      number: 7,
      columns,
      cells,
    })

    const pres = wrapper.findAll('pre')
    expect(pres).toHaveLength(2)

    const expectedUserJson = JSON.stringify(record.user, null, 2)
    const expectedTagsJson = JSON.stringify(record.tags, null, 2)
    expect(pres[0]?.text()).toBe(expectedUserJson)
    expect(pres[1]?.text()).toBe(expectedTagsJson)

    // `note: null` has cells[3] === '' so it renders as '–', not JSON 'null' in <pre>
    const dds = wrapper.findAll('dd')
    expect(dds[0]?.text()).toBe('42')
    expect(dds[3]?.text()).toBe('–')

    await pres[0]!.trigger('click')
    expect(writeText).toHaveBeenCalledWith(expectedUserJson)
  })

  it('displays the malformed JSONL error banner alongside the raw unparsed line', () => {
    const columns = ['line', 'other']
    const row: TableRow = {
      cells: [],
      raw: '{broken: json\x00}',
      error: "Expected property name or '}' in JSON at position 1",
    }
    const cells = jsonlCells(row, columns)

    const wrapper = mountDetail({
      row,
      number: 9,
      columns,
      cells,
    })

    expect(wrapper.text()).toContain('row 9')
    expect(wrapper.text()).toContain(
      "Not valid JSON: Expected property name or '}' in JSON at position 1",
    )
    const dds = wrapper.findAll('dd')
    expect(dds[0]?.text()).toBe('{broken: json\\x00}')
    expect(dds[1]?.text()).toBe('–')
  })

  it('escapes control chars in column names, error text, and nested C1 controls, and ignores prototype keys', () => {
    const columns = ['__proto__', 'col\x1b', 'col\x1b', 'nested']
    const row: TableRow = {
      cells: [],
      record: { nested: { msg: 'hi\x7f\u0085' } },
      error: 'bad token \x1b[31m',
    }
    const cells = ['', 'val1', 'val2', '[object Object]']

    const wrapper = mountDetail({
      row,
      number: 1,
      columns,
      cells,
    })

    const dts = wrapper.findAll('dt').map((dt) => dt.text())
    expect(dts).toEqual(['__proto__', 'col\\x1b', 'col\\x1b', 'nested'])
    expect(wrapper.text()).toContain('Not valid JSON: bad token \\x1b[31m')

    // Missing `__proto__` key on record must not fall back to Object.prototype (<pre>{}</pre>)
    const dds = wrapper.findAll('dd')
    expect(dds[0]?.text()).toBe('–')
    expect(dds[1]?.text()).toBe('val1')
    expect(dds[2]?.text()).toBe('val2')

    const pre = dds[3]?.get('pre')
    expect(pre?.text()).toContain('\\x7f\\x85')
  })
})
