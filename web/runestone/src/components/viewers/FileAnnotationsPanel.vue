<!--
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
-->
<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'

import Button from '@/components/base/Button.vue'
import LoadState from '@/components/base/LoadState.vue'
import PopoverSurface from '@/components/base/PopoverSurface.vue'
import UserAvatar from '@/components/base/UserAvatar.vue'
import { Check, EllipsisVertical, X } from '@/components/icons'
import { confirmAction } from '@/composables/useConfirm'
import type { QueryState } from '@/composables/useQueryCache'
import { copyToClipboard } from '@/directives/copyToClipboard'
import { useAuthStore } from '@/stores/auth'
import { errorMessage, type FileAnnotationRecord, type FileAnnotationReplyRecord } from '@/api'
import {
  annotationChip,
  annotationLabel,
  annotationMark,
  escapeAnnotationText,
} from '@/utils/annotations'
import { count, stamp } from '@/utils/format'
import { formatMark, markLabel, type Mark } from '@/utils/marks'

/**
 * Comments panel for a file's selection annotations.
 *
 * Mirrors Google Docs' thread structure inside Runestone's console design
 * system: flush-left messages (avatar + stacked author/UTC timestamp, body
 * below, replies stacked at the same alignment with no indentation), a single
 * overflow `⋯` menu per message, no badges or left-edge highlight bars, and an
 * inline Reply field at the bottom of the active thread. Bodies render strictly
 * as escaped plain text so pasted evidence stays inert.
 */
const props = defineProps<{
  annotations: FileAnnotationRecord[]
  state: QueryState
  /** Active selection mark being commented on; null when composer is closed. */
  draftMark: Mark | null
  /** Currently focused annotation ID. */
  activeId: number | null
  /** Optional filter when the user clicked an overlapping region. */
  filterIds: number[] | null
  /** Label describing the clicked overlap location (e.g. "line 14"). */
  filterLabel: string | null
  onCreate: (mark: Mark, body: string) => Promise<FileAnnotationRecord>
  onUpdate: (annotationId: number, body: string) => Promise<FileAnnotationRecord>
  onDelete: (annotationId: number) => Promise<void>
  onCreateReply: (annotationId: number, body: string) => Promise<FileAnnotationReplyRecord>
  onUpdateReply: (
    annotationId: number,
    replyId: number,
    body: string,
  ) => Promise<FileAnnotationReplyRecord>
  onDeleteReply: (annotationId: number, replyId: number) => Promise<void>
}>()

const emit = defineEmits<{
  retry: []
  cancelDraft: []
  select: [annotation: FileAnnotationRecord]
  deselect: []
  clearFilter: []
}>()

const authStore = useAuthStore()
const currentUserId = computed(() =>
  authStore.user?.id !== undefined ? Number(authStore.user.id) : null,
)
const isAdmin = computed(() => !!authStore.user?.is_admin)

const visibleAnnotations = computed(() => {
  if (!props.filterIds?.length) return props.annotations
  const allowed = new Set(props.filterIds)
  return props.annotations.filter((a) => allowed.has(a.id))
})

// --- new comment composer ---

const draftBody = ref('')
const draftError = ref<string | null>(null)
const draftSaving = ref(false)
const draftInput = ref<HTMLTextAreaElement | null>(null)

watch(
  () => props.draftMark,
  (next) => {
    draftError.value = null
    if (next) {
      void nextTick(() => draftInput.value?.focus())
    } else {
      draftBody.value = ''
    }
  },
)

const draftChip = computed(() => (props.draftMark ? formatMark(props.draftMark).slice(1) : ''))
const draftLabel = computed(() => (props.draftMark ? markLabel(props.draftMark) : ''))

let unmounted = false

async function submitDraft() {
  const mark = props.draftMark
  const body = draftBody.value.trim()
  if (!mark || !body || draftSaving.value) return
  draftSaving.value = true
  draftError.value = null
  try {
    const created = await props.onCreate(mark, body)
    if (unmounted) return
    draftBody.value = ''
    emit('cancelDraft')
    emit('select', created)
  } catch (err: unknown) {
    if (!unmounted) draftError.value = errorMessage(err, 'Could not save comment')
  } finally {
    if (!unmounted) draftSaving.value = false
  }
}

