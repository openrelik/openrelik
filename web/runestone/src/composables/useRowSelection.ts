import { computed, ref, watch, type Ref } from 'vue'

/**
 * Manages cursor position, multi-selection, and Shift+Click/Shift+Arrow range selection
 * for a list of rows. `keyOf` says what tells one row from another; the selection
 * holds those keys.
 */
export function useRowSelection<T>(
  rows: Ref<T[]>,
  keyOf: (row: T) => string,
  bytesOf: (item: T) => number = () => 0,
) {
  const cursor = ref(0)
  const selected = ref(new Set<string>())

  let anchor: number | null = null
  let base = new Set<string>()

  function dropAnchor() {
    anchor = null
  }

  function pick(index: number) {
    dropAnchor()
    cursor.value = index
  }

  const selectedBytes = computed(() =>
    rows.value
      .filter((row) => selected.value.has(keyOf(row)))
      .reduce((sum, row) => sum + bytesOf(row), 0),
  )

  const allSelected = computed(
    () => rows.value.length > 0 && rows.value.every((row) => selected.value.has(keyOf(row))),
  )

  function toggle(key: string) {
    dropAnchor()
    const next = new Set(selected.value)
    if (!next.delete(key)) next.add(key)
    selected.value = next
  }

  function toggleAll() {
    selected.value = allSelected.value ? new Set() : new Set(rows.value.map(keyOf))
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
    const isSelected = (i: number) => !!list[i] && selected.value.has(keyOf(list[i]!))
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
    list.slice(start, end + 1).forEach((row) => base.delete(keyOf(row)))
  }

  function extendTo(index: number) {
    if (!rows.value.length) return
    if (anchor === null) startRange()
    cursor.value = Math.min(rows.value.length - 1, Math.max(0, index))
    const start = anchor ?? cursor.value
    const [from, to] = start < cursor.value ? [start, cursor.value] : [cursor.value, start]
    const next = new Set(base)
    rows.value.slice(from, to + 1).forEach((row) => next.add(keyOf(row)))
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
