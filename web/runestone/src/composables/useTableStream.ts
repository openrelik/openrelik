/**
 * Table Stream Composable
 *
 * A CSV, TSV or JSONL file as rows, read front to back in 1 MiB byte-range
 * requests and parsed as they arrive (see `utils/table.ts`): the first rows
 * show while the rest is still coming, and a file of any size can be opened.
 *
 * - Text is decoded as UTF-8 in streaming mode, so a character split across
 *   two chunks arrives whole; a byte-order mark is dropped.
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

import { api, errorMessage } from '@/api'
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

const CHUNK_SIZE = 1024 * 1024
/** Read on opening (decimal megabytes, as sizes are shown). */
export const FIRST_BYTES = 5_000_000
/** Read by each "load more". */
export const MORE_BYTES = 10_000_000
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
  const bytesRead = ref(0)
  const reading = ref(false)
  const capped = ref(false)
  const done = ref(false)
  const error = ref<string | null>(null)

  let parser: TableParser | null = null
  let decoder = new TextDecoder('utf-8')
  let controller: AbortController | null = null
  let run = 0

  function reset() {
    controller?.abort()
    controller = null
    run++
    parser = null
    decoder = new TextDecoder('utf-8')
    rows.value = []
    columns.value = []
    bytesRead.value = 0
    reading.value = false
    capped.value = false
    done.value = false
    error.value = null
  }

  function append(parsed: TableRow[]) {
    if (!parser) return
    columns.value = parser.columns()
    if (!parsed.length) return
    // Pushing into the array in place, then triggering: copying 200 000 rows per chunk would not scale.
    rows.value.push(...parsed)
    triggerRef(rows)
  }

  /** Reads on from where it stopped, until the file ends or `amount` more bytes are in. */
  async function read(amount: number) {
    const { id, size } = file()
    const mine = run
    controller = new AbortController()
    const { signal } = controller
    reading.value = true
    capped.value = false
    const stopBytes = bytesRead.value + amount
    try {
      while (bytesRead.value < size) {
        if (bytesRead.value >= stopBytes) {
          capped.value = true
          return
        }
        const start = bytesRead.value
        const end = Math.min(size, start + CHUNK_SIZE) - 1
        const bytes = await api.files.readRange(id, start, end, { signal })
        if (mine !== run) return
        let text = decoder.decode(bytes, { stream: end < size - 1 })
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
        bytesRead.value = end + 1
        // Let the page draw between chunks.
        await new Promise((resolve) => setTimeout(resolve, 0))
        if (mine !== run) return
      }
      if (parser) append(parser.end())
      done.value = true
    } catch (err: unknown) {
      if (mine !== run || signal.aborted) return
      error.value = errorMessage(err, 'could not read the file')
    } finally {
      if (mine === run) reading.value = false
    }
  }

  watch(
    [() => file().id, kind],
    () => {
      reset()
      if (file().size > 0) read(FIRST_BYTES)
      else done.value = true
    },
    { immediate: true },
  )
  onScopeDispose(reset)

  const types = computed<ColumnType[]>(() => {
    // Lines that did not parse have no columns: they do not vote.
    const sample = rows.value.filter((row) => !row.error).slice(0, TYPE_SAMPLE)
    void rows.value.length // re-infer as the first rows arrive
    return columns.value.map((_, index) =>
      inferType(sample.map((row) => cellsOf(row)[index] ?? '')),
    )
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
    bytesRead,
    reading,
    capped,
    done,
    error,
    loadMore: () => {
      if (!reading.value && capped.value) read(MORE_BYTES)
    },
    loadAll: () => {
      if (!reading.value && capped.value) read(Infinity)
    },
    stop: () => {
      if (!reading.value) return
      controller?.abort()
      reading.value = false
      capped.value = bytesRead.value < file().size
    },
  }
}
