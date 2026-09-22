<script setup lang="ts">
import { computed } from 'vue'

import Button from '@/components/base/Button.vue'
import UserAvatar from '@/components/base/UserAvatar.vue'
import { File, X } from '@/components/icons'
import { sentBytes, uploadPercent, type Upload } from '@/composables/useUploadQueue'
import { useAuthStore } from '@/stores/auth'
import { formatSize } from '@/utils/format'

/**
 * UploadRow — a file on its way into this folder
 *
 * Sits above the real rows, like an unconfirmed new folder, and hands over to
 * the real row when the server confirms the file. The size cell carries the
 * same bar as a finished file row, so nothing moves at the handover.
 */
const props = defineProps<{
  upload: Upload
  /** Pending work has lasted long enough to be worth showing. */
  showPending?: boolean
}>()

const emit = defineEmits<{ cancel: []; retry: []; dismiss: [] }>()

const auth = useAuthStore()
/** The file will belong to whoever is uploading it: the same square, before and after. */
const owner = computed(() => auth.user)

const percent = computed(() => uploadPercent(props.upload))
const failed = computed(() => props.upload.status === 'failed')
</script>

<template>
  <tr
    class="h-7 border-b border-border/60 select-none"
    :aria-busy="!failed || undefined"
    :class="{ 'opacity-60': failed }"
  >
    <td class="pl-3">
      <input
        type="checkbox"
        disabled
        tabindex="-1"
        class="accent-brand align-middle opacity-30"
        :aria-label="`${upload.name} is uploading`"
      />
    </td>

    <td class="px-2">
      <div class="flex min-w-0 items-center gap-2">
        <File :size="13" :stroke-width="1.5" class="shrink-0 text-ink-muted" aria-hidden="true" />
        <span class="truncate text-ink-secondary">{{ upload.name }}</span>
      </div>
    </td>

    <!-- Same geometry as a file row's size cell: no shift when the real row lands. -->
    <td class="px-2">
      <div class="flex items-center justify-end gap-2">
        <span class="tabular text-ink-secondary">{{ formatSize(sentBytes(upload)) }}</span>
        <span class="h-1 w-12 shrink-0 bg-border" aria-hidden="true">
          <span class="block h-full bg-brand" :style="{ width: `${Math.max(2, percent)}%` }" />
        </span>
      </div>
    </td>

    <td class="truncate px-2 text-ink-muted">
      <span v-if="failed" class="text-danger">failed</span>
      <span v-else-if="showPending" class="inline-flex items-center gap-1.5 text-brand">
        <span class="size-1.5 animate-pulse rounded-full bg-brand" aria-hidden="true" />
        <template v-if="upload.waiting">waiting for the network…</template>
        <template v-else-if="upload.status === 'queued'">queued…</template>
        <template v-else>
          uploading… <span class="tabular">{{ percent }}</span
          >%
        </template>
      </span>
      <template v-else>{{ upload.file.type || 'file:generic' }}</template>
    </td>

    <td class="px-2">
      <UserAvatar
        v-if="owner"
        :name="owner.display_name || owner.username"
        :username="owner.username"
        :src="owner.profile_picture_url ?? undefined"
      />
    </td>

    <td class="truncate px-2">
      <div class="flex items-center justify-end gap-1">
        <template v-if="failed">
          <Button
            variant="ghost"
            size="row"
            :tooltip="`Upload ${upload.name} again`"
            @click="emit('retry')"
          >
            Retry
          </Button>
          <Button
            variant="ghost"
            size="row"
            :tooltip="`Dismiss ${upload.name}`"
            @click="emit('dismiss')"
          >
            Dismiss
          </Button>
        </template>
        <Button
          v-else
          variant="ghost"
          size="row"
          :aria-label="`Cancel upload of ${upload.name}`"
          :tooltip="`Cancel upload of ${upload.name}`"
          @click="emit('cancel')"
        >
          <template #icon><X :size="11" :stroke-width="1.5" /></template>
          Cancel
        </Button>
      </div>
    </td>
  </tr>
</template>
