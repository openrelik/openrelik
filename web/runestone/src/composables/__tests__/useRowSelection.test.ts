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

import { nextTick, ref } from 'vue'
import { describe, expect, it } from 'vitest'

import { useRowSelection } from '@/composables/useRowSelection'

interface Row {
  id: string
  bytes: number
}

function makeRows(count: number): Row[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `r${index}`,
    bytes: (index + 1) * 10,
  }))
}

describe('useRowSelection', () => {
  it('picks cursor, toggles rows, tracks selectedBytes, and toggles all', () => {
    const rows = ref(makeRows(3))
    const sel = useRowSelection(
      rows,
      (row) => row.id,
      (row) => row.bytes,
    )

    expect(sel.cursor.value).toBe(0)
    expect(sel.selected.value.size).toBe(0)
    expect(sel.selectedBytes.value).toBe(0)
    expect(sel.allSelected.value).toBe(false)

    sel.pick(2)
    expect(sel.cursor.value).toBe(2)

    sel.toggle('r0')
    sel.toggle('r2')
    expect([...sel.selected.value]).toEqual(['r0', 'r2'])
    expect(sel.selectedBytes.value).toBe(40)
    expect(sel.allSelected.value).toBe(false)

    sel.toggle('r0')
    expect([...sel.selected.value]).toEqual(['r2'])

    sel.toggleAll()
    expect(sel.allSelected.value).toBe(true)
    expect(sel.selectedBytes.value).toBe(60)

    sel.toggleAll()
    expect(sel.allSelected.value).toBe(false)
    expect(sel.selected.value.size).toBe(0)
  })

  it('defaults bytesOf to 0 and ignores extendTo on empty lists', () => {
    const rows = ref<Row[]>([])
    const sel = useRowSelection(rows, (row) => row.id)

    expect(sel.allSelected.value).toBe(false)
    sel.extendTo(3)
    expect(sel.selected.value.size).toBe(0)

    rows.value = makeRows(2)
    sel.toggle('r0')
    expect(sel.selectedBytes.value).toBe(0)
  })

  it('extends and shrinks shift-range from an unselected cursor row', () => {
    const rows = ref(makeRows(5))
    const sel = useRowSelection(rows, (row) => row.id)

    sel.pick(1)
    sel.extendTo(3)
    expect(sel.cursor.value).toBe(3)
    expect([...sel.selected.value]).toEqual(['r1', 'r2', 'r3'])

    // Moving backward past the anchor reverses the range around index 1
    sel.extendTo(0)
    expect(sel.cursor.value).toBe(0)
    expect([...sel.selected.value]).toEqual(['r0', 'r1'])

    sel.clearSelection()
    expect(sel.selected.value.size).toBe(0)
  })

  it('anchors at the far end of an existing selected run and preserves disjoint selections', () => {
    const rows = ref(makeRows(6))
    const sel = useRowSelection(rows, (row) => row.id)

    // Select r0 (disjoint) and contiguous run r2..r4
    sel.toggle('r0')
    sel.toggle('r2')
    sel.toggle('r3')
    sel.toggle('r4')

    // Cursor at 4 (closer to end than start=2 -> anchor becomes 2)
    sel.pick(4)
    sel.extendTo(3)
    expect([...sel.selected.value]).toEqual(['r0', 'r2', 'r3'])

    // Reset and test cursor closer to start of run (cursor=2 in r2..r4 -> anchor becomes 4)
    sel.dropAnchor()
    sel.clearSelection()
    sel.toggle('r2')
    sel.toggle('r3')
    sel.toggle('r4')
    sel.pick(2)
    sel.extendTo(3)
    expect([...sel.selected.value]).toEqual(['r3', 'r4'])
  })

  it('clamps cursor and drops range anchor when rows list shrinks', async () => {
    const rows = ref(makeRows(5))
    const sel = useRowSelection(rows, (row) => row.id)

    sel.pick(4)
    sel.extendTo(10)
    expect(sel.cursor.value).toBe(4)

    rows.value = makeRows(2)
    await nextTick()
    expect(sel.cursor.value).toBe(1)

    rows.value = []
    await nextTick()
    expect(sel.cursor.value).toBe(0)
  })

  it('keeps shift-range anchored by row key when background refresh inserts rows above, and drops anchor if anchor disappears', async () => {
    const rows = ref(makeRows(5))
    const sel = useRowSelection(rows, (row) => row.id)

    // Start range at r3 (index 3) and extend upward to r2 (index 2).
    sel.pick(3)
    sel.extendTo(2)
    expect([...sel.selected.value]).toEqual(['r2', 'r3'])

    // Background refresh inserts a new row at the top; r3 shifts to index 4, r2 to index 3.
    rows.value = [{ id: 'new-top', bytes: 5 }, ...rows.value]
    await nextTick()

    // Extending upward to index 2 (r1) keeps r3 as the anchor rather than re-anchoring on r1/r2.
    sel.extendTo(2)
    expect([...sel.selected.value]).toEqual(['r1', 'r2', 'r3'])

    // Removing the anchor row (r3) drops the stale anchor cleanly on the next extendTo.
    rows.value = rows.value.filter((r) => r.id !== 'r3')
    await nextTick()
    sel.extendTo(1)
    expect([...sel.selected.value]).toContain('r0')
  })
})
