<script setup lang="ts">
import BrandLink from '@/components/layout/BrandLink.vue'
import KeyHint from '@/components/base/KeyHint.vue'
import SettingsTrigger from '@/components/layout/SettingsTrigger.vue'
import { LogOut, User as UserIcon } from '@/components/icons'
import { refreshAll } from '@/composables/useAutoRefresh'
import { useConnection } from '@/composables/useConnection'
import { useNetworkActivity } from '@/composables/useNetworkActivity'
import { useAuthStore } from '@/stores/auth'

const authStore = useAuthStore()
const { label: activity } = useNetworkActivity()
const { status: connection } = useConnection()
</script>

<template>
  <footer
    class="flex h-7 shrink-0 items-center gap-3 border-t border-border bg-sunken px-3 text-[11px] text-ink-muted"
    role="status"
  >
    <BrandLink />
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
          v-tooltip="'Try the server again'"
          @click="refreshAll({ force: true })"
        >
          retry
        </button>
      </span>
      <span v-if="activity" class="flex items-center gap-1.5 text-ink-muted" aria-live="polite">
        <span class="size-1.5 animate-pulse rounded-full bg-brand" aria-hidden="true" />
        {{ activity }}
      </span>
      <span class="flex items-center gap-3 max-md:hidden">
        <slot name="hints">
          <KeyHint keys="g" label="prompt" />
          <KeyHint keys="?" label="help" />
        </slot>
      </span>
    </span>

    <SettingsTrigger :class="{ '-mr-3': !authStore.isAuthenticated }" />

    <!-- Authenticated operator indicator and sign out trigger at far right corner -->
    <div
      v-if="authStore.isAuthenticated"
      class="-mr-3 flex h-full shrink-0 items-center gap-2 border-l border-border pr-3 pl-2.5"
    >
      <span
        class="flex items-center gap-1.5 text-ink-secondary"
        v-tooltip="authStore.user?.email || 'Authenticated operator'"
      >
        <UserIcon :size="12" :stroke-width="1.5" class="text-brand" />
        <span class="text-ink">{{ authStore.user?.username }}</span>
      </span>
      <button
        type="button"
        class="flex size-4.5 cursor-pointer items-center justify-center rounded-(--radius-check) text-ink-muted hover:bg-surface hover:text-danger transition-colors"
        v-tooltip="'Sign out'"
        aria-label="Sign out"
        @click="authStore.logout()"
      >
        <LogOut :size="11" :stroke-width="1.5" />
      </button>
    </div>
  </footer>
</template>
