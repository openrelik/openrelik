<script setup lang="ts">
import { computed, watch } from 'vue'
import { TriangleAlert, X } from '@/components/icons'
import Button from '@/components/base/Button.vue'
import { useConfirm } from '@/composables/useConfirm'
import { useModalStore } from '@/stores/modals'

/**
 * ConfirmDialog — the one confirmation step for actions that cannot be undone
 *
 * Opened through `confirmAction()`. The confirm button has focus, so ⏎
 * confirms and Tab reaches Cancel; Esc (the global modal handler) and a
 * click outside cancel. With a text field (`askForText()`) the field has
 * focus instead, ⏎ in it confirms, and an empty one cannot be confirmed.
 */
const { isOpen, request, accept, cancel, text } = useConfirm()
const blank = computed(() => !!request.value?.field && !text.value.trim())

function submit() {
  if (!blank.value) accept()
}
const modalStore = useModalStore()

/** The dialog lists this many names; the rest are counted. */
const MAX_LISTED = 5
const listed = computed(() => request.value?.items?.slice(0, MAX_LISTED) ?? [])
const unlisted = computed(() => Math.max(0, (request.value?.items?.length ?? 0) - MAX_LISTED))

// Esc closes the topmost modal from the global keyboard handler: treat it as cancel.
watch(
  () => modalStore.isModalOpen('confirm'),
  (open) => {
    if (!open) cancel()
  },
)
</script>

<template>
  <Teleport to="body">
    <div v-if="isOpen && request" class="fixed inset-0 z-50">
      <div
        class="absolute inset-0 bg-ink/20 backdrop-blur-[1px]"
        aria-hidden="true"
        @pointerdown="cancel"
      />

      <div
        v-trap-focus
        class="sheet absolute top-[18vh] left-1/2 flex w-[min(26rem,calc(100vw-2rem))] -translate-x-1/2 flex-col overflow-hidden text-[12px] shadow-(--shadow-float) outline-none"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        aria-describedby="confirm-message"
      >
        <div
          class="flex h-10 shrink-0 items-center justify-between border-b border-border bg-sunken pr-2 pl-4"
        >
          <h2 id="confirm-title" class="card-title flex min-w-0 items-center gap-2 text-[14px]">
            <TriangleAlert
              v-if="request.danger"
              :size="13"
              :stroke-width="1.5"
              class="shrink-0 text-danger"
              aria-hidden="true"
            />
            <span class="truncate">{{ request.title }}</span>
          </h2>
          <button
            type="button"
            class="flex size-6 cursor-pointer items-center justify-center rounded-(--radius-control) text-ink-muted hover:bg-surface hover:text-ink"
            aria-label="Cancel"
            v-tooltip="'Cancel'"
            @click="cancel"
          >
            <X :size="14" :stroke-width="1.5" />
          </button>
        </div>

        <div class="flex flex-col gap-3 p-5">
          <p id="confirm-message" class="text-ink-secondary">{{ request.message }}</p>
          <label v-if="request.field" class="flex flex-col gap-1">
            <span class="micro-label">{{ request.field.label }}</span>
            <input
              v-model="text"
              v-autofocus.select
              type="text"
              spellcheck="false"
              class="field h-8"
              @keydown.enter.prevent="submit"
            />
          </label>
          <ul v-if="listed.length" class="well flex flex-col gap-1 px-3 py-2">
            <li v-for="name in listed" :key="name" class="truncate text-ink">{{ name }}</li>
            <li v-if="unlisted" class="text-ink-muted">and {{ unlisted }} more</li>
          </ul>
        </div>

        <div class="flex h-12 shrink-0 items-center gap-2 border-t border-border bg-sunken px-5">
          <Button
            v-if="request.field"
            :variant="request.danger ? 'danger' : 'secondary'"
            :disabled="blank"
            @click="submit"
          >
            {{ request.confirmLabel }}
          </Button>
          <Button
            v-else
            v-autofocus
            :variant="request.danger ? 'danger' : 'secondary'"
            @click="accept"
          >
            {{ request.confirmLabel }}
          </Button>
          <Button variant="ghost" @click="cancel">Cancel</Button>
        </div>
      </div>
    </div>
  </Teleport>
</template>