// --- overflow menu (`⋯`) per message ---

const openMenuKey = ref<string | null>(null)
const copiedCommentId = ref<number | null>(null)
let copyTimer: ReturnType<typeof setTimeout> | undefined

function toggleMenu(key: string) {
  openMenuKey.value = openMenuKey.value === key ? null : key
  copiedCommentId.value = null
}

function closeMenu() {
  clearTimeout(copyTimer)
  copyTimer = undefined
  openMenuKey.value = null
  copiedCommentId.value = null
}

async function copyCommentLink(annotation: FileAnnotationRecord) {
  const url = new URL(window.location.href)
  if (annotation.anchor_kind !== 'line') url.searchParams.delete('view')
  url.searchParams.set('comment', String(annotation.id))
  url.hash = formatMark(annotationMark(annotation))
  const ok = await copyToClipboard(url.toString())
  if (!ok || unmounted) return
  copiedCommentId.value = annotation.id
  clearTimeout(copyTimer)
  copyTimer = setTimeout(() => {
    closeMenu()
  }, 600)
}

// --- inline editing ---

const editingAnnotationId = ref<number | null>(null)
const editingReplyKey = ref<string | null>(null)
const editBody = ref('')
const editError = ref<string | null>(null)
const editSaving = ref(false)

function startEditAnnotation(annotation: FileAnnotationRecord) {
  closeMenu()
  editingReplyKey.value = null
  editingAnnotationId.value = annotation.id
  editBody.value = annotation.body
  editError.value = null
}

function startEditReply(annotationId: number, reply: FileAnnotationReplyRecord) {
  closeMenu()
  editingAnnotationId.value = null
  editingReplyKey.value = `${annotationId}:${reply.id}`
  editBody.value = reply.body
  editError.value = null
}

function cancelEdit() {
  editingAnnotationId.value = null
  editingReplyKey.value = null
  editBody.value = ''
  editError.value = null
}

async function saveEditAnnotation(annotationId: number) {
  const body = editBody.value.trim()
  if (!body || editSaving.value) return
  editSaving.value = true
  editError.value = null
  try {
    await props.onUpdate(annotationId, body)
    if (unmounted) return
    cancelEdit()
  } catch (err: unknown) {
    if (!unmounted) editError.value = errorMessage(err, 'Could not update comment')
  } finally {
    if (!unmounted) editSaving.value = false
  }
}

async function saveEditReply(annotationId: number, replyId: number) {
  const body = editBody.value.trim()
  if (!body || editSaving.value) return
  editSaving.value = true
  editError.value = null
  try {
    await props.onUpdateReply(annotationId, replyId, body)
    if (unmounted) return
    cancelEdit()
  } catch (err: unknown) {
    if (!unmounted) editError.value = errorMessage(err, 'Could not update reply')
  } finally {
    if (!unmounted) editSaving.value = false
  }
}

// --- deletion ---

const actionError = ref<string | null>(null)

async function removeAnnotation(annotation: FileAnnotationRecord) {
  closeMenu()
  const replyCount = annotation.replies.length
  const ok = await confirmAction({
    title: 'Delete comment?',
    message:
      replyCount > 0
        ? `This deletes the comment on ${annotationLabel(annotation)} and its ${count(replyCount, 'reply', 'replies')}.`
        : `This deletes the comment on ${annotationLabel(annotation)}.`,
    confirmLabel: 'Delete',
    danger: true,
  })
  if (!ok || unmounted) return
  actionError.value = null
  try {
    await props.onDelete(annotation.id)
  } catch (err: unknown) {
    if (!unmounted) actionError.value = errorMessage(err, 'Could not delete comment')
  }
}

async function removeReply(annotationId: number, reply: FileAnnotationReplyRecord) {
  closeMenu()
  const ok = await confirmAction({
    title: 'Delete reply?',
    message: 'This deletes the reply from the thread.',
    confirmLabel: 'Delete',
    danger: true,
  })
  if (!ok || unmounted) return
  actionError.value = null
  try {
    await props.onDeleteReply(annotationId, reply.id)
  } catch (err: unknown) {
    if (!unmounted) actionError.value = errorMessage(err, 'Could not delete reply')
  }
}

