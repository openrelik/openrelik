/**
 * Table Stream Composable
 *
 * A CSV, TSV or JSONL file as rows, read front to back (see `useRangeText`)
 * and parsed as the text arrives (see `utils/table.ts`): the first rows show
 * while the rest is still coming, and a file of any size can be opened.
 *
 * - Opening reads the first 5 MB — tens of thousands of rows, cheap on a
 *   slow link. `loadMore()` reads 10 MB more, `loadAll()` the rest of the
 *   file. Memory holds the parsed rows only.
 * - Leaving the file (or re-reading it) cancels what is in flight.
 */

import {
  computed,
  onScopeDispose,
  ref,
  shallowRef,
  triggerRef,
  watch,
  type ComputedRef,
  type Ref,
  type ShallowRef,
} from 'vue'

import { createRangeText, FIRST_BYTES, type RangeText } from '@/composables/useRangeText'
import type { TableKind } from '@/utils/preview'
import {
  csvParser,
  inferType,
  jsonlCells,
  jsonlParser,
  sniffDelimiter,
  type ColumnType,
  type TableParser,
  type TableRow,
} from '@/utils/table'

export { FIRST_BYTES, MORE_BYTES } from '@/composables/useRangeText'
/** Rows looked at to infer the columns' types. */
const TYPE_SAMPLE = 1000

export interface UseTableStreamReturn {
  /** Rows so far, in file order. Shallow: replaced in place, triggered per chunk. */
  rows: Readonly<ShallowRef<TableRow[]>>
  columns: Readonly<Ref<string[]>>
  types: ComputedRef<ColumnType[]>
  /** The cells of a row for the current columns (JSONL rows are records). */
  cellsOf: (row: TableRow) => string[]
  delimiter: Readonly<Ref<string>>
  bytesRead: Readonly<Ref<number>>
  reading: Readonly<Ref<boolean>>
  /** Paused at the cap with more of the file unread. */
  capped: Readonly<Ref<boolean>>
  done: Readonly<Ref<boolean>>
  error: Readonly<Ref<string | null>>
  /** Reads 10 MiB more. */
  loadMore: () => void
  /** Reads the rest of the file. */
  loadAll: () => void
  /** Reads on until row `row` (1-based) has arrived, or the file ends. */
  readUntil: (row: number) => void
  /** Stops reading; what is read stays, and more can be loaded later. */
  stop: () => void
}

export function useTableStream(
  file: () => { id: number; size: number },
  kind: () => TableKind,
): UseTableStreamReturn {
  const rows = shallowRef<TableRow[]>([])
  const columns = ref<string[]>([])
  const delimiter = ref(',')

  let parser: TableParser | null = null
  /** The reader of the file on screen: a new one for each file. */
  const reader = shallowRef<RangeText | null>(null)

  function append(parsed: TableRow[]) {
    if (!parser) return
    const nextCols = parser.columns()
    if (
      nextCols.length !== columns.value.length ||
      nextCols.some((name, i) => name !== columns.value[i])
    ) {
      columns.value = nextCols
    }
    if (!parsed.length) return
    // Pushing into the array in place, then triggering: copying 200 000 rows per chunk would not scale.
    for (const row of parsed) rows.value.push(row)
    triggerRef(rows)
  }

  function onText(text: string, last: boolean) {
    if (!parser) {
      if (text.charCodeAt(0) === 0xfeff) text = text.slice(1)
      const kindNow = kind()
      if (kindNow === 'jsonl') parser = jsonlParser()
      else {
        delimiter.value = kindNow === 'tsv' ? '\t' : sniffDelimiter(text.slice(0, 64 * 1024))
        // The first row names the columns.
        parser = csvParser(delimiter.value)
      }
    }
    append(parser.push(text))
    if (last) append(parser.end())
  }

  function reset() {
    reader.value?.stop()
    reader.value = null
    parser = null
    rows.value = []
    columns.value = []
    delimiter.value = ','
  }

  watch(
    [() => file().id, () => file().size, kind],
    () => {
      reset()
      const next = createRangeText(file(), onText)
      reader.value = next
      next.read(FIRST_BYTES)
    },
    { immediate: true },
  )
  onScopeDispose(reset)

  const types = computed<ColumnType[]>(() => {
    void rows.value.length // re-infer as the first rows arrive
    // Lines that did not parse have no columns: they do not vote.
    const sample: string[][] = []
    for (const row of rows.value) {
      if (row.error) continue
      sample.push(cellsOf(row))
      if (sample.length >= TYPE_SAMPLE) break
    }
    return columns.value.map((_, index) => inferType(sample.map((cells) => cells[index] ?? '')))
  })

  function cellsOf(row: TableRow): string[] {
    return row.record || row.error ? jsonlCells(row, columns.value) : row.cells
  }

  return {
    rows,
    columns,
    types,
    cellsOf,
    delimiter,
    bytesRead: computed(() => reader.value?.bytesRead.value ?? 0),
    reading: computed(() => reader.value?.reading.value ?? false),
    capped: computed(() => reader.value?.capped.value ?? false),
    done: computed(() => reader.value?.done.value ?? false),
    error: computed(() => reader.value?.error.value ?? null),
    loadMore: () => reader.value?.loadMore(),
    loadAll: () => reader.value?.loadAll(),
    readUntil: (row) => {
      // The parser hands on whole rows only.
      const arrived = () => rows.value.length >= row
      if (!arrived()) reader.value?.read(0, arrived)
    },
    stop: () => reader.value?.stop(),
  }
}
