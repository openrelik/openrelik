/**
 * Upload Queue Composable
 *
 * Uploads files into a folder in chunks, several files at a time. Module-scoped
 * so an upload survives navigating between folders: the rows appear in the
 * folder the files are going to, the summary in the status bar follows the
 * operator everywhere.
 *
 * How it talks to the server (`POST /files/upload`, resumable.js parameters):
 *
 * - **Chunks of one file go one at a time.** This is correctness, not
 *   politeness: the server records a chunk once its first bytes are written,
 *   so two chunks of the same upload in flight can make it assemble a
 *   half-written one. Different files use different ids and are safe together.
 * - **The upload finishes by itself.** The server assembles the file once it
 *   holds every chunk number and answers *that* request with the file, so any
 *   chunk's answer can be the one that carries it.
 * - **Empty files are refused here**: the server can never complete one.
 * - **Resume is in-session only.** There is no way to ask the server which
 *   chunks it has, so a retry skips the chunks this client saw acknowledged.
 *   Chunks of an abandoned upload are left on the server; nothing can clean
 *   them up from here.
 */

import { computed, reactive, readonly, ref, watch, type ComputedRef, type Ref } from 'vue'
import { api, ApiError, errorMessage, type UploadedFile } from '@/api'
import { connectionIsConstrained, useConnection } from '@/composables/useConnection'
import { folderKeys, mapFileToItem } from '@/composables/useFolderLoader'
import { canUpload, ensureRole, roleOf } from '@/composables/useFolderPermissions'
import { markFresh, queryState } from '@/composables/useQueryCache'
import { useItemsStore } from '@/stores/items'
import type { Item } from '@/types/item'
import { useAuthStore } from '@/stores/auth'
import {
  backoffMs,
  chunkCount,
  chunkRange,
  collectDrop,
  type DropContents,
  LARGE_DROP,
  uploadIdentifier,
} from '@/utils/upload'
import { useFolderActions } from '@/composables/useFolderActions'
import { confirmAction } from '@/composables/useConfirm'
import { count } from '@/utils/format'

export type UploadStatus = 'queued' | 'uploading' | 'done' | 'failed'

export interface Upload {
  /** Row key while the file has no server id yet. */
  key: string
  /** The server's id for this upload; a retry after 429 gets a new one. */
  identifier: string
  folderId: number
  name: string
  size: number
  file: File
  status: UploadStatus
  chunkSize: number
  totalChunks: number
  /** Chunk numbers the server acknowledged: a retry skips these. */
  done: Set<number>
  /** Bytes of the chunk in flight; back to 0 whenever an attempt restarts. */
  attemptLoaded: number
  /** Waiting to retry, or waiting for the network to come back. */
  waiting: boolean
  error: string | null
}

/** Files at once, and how much of a file goes in one request. */
const MAX_PARALLEL = () => (connectionIsConstrained() ? 1 : 3)
const CHUNK_BYTES = () => (connectionIsConstrained() ? 2 : 8) * 1024 * 1024
/** The server gives up on a chunk after 5 tries; stay under that. */
const MAX_CHUNK_ATTEMPTS = 4
/** A chunk that cannot reach the server at all is worth more patience. */
const MAX_NETWORK_ATTEMPTS = 6
/** How long to keep waiting for the network before giving up on a chunk. */
const MAX_OFFLINE_WAIT_MS = 120_000

const uploads = reactive<Upload[]>([])
const error = ref<string | null>(null)
const controllers = new Map<string, AbortController>()
const running = new Set<string>()
let nextKey = 0
let sessionGen = 0

const isAbort = (err: unknown): boolean => err instanceof DOMException && err.name === 'AbortError'
const statusOf = (err: unknown): number | null => (err instanceof ApiError ? err.status : null)

/** Bytes of this upload the server has, including the chunk in flight. */
export function sentBytes(upload: Upload): number {
  return Math.min(upload.size, upload.done.size * upload.chunkSize + upload.attemptLoaded)
}

/** Never 100 until the server confirms the file: that is what done means. */
export function uploadPercent(upload: Upload): number {
  if (upload.status === 'done') return 100
  if (!upload.size) return 0
  return Math.min(99, Math.floor((sentBytes(upload) / upload.size) * 100))
}

function clearError(): void {
  error.value = null
}