// --- inline reply box (Google Docs style at bottom of active thread) ---

const replyTextById = ref<Record<number, string>>({})
const expandedReplyId = ref<number | null>(null)
const replyError = ref<string | null>(null)
const replySaving = ref(false)

function replyDraft(annotationId: number): string {
  return replyTextById.value[annotationId] ?? ''
}

function setReplyDraft(annotationId: number, value: string) {
  replyTextById.value = { ...replyTextById.value, [annotationId]: value }
}

function focusReply(annotationId: number) {
  expandedReplyId.value = annotationId
  replyError.value = null
}

function cancelReply(annotationId: number) {
  setReplyDraft(annotationId, '')
  if (expandedReplyId.value === annotationId) expandedReplyId.value = null
  replyError.value = null
}

async function submitReply(annotationId: number) {
  const body = replyDraft(annotationId).trim()
  if (!body || replySaving.value) return
  replySaving.value = true
  replyError.value = null
  try {
    await props.onCreateReply(annotationId, body)
    if (unmounted) return
    cancelReply(annotationId)
  } catch (err: unknown) {
    if (!unmounted) replyError.value = errorMessage(err, 'Could not save reply')
  } finally {
    if (!unmounted) replySaving.value = false
  }
}

const canEdit = (userId: number) => currentUserId.value === userId
const canDelete = (userId: number) => currentUserId.value === userId || isAdmin.value
const hasMenu = (userId: number) => canEdit(userId) || canDelete(userId)

// --- long comment truncation ("Show more" / "Show less") ---

const panelEl = ref<HTMLElement | null>(null)
const expandedMessages = ref<Set<string>>(new Set())
const overflowingMessages = ref<Set<string>>(new Set())
const bodyRefs = new Map<string, HTMLElement>()

function setBodyRef(key: string, el: unknown) {
  if (el instanceof HTMLElement) bodyRefs.set(key, el)
  else bodyRefs.delete(key)
}

function looksLong(text: string): boolean {
  return text.length > 180 || text.split('\n').length > 3
}

function measureOverflows() {
  const next = new Set<string>()
  for (const [key, el] of bodyRefs) {
    if (expandedMessages.value.has(key)) continue
    if (el.clientHeight > 0) {
      if (el.scrollHeight > el.clientHeight + 1) next.add(key)
    } else if (looksLong(el.textContent ?? '')) {
      next.add(key)
    }
  }
  overflowingMessages.value = next
}

function isExpanded(key: string): boolean {
  return expandedMessages.value.has(key)
}

function showExpandToggle(key: string): boolean {
  return expandedMessages.value.has(key) || overflowingMessages.value.has(key)
}

function toggleExpanded(key: string) {
  const next = new Set(expandedMessages.value)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  expandedMessages.value = next
  void nextTick(measureOverflows)
}

let resizeObserver: ResizeObserver | undefined
onMounted(() => {
  measureOverflows()
  if (typeof ResizeObserver !== 'undefined' && panelEl.value) {
    resizeObserver = new ResizeObserver(measureOverflows)
    resizeObserver.observe(panelEl.value)
  }
})
onUnmounted(() => {
  unmounted = true
  clearTimeout(copyTimer)
  resizeObserver?.disconnect()
})

watch(
  [visibleAnnotations, editingAnnotationId, editingReplyKey],
  () => void nextTick(measureOverflows),
  { deep: true },
)

const cardRefs = new Map<number, HTMLElement>()
function setCardRef(id: number, el: unknown) {
  if (el instanceof HTMLElement) cardRefs.set(id, el)
  else cardRefs.delete(id)
}

