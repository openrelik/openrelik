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
import { nextTick, onMounted, onUnmounted, ref, watch, type ComponentPublicInstance } from 'vue'

import PopoverSurface from '@/components/base/PopoverSurface.vue'
import { Check, Copy, MessageSquarePlus } from '@/components/icons'
import { copyToClipboard } from '@/directives/copyToClipboard'
import { formatMark, markLabel, type Mark } from '@/utils/marks'
import { place, type AnchorRect } from '@/utils/placement'

/**
 * Floating contextual action bar shown right beside a finished selection
 * (`TextViewer`, `TableViewer`, `HexViewer`, `MarkdownViewer`).
 *
 * Uses `@mousedown.prevent` so it never steals focus or clears the browser's
 * active text/byte selection—analysts can still press ⌘C immediately without
 * dismissing it first, and copying dismisses it automatically.
 */
const props = defineProps<{
  anchor: AnchorRect | null
  mark: Mark | null
}>()

const emit = defineEmits<{
  comment: [mark: Mark]
  close: []
}>()

const surface = ref<ComponentPublicInstance | null>(null)
const surfaceEl = () => (surface.value?.$el instanceof HTMLElement ? surface.value.$el : null)
const pos = ref({ left: 0, top: 0 })
const ready = ref(false)
const copied = ref(false)
let copyTimer: ReturnType<typeof setTimeout> | undefined

function clearTimer() {
  clearTimeout(copyTimer)
  copyTimer = undefined
}

async function reposition() {
  const anchor = props.anchor
  if (!anchor || !props.mark) {
    ready.value = false
    return
  }
  await nextTick()
  const el = surfaceEl()
  if (!el || !props.anchor) return
  const rect = el.getBoundingClientRect()
  const placed = place(
    anchor,
    { width: rect.width, height: rect.height },
    'bottom',
    { width: window.innerWidth, height: window.innerHeight },
    6,
    8,
  )
  pos.value = { left: placed.left, top: placed.top }
  ready.value = true
}

watch(
  [() => props.anchor, () => props.mark],
  () => {
    clearTimer()
    copied.value = false
    void reposition()
  },
  { immediate: true },
)

function dismiss() {
  if (!props.anchor) return
  clearTimer()
  emit('close')
}

function onPointerDown(event: PointerEvent) {
  if (!props.anchor) return
  if (surfaceEl()?.contains(event.target as Node)) return
  dismiss()
}

function onScroll(event: Event) {
  if (!props.anchor) return
  if (surfaceEl()?.contains(event.target as Node)) return
  dismiss()
}

function onKeyDown(event: KeyboardEvent) {
  if (!props.anchor) return
  if (event.key === 'Escape') dismiss()
  else if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'c') dismiss()
}

onMounted(() => {
  window.addEventListener('pointerdown', onPointerDown, true)
  window.addEventListener('scroll', onScroll, true)
  window.addEventListener('wheel', dismiss, { passive: true })
  window.addEventListener('resize', dismiss)
  window.addEventListener('keydown', onKeyDown, true)
  document.addEventListener('copy', dismiss)
})

onUnmounted(() => {
  clearTimer()
  window.removeEventListener('pointerdown', onPointerDown, true)
  window.removeEventListener('scroll', onScroll, true)
  window.removeEventListener('wheel', dismiss)
  window.removeEventListener('resize', dismiss)
  window.removeEventListener('keydown', onKeyDown, true)
  document.removeEventListener('copy', dismiss)
})

function onComment() {
  if (!props.mark) return
  const target = props.mark
  window.getSelection()?.removeAllRanges()
  emit('close')
  emit('comment', target)
}

async function onCopyLink() {
  if (!props.mark) return
  const url = new URL(window.location.href)
  url.hash = formatMark(props.mark)
  const ok = await copyToClipboard(url.toString())
  if (!ok) return
  copied.value = true
  clearTimer()
  copyTimer = setTimeout(() => {
    copyTimer = undefined
    emit('close')
  }, 600)
}
</script>

<template>
  <Teleport to="body">
    <Transition
      enter-active-class="transition-opacity duration-120 ease-(--ease-standard)"
      enter-from-class="opacity-0"
      leave-active-class="transition-opacity duration-120 ease-(--ease-standard)"
      leave-to-class="opacity-0"
    >
      <PopoverSurface
        v-if="anchor && mark"
        ref="surface"
        role="toolbar"
        aria-label="Selection actions"
        class="fixed z-(--z-popover) flex items-center gap-0.5 p-1 text-dense"
        :class="{ invisible: !ready }"
        :style="{ left: `${pos.left}px`, top: `${pos.top}px` }"
        @mousedown.prevent
        @pointerdown.stop
      >
        <button
          type="button"
          class="inline-flex h-6 cursor-pointer items-center gap-1.5 rounded-(--radius-control) px-2 font-medium text-ink hover:bg-sunken"
          @click="onComment"
        >
          <MessageSquarePlus
            :size="13"
            :stroke-width="1.5"
            class="shrink-0 text-ink-muted"
            aria-hidden="true"
          />
          <span>Comment</span>
        </button>
        <button
          type="button"
          class="inline-flex h-6 cursor-pointer items-center justify-center rounded-(--radius-control) px-1.5 text-ink-muted hover:bg-sunken hover:text-ink"
          :aria-label="copied ? 'Copied link' : `Copy a link to ${markLabel(mark)}`"
          v-tooltip="copied ? 'Copied' : `Copy a link to ${markLabel(mark)}`"
          @click="onCopyLink"
        >
          <Check
            v-if="copied"
            :size="13"
            :stroke-width="1.5"
            class="text-success"
            aria-hidden="true"
          />
          <Copy v-else :size="13" :stroke-width="1.5" aria-hidden="true" />
        </button>
      </PopoverSurface>
    </Transition>
  </Teleport>
</template>
