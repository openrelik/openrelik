<script setup lang="ts">
import { Settings } from '@/components/icons'

import { openSettings } from '@/composables/useSettings'
</script>

<template>
  <!--
    The status bar's last segment, mirroring the brand tag on the left: flush
    against the right edge, so the parent's padding is cancelled here too.
  -->
  <button
    type="button"
    class="flex h-full shrink-0 cursor-pointer items-center gap-1.5 border-l border-border px-3 text-ink-muted transition-colors duration-120 ease-(--ease-standard) hover:bg-surface hover:text-ink"
    v-tooltip="'Settings'"
    aria-label="Settings"
    @click="openSettings"
  >
    <Settings :size="12" :stroke-width="1.5" aria-hidden="true" />
    settings
  </button>
</template>
