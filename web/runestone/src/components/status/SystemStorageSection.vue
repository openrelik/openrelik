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
import LoadState from '@/components/base/LoadState.vue'
import type { SystemStorageStatus } from '@/api/types'
import type { QueryState } from '@/composables/useQueryCache'
import { count, formatSize } from '@/utils/format'

defineProps<{
  storage: SystemStorageStatus | null
  state: QueryState
}>()

const emit = defineEmits<{ retry: [] }>()

function usageTone(percent: number | null): string {
  if (percent === null) return 'text-ink-muted'
  if (percent >= 90) return 'text-danger'
  if (percent >= 80) return 'text-warning'
  return 'text-ink'
}

function barTone(percent: number | null): string {
  if (percent === null) return 'bg-border-strong'
  if (percent >= 90) return 'bg-danger'
  if (percent >= 80) return 'bg-warning'
  return 'bg-brand'
}
</script>

<template>
  <section class="sheet overflow-hidden" aria-label="Storage">
    <header class="flex items-center justify-between border-b border-border px-3.5 py-2.5">
      <h2 class="card-title">Storage</h2>
      <span v-if="storage" class="tabular text-[0.75rem] text-ink-muted">
        {{ count(storage.storage_providers.length, 'volume') }}
      </span>
    </header>

    <div v-if="storage" class="divide-y divide-border">
      <!-- Datastore aggregate counts -->
      <div class="grid grid-cols-2 divide-x divide-border sm:grid-cols-5">
        <div class="flex flex-col gap-0.5 px-3.5 py-2.5">
          <span class="micro-label">Files</span>
          <div class="tabular flex items-baseline gap-2">
            <span class="text-base font-semibold text-ink">
              {{ storage.files_count.toLocaleString() }}
            </span>
          </div>
        </div>

        <div class="flex flex-col gap-0.5 px-3.5 py-2.5">
          <span class="micro-label" v-tooltip="'Sum of active file sizes recorded in the database'">
            Total size
          </span>
          <div class="tabular flex items-baseline gap-2">
            <span class="text-base font-semibold text-ink">
              {{ formatSize(storage.files_total_bytes) }}
            </span>
          </div>
        </div>

        <div class="flex flex-col gap-0.5 px-3.5 py-2.5">
          <span class="micro-label" v-tooltip="'Soft-deleted files not yet purged from disk'">
            Trash
          </span>
          <div class="tabular flex items-baseline gap-2">
            <span class="text-base font-semibold text-ink">
              {{ storage.deleted_unpurged_files_count.toLocaleString() }}
            </span>
            <span class="text-[0.75rem] text-ink-muted">
              {{ formatSize(storage.deleted_unpurged_bytes) }}
            </span>
          </div>
        </div>

        <div class="flex flex-col gap-0.5 px-3.5 py-2.5">
          <span class="micro-label">Folders</span>
          <div class="tabular flex items-baseline gap-2">
            <span class="text-base font-semibold text-ink">
              {{ storage.folders_count.toLocaleString() }}
            </span>
            <span class="text-[0.75rem] text-ink-muted">
              {{ storage.root_folders_count.toLocaleString() }} root
            </span>
          </div>
        </div>

        <div class="flex flex-col gap-0.5 px-3.5 py-2.5">
          <span class="micro-label">Workflows</span>
          <div class="tabular flex items-baseline gap-2">
            <span class="text-base font-semibold text-ink">
              {{ storage.workflows_count.toLocaleString() }}
            </span>
            <span class="text-[0.75rem] text-ink-muted">total</span>
          </div>
        </div>
      </div>

      <!-- Storage provider disk volumes -->
      <div v-if="storage.storage_providers.length > 0" class="overflow-x-auto">
        <table class="w-full border-collapse text-left text-[0.8125rem]">
          <thead class="border-b border-border bg-sunken text-ink-muted">
            <tr>
              <th class="micro-label px-3.5 py-2 font-medium">Storage provider</th>
              <th class="micro-label px-3 py-2 font-medium">Mode</th>
              <th class="micro-label px-3 py-2 text-right font-medium">Files</th>
              <th class="micro-label px-3 py-2 text-right font-medium">Disk used</th>
              <th class="micro-label px-3.5 py-2 text-right font-medium">Free</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-border">
            <tr
              v-for="provider in storage.storage_providers"
              :key="provider.name"
              class="hover:bg-sunken/60"
            >
              <td class="px-3.5 py-2">
                <div class="flex items-baseline gap-2">
                  <span class="font-medium text-ink" v-tooltip="provider.name">{{
                    provider.display_name
                  }}</span>
                  <span
                    v-if="provider.is_default && storage.storage_providers.length > 1"
                    class="text-[0.75rem] text-ink-muted"
                  >
                    default
                  </span>
                </div>
              </td>
              <td class="px-3 py-2 font-mono text-[0.75rem] text-ink-secondary">
                {{ provider.mode }}
              </td>
              <td class="tabular px-3 py-2 text-right text-ink-secondary">
                {{ provider.file_count.toLocaleString() }}
                <span class="text-ink-muted">({{ formatSize(provider.file_bytes) }})</span>
              </td>
              <td class="tabular px-3 py-2 text-right">
                <div
                  v-if="
                    provider.available &&
                    provider.used_bytes !== null &&
                    provider.total_bytes !== null
                  "
                  class="flex items-center justify-end gap-2.5"
                >
                  <div
                    class="hidden h-1.5 w-20 overflow-hidden rounded-(--radius-check) bg-sunken sm:block"
                  >
                    <div
                      class="h-full"
                      :class="barTone(provider.used_percent)"
                      :style="{ width: `${Math.min(100, provider.used_percent ?? 0)}%` }"
                    />
                  </div>
                  <span class="font-medium" :class="usageTone(provider.used_percent)">
                    {{ formatSize(provider.used_bytes) }} / {{ formatSize(provider.total_bytes) }}
                  </span>
                  <span
                    v-if="provider.used_percent !== null"
                    class="text-[0.75rem]"
                    :class="usageTone(provider.used_percent)"
                  >
                    {{ provider.used_percent }}%
                  </span>
                </div>
                <span v-else class="text-danger">unavailable</span>
              </td>
              <td class="tabular px-3.5 py-2 text-right text-ink-secondary">
                {{
                  provider.available && provider.free_bytes !== null
                    ? formatSize(provider.free_bytes)
                    : '—'
                }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <LoadState :state="state" noun="storage status" :has-content="!!storage" @retry="emit('retry')">
      <template #empty>No storage status available.</template>
    </LoadState>
  </section>
</template>
