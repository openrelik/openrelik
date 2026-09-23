<script setup lang="ts">
import { computed } from 'vue'

import KeyValueRow from '@/components/base/KeyValueRow.vue'
import { dataTypeOf, exactSize, hashesOf, magicOf } from '@/data/files'
import type { Item } from '@/data/folders'
import { formatSize, stamp } from '@/utils/format'

/**
 * Detailed metadata sheet for a single file: hashes, MIME, size,
 * magic signatures, and timestamps.
 */
const props = defineProps<{
  file: Item
}>()

const hashes = computed(() => hashesOf(props.file))
const bytes = computed(() => exactSize(props.file))

/** A hash, or why there is none: not loaded yet, or not computed (yet) on the server. */
const hash = (value: string | undefined) =>
  value || (props.file.hashes ? 'not computed yet' : 'loading…')

const details = computed(() => [
  { label: 'md5', value: hash(hashes.value.md5), copyable: !!hashes.value.md5 },
  { label: 'sha-1', value: hash(hashes.value.sha1), copyable: !!hashes.value.sha1 },
  { label: 'sha-256', value: hash(hashes.value.sha256), copyable: !!hashes.value.sha256 },
  { label: 'data type', value: dataTypeOf(props.file) },
  { label: 'mime type', value: props.file.mime ?? '' },
  { label: 'magic', value: magicOf(props.file) },
  { label: 'owner', value: props.file.owner },
  { label: 'created (utc)', value: stamp(props.file.created ?? props.file.modified) },
  { label: 'modified (utc)', value: stamp(props.file.modified) },
  { label: 'id', value: String(props.file.id), copyable: true },
])
</script>

<template>
  <aside
    class="w-80 shrink-0 overflow-y-auto border-l border-border max-xl:hidden"
    aria-label="File details"
  >
    <p class="micro-label flex h-7 items-center border-b border-border px-3">details</p>
    <dl class="divide-y divide-border px-3">
      <KeyValueRow label="size" stacked>
        <span class="tabular">{{ formatSize(bytes) }}</span>
        <span class="text-ink-muted"> ({{ bytes.toLocaleString('en-US') }} B)</span>
      </KeyValueRow>
      <KeyValueRow
        v-for="row in details"
        :key="row.label"
        :label="row.label"
        :value="row.value"
        :copyable="row.copyable"
        stacked
      />
    </dl>
  </aside>
</template>
