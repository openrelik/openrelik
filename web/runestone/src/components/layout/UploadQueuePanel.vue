<script setup lang="ts">
import { computed } from 'vue'

import Button from '@/components/base/Button.vue'
import { ChevronDown, X } from '@/components/icons'
import { useUploadPanel } from '@/composables/useUploadPanel'
import { sentBytes, uploadPercent, useUploadQueue } from '@/composables/useUploadQueue'
import { findItem } from '@/data/folders'
import { count, formatSize } from '@/utils/format'

/**
 * UploadQueuePanel — every upload, wherever it is going
 *
 * Opened from the status bar, which only has room for a count. Floats above
 * the bar rather than covering the view: an upload is background work, and
 * the operator may want to keep working while watching it.
 */
const uploads = useUploadQueue()
const { isOpen, minimize } = useUploadPanel()

const failed = computed(() => uploads.all.value.filter((upload) => upload.status === 'failed'))
const running = computed(() => uploads.all.value.filter((upload) => upload.status !== 'failed'))

/** Where a file is going, so a queue spanning folders still makes sense. */
const folderName = (folderId: number) => findItem(folderId)?.name ?? 'folder'

const stateOf = (upload: (typeof uploads.all.value)[number]) => {
  if (upload.status === 'failed') return 'failed'
  if (upload.waiting) return 'waiting for the network…'
  if (upload.status === 'queued') return 'queued'
  return `${uploadPercent(upload)}%`
}
</script>

<template>
  <Teleport to="body">
    <!-- No backdrop: the view stays usable while files go up. -->
    <div
      v-if="isOpen"
      v-click-outside="minimize"
      class="sheet fixed right-3 bottom-9 z-40 flex h-[min(24rem,70vh)] w-[min(34rem,calc(100vw-1.5rem))] flex-col overflow-hidden text-[12px] shadow-(--shadow-float)"
      role="dialog"
      aria-modal="false"
      aria-labelledby="uploads-title"
    >
      <div
        class="flex h-9 shrink-0 items-center justify-between border-b border-border bg-sunken pr-2 pl-4"
      >
        <h2 id="uploads-title" class="card-title text-[13px]">
          <template v-if="running.length">{{ count(running.length, 'file') }} uploading</template>
          <template v-else>Upload queue</template>
          <span v-if="failed.length" class="font-normal text-danger"
            >· {{ failed.length }} failed</span
          >
        </h2>
        <!-- Minimized, never closed: the uploads carry on either way, and the
             status bar keeps the way back. -->
        <button
          type="button"
          class="flex size-6 cursor-pointer items-center justify-center rounded-(--radius-control) text-ink-muted hover:bg-surface hover:text-ink"
          aria-label="Minimize upload queue"
          v-tooltip="'Minimize — uploads carry on'"
          @click="minimize"
        >
          <ChevronDown :size="14" :stroke-width="1.5" />
        </button>
      </div>

      <ul class="min-h-0 flex-1 overflow-y-auto py-1">
        <li
          v-for="upload in uploads.all.value"
          :key="upload.key"
          class="flex h-8 items-center gap-3 px-4"
          :aria-busy="upload.status !== 'failed' || undefined"
        >
          <span
            class="min-w-0 flex-1 truncate"
            :class="{ 'text-danger': upload.status === 'failed' }"
          >
            {{ upload.name }}
            <span class="text-ink-muted">→ {{ folderName(upload.folderId) }}</span>
          </span>

          <span class="tabular w-20 shrink-0 text-right text-ink-secondary">
            {{ formatSize(sentBytes(upload)) }}
          </span>

          <span class="h-1 w-24 shrink-0 bg-border" aria-hidden="true">
            <span
              class="block h-full"
              :class="upload.status === 'failed' ? 'bg-danger' : 'bg-brand'"
              :style="{ width: `${Math.max(2, uploadPercent(upload))}%` }"
            />
          </span>

          <span class="tabular w-36 shrink-0 truncate text-right text-ink-muted">
            {{ stateOf(upload) }}
          </span>

          <Button
            v-if="upload.status === 'failed'"
            variant="ghost"
            size="row"
            :tooltip="`Upload ${upload.name} again`"
            @click="uploads.retry(upload.key)"
          >
            Retry
          </Button>
          <Button
            variant="ghost"
            size="row"
            :aria-label="`Cancel upload of ${upload.name}`"
            :tooltip="`Cancel upload of ${upload.name}`"
            @click="uploads.cancel(upload.key)"
          >
            <template #icon><X :size="11" :stroke-width="1.5" /></template>
          </Button>
        </li>
        <li v-if="!uploads.all.value.length" class="px-4 py-3 text-ink-muted">
          Nothing is uploading.
        </li>
      </ul>

      <div class="flex h-10 shrink-0 items-center gap-2 border-t border-border bg-sunken px-4">
        <!-- Nothing running, nothing to cancel: the button goes rather than
             sitting there greyed out. -->
        <Button
          v-if="running.length"
          variant="danger"
          size="row"
          tooltip="Cancel every upload"
          @click="uploads.cancelAll()"
        >
          Cancel all
        </Button>
        <span class="ml-auto text-ink-muted">Uploads carry on while you work.</span>
      </div>
    </div>
  </Teleport>
</template>
