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
import { computed } from 'vue'

import CopyValue from '@/components/base/CopyValue.vue'
import UserAvatar from '@/components/base/UserAvatar.vue'
import { dataTypeOf, exactSize, hashesOf, magicOf } from '@/utils/item'
import type { Item } from '@/types/item'
import { formatSize, stamp } from '@/utils/format'

/**
 * Details of one file, for the file page's side panel.
 *
 * It opens with what the file is (its magic, then its size) unlabelled, since
 * the content says what it is. Below that come three groups: its type, its
 * hashes, and where it came from. Space sets the groups apart, not rules or
 * headings. Labels sit in a quiet column on the left so the eye runs down the
 * values; values are mono, and a hash wraps but is never cut. Empty fields are
 * left out. Copyable values (hashes, the ID) show a copy mark on hover.
 */
const props = defineProps<{
  file: Item
}>()

interface Row {
  label: string
  value: string
}

/** A label column wide enough for "modified" and "sha-256", then the value. */
const ROW = 'grid grid-cols-[5rem_minmax(0,1fr)] items-baseline gap-x-3'

const magic = computed(() => {
  const text = magicOf(props.file)
  return text === '–' ? '' : text
})
const bytes = computed(() => exactSize(props.file))

const typeRows = computed<Row[]>(() => {
  const rows: Row[] = [{ label: 'type', value: dataTypeOf(props.file) }]
  if (props.file.mime) rows.push({ label: 'mime', value: props.file.mime })
  return rows
})

/** Hashes the server has computed, or none, with `hashNote` saying why. */
const hashRows = computed<Row[]>(() => {
  const hashes = hashesOf(props.file)
  const rows: Row[] = [
    { label: 'md5', value: hashes.md5 },
    { label: 'sha-1', value: hashes.sha1 },
    { label: 'sha-256', value: hashes.sha256 },
  ]
  return rows.filter((row) => row.value)
})
const hashNote = computed(() => (props.file.hashes ? 'hashes not computed yet' : 'loading hashes…'))

const created = computed(() => props.file.created ?? props.file.modified)
</script>

<template>
  <div aria-label="File details" class="flex flex-col gap-4 px-3 py-3">
    <!-- what the file is -->
    <div>
      <p :class="magic ? 'text-ink' : 'text-ink-muted'">
        {{ magic || 'Unknown content' }}
      </p>
      <p class="tabular mt-0.5 font-mono">
        <span class="text-ink-secondary">{{ formatSize(bytes) }}</span>
        <span class="ml-2 text-ink-muted">{{ bytes.toLocaleString('en-US') }} B</span>
      </p>
    </div>

    <dl class="flex flex-col gap-1">
      <div v-for="row in typeRows" :key="row.label" :class="ROW">
        <dt class="micro-label">{{ row.label }}</dt>
        <dd class="min-w-0 font-mono break-all text-ink">{{ row.value }}</dd>
      </div>
    </dl>

    <dl v-if="hashRows.length" class="flex flex-col gap-1">
      <div v-for="row in hashRows" :key="row.label" :class="ROW">
        <dt class="micro-label">{{ row.label }}</dt>
        <dd class="min-w-0">
          <CopyValue :value="row.value" />
        </dd>
      </div>
    </dl>
    <p v-else class="text-ink-muted">{{ hashNote }}</p>

    <!-- where it came from -->
    <dl class="flex flex-col gap-1">
      <div :class="ROW">
        <dt class="micro-label">created</dt>
        <dd class="tabular min-w-0 font-mono text-ink">
          {{ stamp(created) }} <span class="text-ink-muted">utc</span>
        </dd>
      </div>
      <div :class="ROW">
        <dt class="micro-label">modified</dt>
        <dd class="tabular min-w-0 font-mono text-ink">
          {{ stamp(file.modified) }} <span class="text-ink-muted">utc</span>
        </dd>
      </div>
      <div v-if="file.owner" :class="ROW">
        <dt class="micro-label">owner</dt>
        <dd class="flex min-w-0 items-center gap-2 text-ink">
          <UserAvatar :name="file.owner" :username="file.ownerUsername" :src="file.ownerAvatar" />
          <span class="truncate">{{ file.owner }}</span>
        </dd>
      </div>
      <div :class="ROW">
        <dt class="micro-label">id</dt>
        <dd class="min-w-0">
          <CopyValue :value="String(file.id)" />
        </dd>
      </div>
    </dl>
  </div>
</template>