function remove(key: string): void {
  const index = uploads.findIndex((upload) => upload.key === key)
  if (index !== -1) uploads.splice(index, 1)
  controllers.delete(key)
}

/** Aborts everything and empties the queue (sign-out). */
export function clearUploads(): void {
  sessionGen++
  for (const controller of controllers.values()) controller.abort()
  controllers.clear()
  running.clear()
  uploads.splice(0, uploads.length)
  clearError()
}

function failureMessage(upload: Upload, err: unknown): string {
  const status = statusOf(err)
  if (status === 429) {
    return `Could not upload “${upload.name}”: the server gave up after repeated failures. Try again.`
  }
  if (status === 413) {
    return `Could not upload “${upload.name}”: the server rejected it as too large.`
  }
  return `Could not upload “${upload.name}”: ${errorMessage(err, 'request failed')}`
}

/** Waits out a backoff, and waits for the connection when there is none. */
async function pause(upload: Upload, attempt: number, signal: AbortSignal): Promise<void> {
  const { status } = useConnection()
  upload.waiting = true
  try {
    await sleep(backoffMs(attempt), signal)
    const until = Date.now() + MAX_OFFLINE_WAIT_MS
    while (status.value !== 'online' && Date.now() < until && !signal.aborted) {
      await sleep(1_000, signal)
    }
  } finally {
    upload.waiting = false
  }
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms)
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer)
        reject(new DOMException('Aborted', 'AbortError'))
      },
      { once: true },
    )
  })
}

/** Sends one chunk, retrying the failures the server says are worth retrying. */
async function sendChunk(
  upload: Upload,
  number: number,
  signal: AbortSignal,
): Promise<UploadedFile | undefined> {
  const { start, end } = chunkRange(number, upload.chunkSize, upload.size)
  const chunk = upload.file.slice(start, end)

  for (let attempt = 0; ; attempt++) {
    upload.attemptLoaded = 0
    try {
      return await api.files.uploadChunk(
        chunk,
        {
          chunkNumber: number,
          totalChunks: upload.totalChunks,
          identifier: upload.identifier,
          filename: upload.name,
          folderId: upload.folderId,
          chunkSize: upload.chunkSize,
          fileSize: upload.size,
        },
        {
          signal,
          onProgress: (loaded) => {
            upload.attemptLoaded = loaded
          },
        },
      )
    } catch (err: unknown) {
      const status = statusOf(err)
      // 503: the server could not store this chunk. 0: it never arrived.
      const worthRetrying = status === 503 || status === 0
      const limit = status === 0 ? MAX_NETWORK_ATTEMPTS : MAX_CHUNK_ATTEMPTS
      if (isAbort(err) || !worthRetrying || attempt + 1 >= limit) throw err
      await pause(upload, attempt, signal)
    }
  }
}

/** Puts a finished file where the rest of the app expects it. */
function finish(upload: Upload, created: UploadedFile): void {
  const authStore = useAuthStore()
  const item: Item = mapFileToItem(
    {
      ...created,
      // The upload answers with the bare record: no user, and a size only if
      // the server measured it.
      filesize: created.filesize ?? upload.size,
      display_name: created.display_name || upload.name,
      user: created.user ?? authStore.user ?? undefined,
    },
    upload.folderId,
  )
  useItemsStore().upsertItems([item])

  // The answer holds everything the listing shows, so nothing is refetched.
  // A folder whose files were never loaded stays unloaded: we know our file,
  // not the rest of that folder.
  const key = folderKeys.files(upload.folderId)
  if (queryState(key).status === 'success') markFresh(key)

  upload.status = 'done'
  remove(upload.key)
}

async function run(upload: Upload): Promise<void> {
  const controller = new AbortController()
  controllers.set(upload.key, controller)
  upload.status = 'uploading'
  upload.error = null

  try {
    // Sequential on purpose: see the note at the top of this file.
    for (let number = 1; number <= upload.totalChunks; number++) {
      if (upload.done.has(number)) continue
      const created = await sendChunk(upload, number, controller.signal)
      upload.done.add(number)
      upload.attemptLoaded = 0
      // Any chunk's answer can be the one that completes the file.
      if (created?.id) {
        finish(upload, created)
        return
      }
    }
    // Every chunk is in but the server never answered with the file.
    upload.status = 'failed'
    upload.error = `Could not upload “${upload.name}”: the server did not finish the file.`
    error.value = upload.error
  } catch (err: unknown) {
    if (isAbort(err)) return
    upload.status = 'failed'
    if (statusOf(err) === 429) {
      // The server deleted every chunk it had: a retry must start over.
      upload.done.clear()
      upload.identifier = uploadIdentifier()
    }
    upload.error = failureMessage(upload, err)
    error.value = upload.error
  } finally {
    upload.waiting = false
    controllers.delete(upload.key)
  }
}

