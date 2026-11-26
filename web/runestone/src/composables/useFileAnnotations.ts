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
 * File Annotations Composable
 *
 * Loads, caches, and mutates selection annotations and threaded replies for the
 * file on screen. Backed by `useQueryCache` (stale-while-revalidate) and a
 * module-scoped map cleared on sign-out via `clearFileAnnotations()`.
 */

import { computed, onScopeDispose, reactive, ref, watch, type ComputedRef } from 'vue'

import {
  api,
  type CreateFileAnnotationInput,
  type FileAnnotationRecord,
  type FileAnnotationReplyRecord,
} from '@/api'
import { useAutoRefresh } from '@/composables/useAutoRefresh'
import { ensure, markFresh, queryState, type QueryState } from '@/composables/useQueryCache'
import { useItemsStore } from '@/stores/items'

const byFile = reactive<Record<number, FileAnnotationRecord[]>>({})

const annotationsKey = (fileId: number) => `file:${fileId}:annotations`

function syncFileAnnotationCount(fileId: number, total: number): void {
  const file = useItemsStore().findFile(fileId)
  if (file) file.annotationCount = total
}

function sortAnnotations(list: FileAnnotationRecord[]): FileAnnotationRecord[] {
  return [...list].sort((a, b) => {
    if (a.anchor_kind !== b.anchor_kind) return a.anchor_kind.localeCompare(b.anchor_kind)
    if (a.range_start !== b.range_start) return a.range_start - b.range_start
    if (a.range_end !== b.range_end) return a.range_end - b.range_end
    return a.id - b.id
  })
}

/** Clears cached annotations across all files on sign-out. */
export function clearFileAnnotations(): void {
  for (const key of Object.keys(byFile)) {
    delete byFile[Number(key)]
  }
}

export interface UseFileAnnotationsReturn {
  annotations: ComputedRef<FileAnnotationRecord[]>
  state: ComputedRef<QueryState>
  reload: (force?: boolean) => Promise<void>
  createAnnotation: (payload: CreateFileAnnotationInput) => Promise<FileAnnotationRecord>
  updateAnnotation: (annotationId: number, body: string) => Promise<FileAnnotationRecord>
  deleteAnnotation: (annotationId: number) => Promise<void>
  createReply: (annotationId: number, body: string) => Promise<FileAnnotationReplyRecord>
  updateReply: (
    annotationId: number,
    replyId: number,
    body: string,
  ) => Promise<FileAnnotationReplyRecord>
  deleteReply: (annotationId: number, replyId: number) => Promise<void>
}

