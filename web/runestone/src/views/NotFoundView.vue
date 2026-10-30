<script setup lang="ts">
import { AlertCircle, HardDrive } from '@/components/icons'
import { RouterLink, useRoute } from 'vue-router'

import Button from '@/components/base/Button.vue'
import StatusBar from '@/components/layout/StatusBar.vue'

const route = useRoute()
</script>

<template>
  <section class="flex h-full min-h-[28rem] flex-col overflow-hidden bg-surface text-[12px]">
    <!-- toolbar -->
    <div class="flex h-10 shrink-0 items-center gap-2 border-b border-border px-3">
      <RouterLink
        to="/"
        class="mr-1.5 flex items-center gap-1.5 text-ink-muted hover:text-ink"
        v-tooltip="'All folders'"
      >
        <HardDrive :size="13" :stroke-width="1.5" />
        <span>/</span>
      </RouterLink>
      <span class="text-danger">404: Not Found</span>
    </div>

    <!-- content well -->
    <div class="flex min-h-0 flex-1 flex-col items-center justify-center p-6 text-center">
      <div class="card flex max-w-md flex-col items-center gap-3">
        <AlertCircle :size="32" :stroke-width="1.5" class="text-danger" />
        <h1 class="card-title text-base">
          {{ route.name === 'case' ? 'Case Not Found' : 'Page Not Found' }}
        </h1>
        <!-- The server answers the same for no such case and a case you cannot see. -->
        <p v-if="route.name === 'case'" class="text-ink-muted">
          No folder for case
          <code class="well py-0.5 text-brand">{{ route.params.ref }}</code> that you have access
          to.
        </p>
        <p v-else class="text-ink-muted">
          The requested path <code class="well py-0.5 text-brand">{{ route.fullPath }}</code> does
          not exist.
        </p>
        <div class="mt-2 flex gap-2">
          <RouterLink to="/">
            <Button variant="primary">
              <template #icon><HardDrive :size="13" :stroke-width="1.5" /></template>
              Return to root
            </Button>
          </RouterLink>
        </div>
      </div>
    </div>

    <!-- status bar -->
    <StatusBar>
      <span class="text-danger">404 not found</span>
    </StatusBar>
  </section>
</template>
