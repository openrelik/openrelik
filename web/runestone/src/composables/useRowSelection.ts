import { computed, ref, watch, type ComputedRef, type Ref } from 'vue'

export interface UseRowSelectionReturn {
  cursor: Ref<number>
  selected: Ref<Set<string>>
  selectedBytes: ComputedRef<number>
  allSelected: ComputedRef<boolean>
  pick: (index: number) => void
  toggle: (key: string) => void
  toggleAll: () => void
  extendTo: (index: number) => void
  dropAnchor: () => void
  clearSelection: () => void
}

/**
 * Manages cursor position, multi-selection, and Shift+Click/Shift+Arrow range selection
 * for a list of rows. `keyOf` says what tells one row from another; the selection
 * holds those keys.
 */
export function useRowSelection<T>(
  rows: Ref<T[]>,
  keyOf: (row: T) => string,
  bytesOf: (item: T) => number = () => 0,
): UseRowSelectionReturn {
  const cursor = ref(0)
  const selected = ref(new Set<string>())

  // Kept by row key so background refreshes inserting or removing other rows do not break a Shift range.
  let anchorKey: string | null = null
  let base = new Set<string>()

  function dropAnchor() {
    anchorKey = null
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
  function startRange(): number {
    const list = rows.value
    const at = Math.min(list.length - 1, Math.max(0, cursor.value))
    const isSelected = (i: number) => !!list[i] && selected.value.has(keyOf(list[i]!))
    base = new Set(selected.value)
    if (!isSelected(at)) {
      anchorKey = keyOf(list[at]!)
      return at
    }
    let start = at
    let end = at
    while (isSelected(start - 1)) start--
    while (isSelected(end + 1)) end++
    const anchor = at - start >= end - at ? start : end
    anchorKey = keyOf(list[anchor]!)
    list.slice(start, end + 1).forEach((row) => base.delete(keyOf(row)))
    return anchor
  }

  function extendTo(index: number) {
    if (!rows.value.length) return
    let anchor = anchorKey !== null ? rows.value.findIndex((row) => keyOf(row) === anchorKey) : -1
    if (anchor === -1) anchor = startRange()
    cursor.value = Math.min(rows.value.length - 1, Math.max(0, index))
    const [from, to] = anchor < cursor.value ? [anchor, cursor.value] : [cursor.value, anchor]
    const next = new Set(base)
    rows.value.slice(from, to + 1).forEach((row) => next.add(keyOf(row)))
    selected.value = next
  }

  function clearSelection() {
    selected.value = new Set()
  }

  watch(rows, (list) => {
    if (anchorKey !== null && !list.some((row) => keyOf(row) === anchorKey)) {
      anchorKey = null
    }
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