/** Keeps selection annotations for the given file loaded and mutable. */
export function useFileAnnotations(fileId: () => number | undefined): UseFileAnnotationsReturn {
  let controller: AbortController | undefined
  let disposed = false

  async function load(force = false): Promise<void> {
    controller?.abort()
    const id = fileId()
    if (disposed || id === undefined) return
    const mine = new AbortController()
    controller = mine
    await ensure(
      annotationsKey(id),
      async (signal) => {
        const list = await api.annotations.list(id, { signal })
        byFile[id] = sortAnnotations(list)
        syncFileAnnotationCount(id, list.length)
      },
      { force, signal: mine.signal },
    ).catch(() => {})
  }

  watch(fileId, () => void load(false), { immediate: true })
  useAutoRefresh(({ force }) => load(force))
  onScopeDispose(() => {
    disposed = true
    controller?.abort()
  })

  const annotations = computed<FileAnnotationRecord[]>(() => {
    const id = fileId()
    return id !== undefined ? (byFile[id] ?? []) : []
  })

  const state = computed<QueryState>(() => {
    const id = fileId()
    return id !== undefined
      ? queryState(annotationsKey(id))
      : { status: 'idle', isFetching: false, error: null, errorStatus: null, fetchedAt: 0 }
  })

  function requireFileId(): number {
    const id = fileId()
    if (id === undefined) throw new Error('No active file selected')
    return id
  }

  async function createAnnotation(
    payload: CreateFileAnnotationInput,
  ): Promise<FileAnnotationRecord> {
    const id = requireFileId()
    const created = await api.annotations.create(id, payload)
    const current = byFile[id] ?? []
    byFile[id] = sortAnnotations([...current.filter((a) => a.id !== created.id), created])
    syncFileAnnotationCount(id, byFile[id]!.length)
    markFresh(annotationsKey(id))
    return created
  }

  async function updateAnnotation(
    annotationId: number,
    body: string,
  ): Promise<FileAnnotationRecord> {
    const id = requireFileId()
    const updated = await api.annotations.update(id, annotationId, body)
    const current = byFile[id] ?? []
    byFile[id] = current.map((a) => (a.id === updated.id ? updated : a))
    markFresh(annotationsKey(id))
    return updated
  }

  async function deleteAnnotation(annotationId: number): Promise<void> {
    const id = requireFileId()
    await api.annotations.remove(id, annotationId)
    const current = byFile[id] ?? []
    byFile[id] = current.filter((a) => a.id !== annotationId)
    syncFileAnnotationCount(id, byFile[id]!.length)
    markFresh(annotationsKey(id))
  }

  async function createReply(
    annotationId: number,
    body: string,
  ): Promise<FileAnnotationReplyRecord> {
    const id = requireFileId()
    const created = await api.annotations.createReply(id, annotationId, body)
    const current = byFile[id] ?? []
    byFile[id] = current.map((a) =>
      a.id === annotationId ? { ...a, replies: [...a.replies, created] } : a,
    )
    markFresh(annotationsKey(id))
    return created
  }

  async function updateReply(
    annotationId: number,
    replyId: number,
    body: string,
  ): Promise<FileAnnotationReplyRecord> {
    const id = requireFileId()
    const updated = await api.annotations.updateReply(id, annotationId, replyId, body)
    const current = byFile[id] ?? []
    byFile[id] = current.map((a) =>
      a.id === annotationId
        ? { ...a, replies: a.replies.map((r) => (r.id === updated.id ? updated : r)) }
        : a,
    )
    markFresh(annotationsKey(id))
    return updated
  }

  async function deleteReply(annotationId: number, replyId: number): Promise<void> {
    const id = requireFileId()
    await api.annotations.removeReply(id, annotationId, replyId)
    const current = byFile[id] ?? []
    byFile[id] = current.map((a) =>
      a.id === annotationId ? { ...a, replies: a.replies.filter((r) => r.id !== replyId) } : a,
    )
    markFresh(annotationsKey(id))
  }

  return {
    annotations,
    state,
    reload: (force = true) => load(force),
    createAnnotation,
    updateAnnotation,
    deleteAnnotation,
    createReply,
    updateReply,
    deleteReply,
  }
}

/**
 * Triggers a transient CSS pulse flag whenever `pulseKey` increments (e.g.,
 * clicking a comment in the sidebar to jump to its range in a viewer).
 */
export function useAnnotationPulse(pulseKey: () => number | undefined) {
  const pulsing = ref(false)
  let rafId: number | undefined
  let timerId: ReturnType<typeof setTimeout> | undefined

  function trigger() {
    if (rafId !== undefined) cancelAnimationFrame(rafId)
    clearTimeout(timerId)
    pulsing.value = false
    rafId = requestAnimationFrame(() => {
      rafId = undefined
      pulsing.value = true
      timerId = setTimeout(() => {
        timerId = undefined
        pulsing.value = false
      }, 800)
    })
  }

  watch(pulseKey, (next, prev) => {
    if (next && next !== prev) trigger()
  })

  onScopeDispose(() => {
    if (rafId !== undefined) cancelAnimationFrame(rafId)
    clearTimeout(timerId)
  })

  return { pulsing, trigger }
}
