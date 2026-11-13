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
import { RouterLink } from 'vue-router'

import SettingsTrigger from '@/components/layout/SettingsTrigger.vue'
import { LogOut, Upload, User as UserIcon } from '@/components/icons'
import { refreshAll } from '@/composables/useAutoRefresh'
import { useConnection } from '@/composables/useConnection'
import { useNetworkActivity } from '@/composables/useNetworkActivity'
import { useUploadPanel } from '@/composables/useUploadPanel'
import { useUploadQueue } from '@/composables/useUploadQueue'
import { helpOpen } from '@/composables/useHelp'
import { openAccount } from '@/composables/useApiKeys'
import { useAuthStore } from '@/stores/auth'

const authStore = useAuthStore()
const { state: network } = useNetworkActivity()
const uploads = useUploadQueue()
const uploadPanel = useUploadPanel()

const NETWORK_TOOLTIP = {
  idle: 'Nothing loading',
  fetching: 'Talking to the server',
  prefetch: 'Loading folders ahead of time, so opening them is instant',
} as const
const { status: connection } = useConnection()
</script>

<template>
  <footer
    class="flex h-7 shrink-0 items-center gap-3 border-t border-border bg-sunken px-3 text-[11px] text-ink-muted"
    role="status"
  >
    <slot />
    <!-- Right-aligned group: notices grow leftwards and move nothing. -->
    <span class="ml-auto flex items-center gap-3">
      <span v-if="connection === 'offline'" class="text-warning" role="status">
        offline — showing saved data
      </span>
      <span
        v-else-if="connection === 'unreachable'"
        class="flex items-center gap-1.5 text-warning"
        role="status"
      >
        server unreachable — showing saved data
        <button
          type="button"
          class="cursor-pointer text-ink-muted underline hover:text-ink"
          @click="refreshAll({ force: true })"
        >
          retry
        </button>
      </span>
      <!-- Always shown. Fixed width, so changing state moves nothing. Not a live
           region: announcing every idle/fetching change would be noise. -->
      <!-- The dot alone: a steady state needs no words, and hovering says
           which one it is. -->
      <span
        class="flex items-center"
        :aria-label="`Network: ${network}`"
        v-tooltip="NETWORK_TOOLTIP[network]"
      >
        <span
          class="size-1.5 shrink-0 rounded-full"
          :class="network === 'idle' ? 'bg-success' : 'animate-pulse bg-warning'"
          aria-hidden="true"
        />
      </span>

      <!-- Always here, so the queue is somewhere to go back to, not a notice
           that disappears. Uploads follow the operator between folders. -->
      <button
        type="button"
        class="flex cursor-pointer items-center gap-1.5 rounded-(--radius-check) px-1 hover:bg-surface hover:text-ink"
        :class="uploads.activeCount.value ? 'text-brand' : 'text-ink-muted'"
        :aria-label="
          uploads.activeCount.value
            ? `Upload queue, ${uploads.activeCount.value} active`
            : 'Upload queue'
        "
        aria-live="off"
        data-click-outside-ignore
        v-tooltip="uploadPanel.isOpen.value ? 'Minimize the upload queue' : 'Show the upload queue'"
        @click="uploadPanel.toggle()"
      >
        <Upload :size="11" :stroke-width="1.5" aria-hidden="true" />
        <span v-if="uploads.activeCount.value" class="tabular"
          >{{ uploads.activeCount.value }} active</span
        >
      </button>
    </span>

    <RouterLink
      to="/metrics"
      class="cursor-pointer rounded-(--radius-check) px-1 text-ink-muted hover:bg-surface hover:text-ink"
      active-class="text-ink"
      v-tooltip="'Worker task counts over time'"
    >
      metrics
    </RouterLink>
    <SettingsTrigger />

    <button
      type="button"
      class="cursor-pointer rounded-(--radius-check) px-1 text-ink-muted hover:bg-surface hover:text-ink"
      :class="{ '-mr-3': !authStore.isAuthenticated }"
      v-tooltip="'Keyboard shortcuts'"
      @click="helpOpen = true"
    >
      help
    </button>

    <!-- Authenticated operator indicator and sign out trigger at far right corner -->
    <div
      v-if="authStore.isAuthenticated"
      class="-mr-3 flex h-full shrink-0 items-center gap-2 border-l border-border pr-3 pl-2.5"
    >
      <button
        type="button"
        class="flex cursor-pointer items-center gap-1.5 rounded-(--radius-check) px-1 text-ink-secondary hover:bg-surface"
        aria-label="Account and API keys"
        v-tooltip="'Account and API keys'"
        @click="openAccount"
      >
        <UserIcon :size="12" :stroke-width="1.5" class="text-brand" aria-hidden="true" />
        <span class="text-ink">{{ authStore.user?.username }}</span>
      </button>
      <button
        type="button"
        class="flex size-4.5 cursor-pointer items-center justify-center rounded-(--radius-check) text-ink-muted hover:bg-surface hover:text-danger transition-colors"
        v-tooltip="'Sign out'"
        aria-label="Sign out"
        @click="authStore.logout()"
      >
        <LogOut :size="11" :stroke-width="1.5" aria-hidden="true" />
      </button>
    </div>
  </footer>
</template>