function pump(): void {
  const limit = MAX_PARALLEL()
  for (const upload of uploads) {
    if (running.size >= limit) return
    if (upload.status !== 'queued' || running.has(upload.key)) continue
    running.add(upload.key)
    run(upload).finally(() => {
      running.delete(upload.key)
      pump()
    })
  }
}

export interface UseUploadQueueReturn {
  /** Every upload, anywhere, oldest first: the queue panel lists these. */
  all: ComputedRef<Upload[]>
  /** Uploads on their way into this folder, oldest first. */
  uploadsIn: (folderId: number) => Upload[]
  /** Uploads still running anywhere, for the status bar. */
  activeCount: ComputedRef<number>
  /** How far those are, 0–100. */
  activePercent: ComputedRef<number>
  /** Why the last upload failed, until the next one or `clearError()`. */
  error: Readonly<Ref<string | null>>
  clearError: () => void
  /** Queues files for a folder; refuses empty files and folders without rights. */
  enqueue: (folderId: number, files: File[]) => Promise<void>
  /**
   * Queues what was dropped, folders included: the folder tree is recreated
   * here and each file goes into the folder it came from. At the top level
   * (`parent` null) loose files have nowhere to go and are reported.
   */
  enqueueDrop: (parent: number | null, entries: FileSystemEntry[]) => Promise<void>
  cancel: (key: string) => void
  cancelAll: () => void
  /** Queues a failed upload again, keeping the chunks the server already has. */
  retry: (key: string) => void
  /** Removes a failed upload's row. */
  dismiss: (key: string) => void
}

/** Above a few hundred files, a drop or a pick is worth confirming first. */
async function confirmLarge(fileCount: number, folderCount: number): Promise<boolean> {
  if (fileCount <= LARGE_DROP) return true
  return confirmAction({
    title: `Upload ${count(fileCount, 'file')}?`,
    message: folderCount
      ? `${count(folderCount, 'folder')} will be created here, and every file in them uploaded.`
      : 'They are uploaded in the background; you can cancel from the status bar.',
    confirmLabel: 'Upload',
  })
}

async function enqueue(folderId: number, files: File[]): Promise<void> {
  clearError()
  const gen = sessionGen
  if (!(await confirmLarge(files.length, 0)) || gen !== sessionGen) return
  const failure = await queueFiles(folderId, files, gen)
  if (failure && gen === sessionGen) error.value = failure
}

/** Queues files without asking: returns the refusal reason without wiping sibling errors. */
async function queueFiles(folderId: number, files: File[], gen: number): Promise<string | null> {
  if (!files.length || gen !== sessionGen) return null

  const empty = files.filter((file) => file.size === 0)
  const usable = files.filter((file) => file.size > 0)
  const emptyError = empty.length
    ? empty.length === 1
      ? `Cannot upload “${empty[0]!.name}”: the file is empty.`
      : `Cannot upload ${empty.length} empty files.`
    : null
  if (!usable.length) return emptyError

  try {
    await ensureRole(folderId)
  } catch (err: unknown) {
    if (gen !== sessionGen) return null
    return `Could not check permissions: ${errorMessage(err, 'request failed')}`
  }
  if (gen !== sessionGen) return null
  if (!canUpload(roleOf(folderId))) {
    return 'Only an owner or editor can upload to this folder.'
  }

  const chunkSize = CHUNK_BYTES()
  for (const file of usable) {
    uploads.push({
      key: `upload-${nextKey++}`,
      identifier: uploadIdentifier(),
      folderId,
      name: file.name,
      size: file.size,
      file,
      status: 'queued',
      chunkSize,
      totalChunks: chunkCount(file.size, chunkSize),
      done: new Set(),
      attemptLoaded: 0,
      waiting: false,
      error: null,
    })
  }
  pump()
  return emptyError
}

