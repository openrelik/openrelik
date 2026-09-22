<script setup lang="ts">
import Button from '@/components/base/Button.vue'
import { useDelayedFlag } from '@/composables/useDelayedFlag'
import type { QueryState } from '@/composables/useQueryCache'

/**
 * LoadState — what a listing shows when it has nothing, or something went wrong
 *
 * The one place loading, failure and emptiness are drawn, so every listing
 * behaves the same on fast and slow connections:
 *
 * - Never loaded and loading: "Loading {noun}…", after a short delay. The
 *   line keeps its height while hidden, so the text appearing moves nothing.
 * - Refreshing data already on screen: nothing here; the status bar shows it.
 * - Failed with nothing on screen: the error, with Retry.
 * - Failed to refresh: a quiet warning under the data that is still shown.
 * - Loaded and empty: the `empty` slot.
 */
const props = defineProps<{
  state: QueryState
  /** Plural noun for the loading line: "folders", "files". */
  noun: string
  /** Whether rows are on screen (cached data, placeholders, an inline editor). */
  hasContent: boolean
}>()

const emit = defineEmits<{ retry: [] }>()

const waiting = () =>
  !props.hasContent && (props.state.status === 'idle' || props.state.status === 'loading')
const showLoading = useDelayedFlag(waiting)
</script>

<template>
  <p v-if="waiting()" class="px-3 py-6 text-ink-muted" aria-busy="true">
    <span :class="{ invisible: !showLoading }">Loading {{ noun }}…</span>
  </p>

  <p
    v-else-if="state.error && !state.isFetching && !hasContent"
    role="alert"
    class="flex items-center gap-3 px-3 py-6 text-danger"
  >
    <span class="min-w-0 truncate">Could not load {{ noun }}: {{ state.error }}</span>
    <Button size="row" @click="emit('retry')">Retry</Button>
  </p>

  <p
    v-else-if="state.error && !state.isFetching"
    role="status"
    class="flex items-center gap-3 px-3 py-2 text-warning"
  >
    <span class="min-w-0 truncate">Could not refresh — showing saved data ({{ state.error }})</span>
    <Button variant="ghost" size="row" @click="emit('retry')">Retry</Button>
  </p>

  <p v-else-if="!hasContent" class="px-3 py-6 text-ink-muted">
    <slot name="empty" />
  </p>
</template>
