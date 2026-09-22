/** Helpers for chunked uploads: pure, so the queue keeps only its state. */

/**
 * The id the server uses for one upload. It is interpolated into a path on the
 * server, so it must be plain hex — nothing that could climb out of a folder.
 */
export function uploadIdentifier(): string {
  const uuid = globalThis.crypto?.randomUUID?.()
  if (uuid) return uuid.replaceAll('-', '')
  const bytes = new Uint8Array(16)
  globalThis.crypto.getRandomValues(bytes)
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

/**
 * How many chunks a file of `size` takes. Always rounds up and never returns
 * 0: the server records a chunk only once it has bytes, so a trailing empty
 * chunk would leave the upload forever unfinished.
 */
export function chunkCount(size: number, chunkSize: number): number {
  return Math.max(1, Math.ceil(size / chunkSize))
}

/** The byte range of chunk `number` (1-based). */
export function chunkRange(
  number: number,
  chunkSize: number,
  size: number,
): { start: number; end: number } {
  const start = (number - 1) * chunkSize
  return { start, end: Math.min(start + chunkSize, size) }
}

/** How long to wait before retrying, growing with each attempt, with jitter. */
export function backoffMs(attempt: number): number {
  const base = Math.min(8_000, 500 * 2 ** attempt)
  return base + Math.random() * 250
}

/** A file from a dropped folder, with the folders it sits in, outermost first. */
export interface DroppedFile {
  path: string[]
  file: File
}

export interface DropContents {
  /** Files at the top of the drop (not inside a dropped folder). */
  loose: File[]
  /** Files inside dropped folders, with the folders they belong to. */
  nested: DroppedFile[]
  /** Folders in the drop, outermost first, including empty ones. */
  folders: string[][]
}

/** Above this many files, a drop is worth confirming before it starts. */
export const LARGE_DROP = 200

const readEntries = (reader: FileSystemDirectoryReader): Promise<FileSystemEntry[]> =>
  new Promise((resolve, reject) => reader.readEntries(resolve, reject))

const fileOf = (entry: FileSystemFileEntry): Promise<File> =>
  new Promise((resolve, reject) => entry.file(resolve, reject))

/** Lists a folder completely: readEntries answers in batches until it is empty. */
async function listDirectory(directory: FileSystemDirectoryEntry): Promise<FileSystemEntry[]> {
  const reader = directory.createReader()
  const all: FileSystemEntry[] = []
  for (;;) {
    const batch = await readEntries(reader)
    if (!batch.length) return all
    all.push(...batch)
  }
}

/**
 * Walks what was dropped: the files at the top, the folders, and the files
 * inside them. Everything comes along, hidden files included — in forensics a
 * dotfile is evidence like any other, and nothing is silently left out: a drop
 * of thousands of files is confirmed, not truncated.
 */
export async function collectDrop(entries: FileSystemEntry[]): Promise<DropContents> {
  const result: DropContents = { loose: [], nested: [], folders: [] }

  async function walk(entry: FileSystemEntry, path: string[]): Promise<void> {
    if (entry.isFile) {
      const file = await fileOf(entry as FileSystemFileEntry)
      if (path.length) result.nested.push({ path, file })
      else result.loose.push(file)
      return
    }

    const here = [...path, entry.name]
    result.folders.push(here)
    for (const child of await listDirectory(entry as FileSystemDirectoryEntry)) {
      await walk(child, here)
    }
  }

  for (const entry of entries) await walk(entry, [])
  return result
}