watch(
  () => props.activeId,
  (id) => {
    closeMenu()
    if (id === null) return
    void nextTick(() => {
      cardRefs.get(id)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    })
  },
)
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** Compact UTC timestamp ("Nov 25, 20:31"); exact seconds stay on the tooltip. */
function shortStamp(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return stamp(iso)
  const mon = MONTHS[date.getUTCMonth()]
  const day = date.getUTCDate()
  const hh = String(date.getUTCHours()).padStart(2, '0')
  const mm = String(date.getUTCMinutes()).padStart(2, '0')
  const year = date.getUTCFullYear()
  const sameYear = year === new Date().getUTCFullYear()
  return sameYear ? `${mon} ${day}, ${hh}:${mm}` : `${mon} ${day} ${year}, ${hh}:${mm}`
}

function onPanelClick(event: MouseEvent) {
  if (props.activeId === null) return
  if (!(window.getSelection()?.isCollapsed ?? true)) return
  if ((event.target as Element | null)?.closest('article, [data-annotation-chrome]')) return
  emit('deselect')
}
</script>

<template>
  <div ref="panelEl" class="flex min-h-full flex-1 flex-col text-body" @click="onPanelClick">
    <!-- New comment composer -->
    <div
      v-if="draftMark"
      data-annotation-chrome
      class="mx-2.5 mt-2.5 flex flex-col gap-2 rounded-(--radius-card) border border-warning-icon/40 bg-warning-tint/35 p-3"
    >
      <div class="flex items-center justify-between gap-2">
        <span class="tabular font-mono text-badge text-annotation" v-tooltip="draftLabel">
          {{ draftChip }}
        </span>
        <button
          type="button"
          class="flex size-5 cursor-pointer items-center justify-center rounded-(--radius-control) text-ink-muted hover:bg-surface/80 hover:text-ink"
          aria-label="Cancel new comment"
          v-tooltip="'Cancel'"
          @click="emit('cancelDraft')"
        >
          <X :size="12" :stroke-width="1.5" />
        </button>
      </div>
      <textarea
        ref="draftInput"
        v-model="draftBody"
        rows="3"
        placeholder="Comment…"
        aria-label="New comment body"
        class="field h-auto min-h-16 w-full resize-y py-1.5 text-body leading-snug"
        @keydown.meta.enter.prevent="submitDraft"
        @keydown.ctrl.enter.prevent="submitDraft"
        @keydown.esc.stop="emit('cancelDraft')"
      />
      <p v-if="draftError" class="text-dense text-danger" role="alert">{{ draftError }}</p>
      <div class="flex items-center justify-end gap-1.5">
        <Button size="row" variant="ghost" :disabled="draftSaving" @click="emit('cancelDraft')">
          Cancel
        </Button>
        <Button
          size="row"
          variant="brand"
          :disabled="!draftBody.trim() || draftSaving"
          @click="submitDraft"
        >
          {{ draftSaving ? 'Saving…' : 'Comment' }}
        </Button>
      </div>
    </div>

    <!-- Active overlap filter bar -->
    <div
      v-if="filterIds?.length"
      data-annotation-chrome
      class="flex items-center justify-between gap-2 border-b border-border bg-sunken px-3 py-1.5 text-dense text-ink-secondary"
    >
      <span class="tabular truncate">
        {{ count(visibleAnnotations.length, 'comment') }}
        <template v-if="filterLabel"> at {{ filterLabel }}</template>
      </span>
      <Button size="row" variant="ghost" class="shrink-0" @click="emit('clearFilter')">
        Show all
      </Button>
    </div>

    <p v-if="actionError" class="px-3 pt-2 text-dense text-danger" role="alert">
      {{ actionError }}
    </p>

    <LoadState
      :state="state"
      noun="comments"
      :has-content="visibleAnnotations.length > 0"
      @retry="emit('retry')"
    >
      <template #empty>
        <span class="text-dense text-ink-muted">
          No comments yet. Select lines, text, rows, or bytes to annotate.
        </span>
      </template>
    </LoadState>

    <div v-if="visibleAnnotations.length" class="flex flex-col gap-2.5 p-2.5">
      <article
        v-for="annotation in visibleAnnotations"
        :key="annotation.id"
        :ref="(el) => setCardRef(annotation.id, el)"
        role="comment"
        class="flex flex-col divide-y rounded-(--radius-card) border transition-colors duration-120"
        :class="
          activeId === annotation.id
            ? 'divide-warning-icon/20 border-warning-icon/40 bg-warning-tint/35'
            : 'divide-border/60 border-border bg-transparent hover:border-border-strong hover:bg-sunken/40'
        "
        @click="emit('select', annotation)"
      >
        <!-- Root comment -->
        <div class="flex flex-col gap-1.5 px-3 py-2.5">
          <div class="flex items-center gap-2">
            <UserAvatar
              :name="annotation.user.display_name"
              :username="annotation.user.username"
              :src="annotation.user.profile_picture_url"
              :uuid="annotation.user.uuid"
              size="sm"
              decorative
            />
            <div class="flex min-w-0 flex-1 items-baseline gap-1.5">
              <span class="truncate text-dense font-medium text-ink">
                {{ annotation.user.display_name || annotation.user.username }}
              </span>
              <time
                :datetime="annotation.created_at"
                class="tabular shrink-0 text-badge text-ink-muted"
                v-tooltip="`${stamp(annotation.created_at)} UTC`"
                >{{ shortStamp(annotation.created_at) }}</time
              >
              <span v-if="annotation.edited_at" class="shrink-0 text-badge text-ink-muted">
                · edited
              </span>
            </div>

            <button
              type="button"
              class="tabular shrink-0 cursor-pointer font-mono text-badge hover:text-annotation"
              :class="activeId === annotation.id ? 'text-annotation' : 'text-ink-muted'"
              :aria-label="`Jump to ${annotationLabel(annotation)}`"
              v-tooltip="`Jump to ${annotationLabel(annotation)}`"
              @click.stop="emit('select', annotation)"
            >
              {{ annotationChip(annotation) }}
            </button>

            <div
              v-if="activeId === annotation.id"
              v-click-outside="() => openMenuKey === `a:${annotation.id}` && closeMenu()"
              class="relative -mr-1 shrink-0"
              @click.stop
            >
              <button
                type="button"
                class="flex size-5 cursor-pointer items-center justify-center rounded-(--radius-control) text-ink-muted hover:bg-surface/80 hover:text-ink"
                aria-label="Comment actions"
                v-tooltip="'More options'"
                @click="toggleMenu(`a:${annotation.id}`)"
              >
                <EllipsisVertical :size="14" :stroke-width="1.5" />
              </button>
              <PopoverSurface
                v-if="openMenuKey === `a:${annotation.id}`"
                class="absolute top-full right-0 z-(--z-popover) mt-1 min-w-32 py-1 text-dense"
                role="menu"
              >
                <button
                  type="button"
                  role="menuitem"
                  class="flex w-full cursor-pointer items-center justify-between gap-2 px-2.5 py-1 text-left text-ink hover:bg-sunken"
                  @click="copyCommentLink(annotation)"
                >
                  <span>{{ copiedCommentId === annotation.id ? 'Link copied' : 'Copy link' }}</span>
                  <Check
                    v-if="copiedCommentId === annotation.id"
                    :size="12"
                    :stroke-width="1.5"
                    class="shrink-0 text-success"
                    aria-hidden="true"
                  />
                </button>
                <div v-if="hasMenu(annotation.user_id)" class="my-1 border-t border-border" />
                <button
                  v-if="canEdit(annotation.user_id)"
                  type="button"
                  role="menuitem"
                  class="flex w-full cursor-pointer items-center px-2.5 py-1 text-left text-ink hover:bg-sunken"
                  @click="startEditAnnotation(annotation)"
                >
                  Edit
                </button>
                <button
                  v-if="canDelete(annotation.user_id)"
                  type="button"
                  role="menuitem"
                  class="flex w-full cursor-pointer items-center px-2.5 py-1 text-left text-danger hover:bg-danger-tint"
                  @click="removeAnnotation(annotation)"
                >
                  Delete
                </button>
              </PopoverSurface>
            </div>
          </div>

          <div
            v-if="editingAnnotationId === annotation.id"
            class="flex flex-col gap-1.5"
            @click.stop
          >
            <textarea
              v-model="editBody"
              v-autofocus
              rows="3"
              aria-label="Edit comment body"
              class="field h-auto min-h-14 w-full resize-y py-1.5 text-body leading-snug"
              @keydown.meta.enter.prevent="saveEditAnnotation(annotation.id)"
              @keydown.ctrl.enter.prevent="saveEditAnnotation(annotation.id)"
              @keydown.esc.stop="cancelEdit"
            />
            <p v-if="editError" class="text-dense text-danger" role="alert">{{ editError }}</p>
            <div class="flex justify-end gap-1.5">
              <Button size="row" variant="ghost" :disabled="editSaving" @click="cancelEdit">
                Cancel
              </Button>
              <Button
                size="row"
                variant="brand"
                :disabled="!editBody.trim() || editSaving"
                @click="saveEditAnnotation(annotation.id)"
              >
                {{ editSaving ? 'Saving…' : 'Save' }}
              </Button>
            </div>
          </div>
          <div v-else class="flex flex-col items-start gap-1">
            <p
              :ref="(el) => setBodyRef(`a:${annotation.id}`, el)"
              class="w-full whitespace-pre-wrap wrap-break-word text-body leading-snug text-ink"
              :class="{ 'line-clamp-3': !isExpanded(`a:${annotation.id}`) }"
            >
              {{ escapeAnnotationText(annotation.body) }}
            </p>
            <button
              v-if="showExpandToggle(`a:${annotation.id}`)"
              type="button"
              class="cursor-pointer text-dense text-ink-muted hover:text-ink"
              @click.stop="toggleExpanded(`a:${annotation.id}`)"
            >
              {{ isExpanded(`a:${annotation.id}`) ? 'Show less' : 'Show more' }}
            </button>
          </div>
        </div>

        <!-- Replies: same flush-left layout, separated edge-to-edge by card dividers -->
        <div
          v-for="reply in annotation.replies"
          :key="reply.id"
          role="comment"
          class="flex flex-col gap-1.5 px-3 py-2.5"
        >
          <div class="flex items-center gap-2">
            <UserAvatar
              :name="reply.user.display_name"
              :username="reply.user.username"
              :src="reply.user.profile_picture_url"
              :uuid="reply.user.uuid"
              size="sm"
              decorative
            />
            <div class="flex min-w-0 flex-1 items-baseline gap-1.5">
              <span class="truncate text-dense font-medium text-ink">
                {{ reply.user.display_name || reply.user.username }}
              </span>
              <time
                :datetime="reply.created_at"
                class="tabular shrink-0 text-badge text-ink-muted"
                v-tooltip="`${stamp(reply.created_at)} UTC`"
                >{{ shortStamp(reply.created_at) }}</time
              >
              <span v-if="reply.edited_at" class="shrink-0 text-badge text-ink-muted">
                · edited
              </span>
            </div>

            <div
              v-if="activeId === annotation.id && hasMenu(reply.user_id)"
              v-click-outside="() => openMenuKey === `r:${reply.id}` && closeMenu()"
              class="relative -mr-1 shrink-0"
              @click.stop
            >
              <button
                type="button"
                class="flex size-5 cursor-pointer items-center justify-center rounded-(--radius-control) text-ink-muted hover:bg-surface/80 hover:text-ink"
                aria-label="Reply actions"
                v-tooltip="'More options'"
                @click="toggleMenu(`r:${reply.id}`)"
              >
                <EllipsisVertical :size="14" :stroke-width="1.5" />
              </button>
              <PopoverSurface
                v-if="openMenuKey === `r:${reply.id}`"
                class="absolute top-full right-0 z-(--z-popover) mt-1 min-w-28 py-1 text-dense"
                role="menu"
              >
                <button
                  v-if="canEdit(reply.user_id)"
                  type="button"
                  role="menuitem"
                  class="flex w-full cursor-pointer items-center px-2.5 py-1 text-left text-ink hover:bg-sunken"
                  @click="startEditReply(annotation.id, reply)"
                >
                  Edit
                </button>
                <div
                  v-if="canEdit(reply.user_id) && canDelete(reply.user_id)"
                  class="my-1 border-t border-border"
                />
                <button
                  v-if="canDelete(reply.user_id)"
                  type="button"
                  role="menuitem"
                  class="flex w-full cursor-pointer items-center px-2.5 py-1 text-left text-danger hover:bg-danger-tint"
                  @click="removeReply(annotation.id, reply)"
                >
                  Delete
                </button>
              </PopoverSurface>
            </div>
          </div>

          <div
            v-if="editingReplyKey === `${annotation.id}:${reply.id}`"
            class="flex flex-col gap-1.5"
            @click.stop
          >
            <textarea
              v-model="editBody"
              v-autofocus
              rows="2"
              aria-label="Edit reply body"
              class="field h-auto min-h-12 w-full resize-y py-1 text-body leading-snug"
              @keydown.meta.enter.prevent="saveEditReply(annotation.id, reply.id)"
              @keydown.ctrl.enter.prevent="saveEditReply(annotation.id, reply.id)"
              @keydown.esc.stop="cancelEdit"
            />
            <p v-if="editError" class="text-dense text-danger" role="alert">{{ editError }}</p>
            <div class="flex justify-end gap-1.5">
              <Button size="row" variant="ghost" :disabled="editSaving" @click="cancelEdit">
                Cancel
              </Button>
              <Button
                size="row"
                variant="brand"
                :disabled="!editBody.trim() || editSaving"
                @click="saveEditReply(annotation.id, reply.id)"
              >
                {{ editSaving ? 'Saving…' : 'Save' }}
              </Button>
            </div>
          </div>
          <div v-else class="flex flex-col items-start gap-1">
            <p
              :ref="(el) => setBodyRef(`r:${reply.id}`, el)"
              class="w-full whitespace-pre-wrap wrap-break-word text-body leading-snug text-ink"
              :class="{ 'line-clamp-3': !isExpanded(`r:${reply.id}`) }"
            >
              {{ escapeAnnotationText(reply.body) }}
            </p>
            <button
              v-if="showExpandToggle(`r:${reply.id}`)"
              type="button"
              class="cursor-pointer text-dense text-ink-muted hover:text-ink"
              @click.stop="toggleExpanded(`r:${reply.id}`)"
            >
              {{ isExpanded(`r:${reply.id}`) ? 'Show less' : 'Show more' }}
            </button>
          </div>
        </div>

        <!-- Reply input: quiet hairline prompt at rest, crisp field once focused -->
        <div
          v-if="activeId === annotation.id || expandedReplyId === annotation.id"
          class="flex flex-col gap-1.5 px-3 py-2"
          @click.stop
        >
          <textarea
            :value="replyDraft(annotation.id)"
            :rows="expandedReplyId === annotation.id || replyDraft(annotation.id) ? 2 : 1"
            placeholder="Reply…"
            aria-label="Reply to comment"
            :class="
              expandedReplyId === annotation.id || replyDraft(annotation.id)
                ? 'field h-auto min-h-12 w-full resize-none py-1.5 text-body leading-snug'
                : 'h-auto min-h-6 w-full resize-none bg-transparent py-0.5 text-body leading-snug text-ink placeholder:text-ink-muted focus:outline-none'
            "
            @focus="focusReply(annotation.id)"
            @input="setReplyDraft(annotation.id, ($event.target as HTMLTextAreaElement).value)"
            @keydown.meta.enter.prevent="submitReply(annotation.id)"
            @keydown.ctrl.enter.prevent="submitReply(annotation.id)"
            @keydown.esc.stop="cancelReply(annotation.id)"
          />
          <p
            v-if="replyError && expandedReplyId === annotation.id"
            class="text-dense text-danger"
            role="alert"
          >
            {{ replyError }}
          </p>
          <div
            v-if="expandedReplyId === annotation.id || replyDraft(annotation.id).trim()"
            class="flex justify-end gap-1.5"
          >
            <Button
              size="row"
              variant="ghost"
              :disabled="replySaving"
              @click="cancelReply(annotation.id)"
            >
              Cancel
            </Button>
            <Button
              size="row"
              variant="brand"
              :disabled="!replyDraft(annotation.id).trim() || replySaving"
              @click="submitReply(annotation.id)"
            >
              {{ replySaving ? 'Replying…' : 'Reply' }}
            </Button>
          </div>
        </div>
      </article>
    </div>
  </div>
</template>
