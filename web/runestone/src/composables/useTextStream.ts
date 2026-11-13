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

/**
 * Text Stream Composable
 *
 * A text file as lines, for the text viewer: read front to back (see
 * `useRangeText`) and indexed as the text arrives (see `utils/lines.ts`), so
 * the first lines show at once and a file of any size can be opened.
 *
 * - Opening reads the first 5 MB; `loadMore()` reads 10 MB more, `loadAll()`
 *   the rest. `readUntil(line)` reads on until a line has arrived — a deep
 *   link or a go-to past what is read.
 * - A file open in two views at once (rendered Markdown and its source) is
 *   read once, for both.
 * - The last few files read are kept, lines and all, so stepping back to a
 *   file costs no request. Leaving a file stops its reading; coming back
 *   resumes it up to the first 5 MB. Files read past `KEEP_MAX` are not kept.
 * - `forgetTextFiles()` drops them all (sign-out).
 */

import { computed, onScopeDispose, ref, shallowRef, watch, type ComputedRef, type Ref } from 'vue'

import { createRangeText, FIRST_BYTES, type RangeText } from '@/composables/useRangeText'
import { createLineIndex, type LineIndex } from '@/utils/lines'

/** Files kept once left. */
const KEEP_FILES = 3
/** Bytes read past which a file is not kept once left. */
const KEEP_MAX = 64 * 1024 * 1024

interface TextFile {
  key: string
  reader: RangeText
  index: LineIndex
  /** Bumped as text arrives: what reads the index depends on it. */
  version: Ref<number>
}

/** Files kept, least recently shown first. */
const kept = new Map<string, TextFile>()
/** Files on screen, and how many views show each. */
const shown = new Map<string, { file: TextFile; views: number }>()

function openFile(id: number, size: number): TextFile {
  const key = `${id}:${size}`
  const known = shown.get(key)
  if (known) {
    known.views++
    return known.file
  }
  const file = kept.get(key) ?? newFile(key, id, size)
  kept.delete(key)
  shown.set(key, { file, views: 1 })
  return file
}

function newFile(key: string, id: number, size: number): TextFile {
  const index = createLineIndex()
  const version = ref(0)
  const reader = createRangeText({ id, size }, (text, last) => {
    index.append(text, last)
    version.value++
  })
  return { key, reader, index, version }
}

/** A view lets go of a file: once no view shows it, it stops reading and is kept. */
function keep(file: TextFile) {
  const known = shown.get(file.key)
  // forgetTextFiles() already dropped this entry on sign-out: never re-cache it on unmount.
  if (!known) return
  if (--known.views > 0) return
  shown.delete(file.key)
  file.reader.stop()
  if (file.reader.bytesRead.value > KEEP_MAX) return
  kept.set(file.key, file)
  while (kept.size > KEEP_FILES) kept.delete(kept.keys().next().value!)
}

/** Forgets every file kept (sign-out): the next operator must not see them. */
export function forgetTextFiles(): void {
  for (const file of kept.values()) file.reader.stop()
  kept.clear()
  for (const { file } of shown.values()) file.reader.stop()
  shown.clear()
}

export interface UseTextStreamReturn {
  /** Changes as text arrives; read it in what should follow the lines. */
  version: ComputedRef<number>
  /** The file's lines so far. Read `version` first to follow them. */
  index: () => LineIndex
  lineCount: ComputedRef<number>
  rowCount: ComputedRef<number>
  bytesRead: ComputedRef<number>
  reading: ComputedRef<boolean>
  capped: ComputedRef<boolean>
  done: ComputedRef<boolean>
  error: ComputedRef<string | null>
  /** Reads on until line `line` (1-based) has arrived in full, or the file ends. */
  readUntil: (line: number) => void
  loadMore: () => void
  loadAll: () => void
  stop: () => void
}

export function useTextStream(file: () => { id: number; size: number }): UseTextStreamReturn {
  const current = shallowRef<TextFile>(openFile(file().id, file().size))

  function show(next: TextFile) {
    const { reader } = next
    if (!reader.done.value && reader.bytesRead.value < FIRST_BYTES) {
      reader.read(FIRST_BYTES - reader.bytesRead.value)
    }
  }
  show(current.value)

  watch(
    () => `${file().id}:${file().size}`,
    () => {
      keep(current.value)
      current.value = openFile(file().id, file().size)
      show(current.value)
    },
  )
  onScopeDispose(() => keep(current.value))

  const version = computed(() => current.value.version.value)
  const index = () => current.value.index
  const reader = () => current.value.reader

  return {
    version,
    index,
    lineCount: computed(() => {
      void version.value
      return index().lines.length
    }),
    rowCount: computed(() => {
      void version.value
      return index().rowCount()
    }),
    bytesRead: computed(() => reader().bytesRead.value),
    reading: computed(() => reader().reading.value),
    capped: computed(() => reader().capped.value),
    done: computed(() => reader().done.value),
    error: computed(() => reader().error.value),
    readUntil(line) {
      if (line < 1) return
      const idx = index()
      const arrived = () => idx.lines.length > line || (idx.lines.length === line && !idx.open)
      if (!arrived()) reader().read(0, arrived)
    },
    loadMore: () => reader().loadMore(),
    loadAll: () => reader().loadAll(),
    stop: () => reader().stop(),
  }
}