/**
 * Recreates a dropped folder tree on the server, then queues its files. Folders
 * are created outermost first, so each one knows its parent; a folder that
 * cannot be created takes its own contents out of the drop, not the rest.
 */
async function enqueueDrop(parent: number | null, entries: FileSystemEntry[]): Promise<void> {
  clearError()
  const gen = sessionGen
  let dropped: DropContents
  try {
    dropped = await collectDrop(entries)
  } catch (err: unknown) {
    if (gen === sessionGen) {
      error.value = `Could not read dropped files: ${errorMessage(err, 'read failed')}`
    }
    return
  }
  if (gen !== sessionGen) return

  // Nothing is left out quietly: a drop this size is worth a moment's thought.
  const total = dropped.loose.length + dropped.nested.length
  if (!(await confirmLarge(total, dropped.folders.length)) || gen !== sessionGen) return

  const notes: string[] = []
  let firstError: string | null = null

  const { createFolder, error: folderError, clearError: clearFolderError } = useFolderActions()
  // Folder path (as dropped) → its id on the server.
  const created = new Map<string, number>()
  for (const path of dropped.folders) {
    const parentPath = path.slice(0, -1).join('/')
    const parentId = path.length === 1 ? parent : (created.get(parentPath) ?? null)
    // Its parent failed: skip this one too, quietly — the parent already said why.
    if (path.length > 1 && parentId === null) continue
    const folder = await createFolder(parentId, path.at(-1)!)
    if (gen !== sessionGen) return
    if (folder) created.set(path.join('/'), folder.id)
    else firstError ??= folderError.value
  }
  if (firstError) clearFolderError()

  const byFolder = new Map<number, File[]>()
  for (const { path, file } of dropped.nested) {
    const folderId = created.get(path.join('/'))
    if (folderId === undefined) continue
    byFolder.set(folderId, [...(byFolder.get(folderId) ?? []), file])
  }
  if (parent !== null && dropped.loose.length) byFolder.set(parent, dropped.loose)
  else if (parent === null && dropped.loose.length) {
    notes.push(
      dropped.loose.length === 1
        ? '1 loose file needs a folder'
        : `${dropped.loose.length} loose files need a folder`,
    )
  }

  for (const [folderId, files] of byFolder) {
    const failure = await queueFiles(folderId, files, gen)
    if (gen !== sessionGen) return
    firstError ??= failure
  }

  // Surface the first real failure across folders/files, or else any placement notes.
  if (firstError) error.value = firstError
  else if (notes.length) error.value = `${notes.join('; ')}.`
}

function cancel(key: string): void {
  controllers.get(key)?.abort()
  remove(key)
  pump()
}

function cancelAll(): void {
  for (const upload of [...uploads]) cancel(upload.key)
}

function retry(key: string): void {
  const upload = uploads.find((entry) => entry.key === key)
  if (!upload || upload.status !== 'failed') return
  clearError()
  upload.error = null
  upload.attemptLoaded = 0
  upload.status = 'queued'
  pump()
}

const active = computed(() => uploads.filter((upload) => upload.status !== 'failed'))
const activeCount = computed(() => active.value.length)
const activePercent = computed(() => {
  const total = active.value.reduce((sum, upload) => sum + upload.size, 0)
  if (!total) return 0
  const sent = active.value.reduce((sum, upload) => sum + sentBytes(upload), 0)
  return Math.min(99, Math.floor((sent / total) * 100))
})

// Leaving with uploads running loses them: they live in this page only.
watch(activeCount, (count) => {
  if (count > 0) globalThis.addEventListener?.('beforeunload', warnBeforeUnload)
  else globalThis.removeEventListener?.('beforeunload', warnBeforeUnload)
})

function warnBeforeUnload(event: BeforeUnloadEvent): void {
  event.preventDefault()
}

export function useUploadQueue(): UseUploadQueueReturn {
  return {
    all: computed(() => [...uploads]),
    uploadsIn: (folderId: number) => uploads.filter((upload) => upload.folderId === folderId),
    activeCount,
    activePercent,
    error: readonly(error),
    clearError,
    enqueue,
    enqueueDrop,
    cancel,
    cancelAll,
    retry,
    dismiss: remove,
  }
}
