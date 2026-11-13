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
import { computed, nextTick, onMounted, onUnmounted, ref } from 'vue'
import { RouterLink } from 'vue-router'

import Button from '@/components/base/Button.vue'
import { useCaseRef } from '@/composables/useCaseRef'
import { useDelayedFlag } from '@/composables/useDelayedFlag'
import type { Item } from '@/types/item'
import { normalizeCaseRef } from '@/utils/caseRef'

/**
 * Sets, changes or clears the case of a top-level folder, in a small sheet
 * where its row menu was. While typing, the line under the input says what
 * the reference will be saved as, the way the server normalizes it, or why
 * the server would refuse it. A failed save keeps the sheet open to fix it.
 */
const props = defineProps<{
  item: Item
  /** Where the sheet's top-left corner goes; it moves inward to stay on screen. */
  x: number
  y: number
}>()
const emit = defineEmits<{ close: [] }>()

const { error, takenBy, clearError, savingIds, setCaseRef, clearCaseRef } = useCaseRef()

const sheet = ref<HTMLElement | null>(null)
const position = ref({ left: props.x, top: props.y })
const text = ref(props.item.caseRef ?? '')

const saving = computed(() => savingIds.has(props.item.id))
const showSaving = useDelayedFlag(() => saving.value)
const check = computed(() => normalizeCaseRef(text.value))

const MARGIN = 8
let alive = true

onMounted(async () => {
  clearError()
  await nextTick()
  const el = sheet.value
  if (!el) return
  const { width, height } = el.getBoundingClientRect()
  position.value = {
    left: Math.max(MARGIN, Math.min(props.x, window.innerWidth - width - MARGIN)),
    top: Math.max(MARGIN, Math.min(props.y, window.innerHeight - height - MARGIN)),
  }
})

onUnmounted(() => {
  alive = false
  clearError()
})

function close() {
  clearError()
  emit('close')
}

async function save() {
  if (saving.value || !check.value.ok) return
  if ((await setCaseRef(props.item.id, text.value)) && alive) close()
}

async function clear() {
  if ((await clearCaseRef(props.item.id)) && alive) close()
}

function onKey(event: KeyboardEvent) {
  event.stopPropagation()
  if (event.key === 'Enter') save()
  else if (event.key === 'Escape') close()
  else return
  event.preventDefault()
}
</script>

<template>
  <Teleport to="body">
    <div
      ref="sheet"
      tabindex="-1"
      class="sheet fixed z-50 w-72 p-3 text-[12px] shadow-(--shadow-float) outline-none"
      :style="{ left: `${position.left}px`, top: `${position.top}px` }"
      role="dialog"
      :aria-label="`Case of ${item.name}`"
      v-click-outside="close"
      @keydown="onKey"
    >
      <label class="micro-label block pb-1" :for="`case-ref-${item.id}`">
        case of <span class="text-ink normal-case">{{ item.name }}</span>
      </label>
      <input
        :id="`case-ref-${item.id}`"
        v-model="text"
        v-autofocus.select
        type="text"
        spellcheck="false"
        autocomplete="off"
        placeholder="e.g. IR-2024/007"
        class="field h-7 w-full font-mono"
        :aria-invalid="!!text && !check.ok"
        :readonly="saving"
      />
      <p class="mt-1 min-h-4 text-[11px] wrap-break-word">
        <span v-if="showSaving" class="inline-flex items-center gap-1.5 text-brand">
          <span class="size-1.5 animate-pulse rounded-full bg-brand" aria-hidden="true" />
          saving…
        </span>
        <span v-else-if="error" class="text-danger" role="alert">
          {{ error }}
          <RouterLink
            v-if="takenBy !== null"
            :to="`/folder/${takenBy}`"
            class="text-brand underline hover:text-ink"
            @click="close"
            >open that folder</RouterLink
          >
        </span>
        <span v-else-if="!text" class="text-ink-muted">the case's id in your case system</span>
        <span v-else-if="!check.ok" class="text-danger">{{ check.reason }}</span>
        <span v-else class="text-ink-muted"
          >saved as <span class="tabular text-ink">{{ check.value }}</span></span
        >
      </p>
      <div class="mt-2 flex gap-1.5">
        <Button
          size="row"
          :disabled="saving || !check.ok"
          :tooltip="item.caseRef ? undefined : 'Make this the case folder'"
          @click="save"
        >
          Save
        </Button>
        <Button variant="ghost" size="row" @click="close">Cancel</Button>
        <Button
          v-if="item.caseRef"
          variant="danger"
          size="row"
          class="ml-auto"
          :disabled="saving"
          :tooltip="{ text: 'Remove the case', detail: 'The folder stays' }"
          @click="clear"
        >
          Clear
        </Button>
      </div>
    </div>
  </Teleport>
</template>
