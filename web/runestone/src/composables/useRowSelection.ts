import { computed, ref, watch, type Ref } from 'vue'

export interface Identifiable {
  id: number
}

/**
 * Manages cursor position, multi-selection, and Shift+Click/Shift+Arrow range selection
 * for a list of identifiable items.
 */
export function useRowSelection<T extends Identifiable>(
  rows: Ref<T[]>,
  bytesOf: (item: T) => number = () => 0,
) {
  const cursor = ref(0)
  const selected = ref(new Set<number>())

  let anchor: number | null = null
  let base = new Set<number>()

  function dropAnchor() {
    anchor = null
  }

  function pick(index: number) {
    dropAnchor()
    cursor.value = index
  }

  const selectedBytes = computed(() =>
    rows.value
      .filter((row) => selected.value.has(row.id))
      .reduce((sum, row) => sum + bytesOf(row), 0),
  )

  const allSelected = computed(
    () => rows.value.length > 0 && rows.value.every((row) => selected.value.has(row.id)),
  )

  function toggle(id: number) {
    dropAnchor()
    const next = new Set(selected.value)
    if (!next.delete(id)) next.add(id)
    selected.value = next
  }

  function toggleAll() {
    selected.value = allSelected.value ? new Set() : new Set(rows.value.map((row) => row.id))
  }

  /**
   * Where a new Shift range starts. On an unselected row: there. On a
   * selected one, the run of selected rows around the cursor is taken as the
   * range so far, anchored at its far end — so moving back over it deselects
   * row by row, and moving away extends it, as in Finder.
   */
  function startRange() {
    const list = rows.value
    const at = Math.max(0, cursor.value)
    const isSelected = (i: number) => !!list[i] && selected.value.has(list[i]!.id)
    base = new Set(selected.value)
    if (!isSelected(at)) {
      anchor = at
      return
    }
    let start = at
    let end = at
    while (isSelected(start - 1)) start--
    while (isSelected(end + 1)) end++
    anchor = at - start >= end - at ? start : end
    list.slice(start, end + 1).forEach((row) => base.delete(row.id))
  }

  function extendTo(index: number) {
    if (!rows.value.length) return
    if (anchor === null) startRange()
    cursor.value = Math.min(rows.value.length - 1, Math.max(0, index))
    const start = anchor ?? cursor.value
    const [from, to] = start < cursor.value ? [start, cursor.value] : [cursor.value, start]
    const next = new Set(base)
    rows.value.slice(from, to + 1).forEach((row) => next.add(row.id))
    selected.value = next
  }

  function clearSelection() {
    selected.value = new Set()
  }

  watch(rows, dropAnchor)
  watch(rows, (list) => {
    cursor.value = Math.min(cursor.value, Math.max(0, list.length - 1))
  })

  return {
    cursor,
    selected,
    selectedBytes,
    allSelected,
    pick,
    toggle,
    toggleAll,
    extendTo,
    dropAnchor,
    clearSelection,
  }
}
