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

  function extendTo(index: number) {
    if (!rows.value.length) return
    if (anchor === null) {
      anchor = Math.max(0, cursor.value)
      base = new Set(selected.value)
    }
    cursor.value = Math.min(rows.value.length - 1, Math.max(0, index))
    const [from, to] = anchor < cursor.value ? [anchor, cursor.value] : [cursor.value, anchor]
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
