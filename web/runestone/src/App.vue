<script setup lang="ts">
import { RouterView } from 'vue-router'

import { useKeyboardShortcuts } from '@/composables/useKeyboardShortcuts'
import Prompt from '@/components/prompt/Prompt.vue'
import ConfirmDialog from '@/components/dialogs/ConfirmDialog.vue'
import HelpDialog from '@/components/dialogs/HelpDialog.vue'
import RunDialog from '@/components/dialogs/RunDialog.vue'
import SettingsDialog from '@/components/dialogs/SettingsDialog.vue'
import ShareDialog from '@/components/dialogs/ShareDialog.vue'
import WorkflowDialog from '@/components/dialogs/WorkflowDialog.vue'
import Tooltip from '@/components/base/Tooltip.vue'

useKeyboardShortcuts()
</script>

<template>
  <!-- Edge to edge: every page is one full-window panel, so there is nothing
       for a margin to separate it from. -->
  <main class="h-dvh overflow-y-auto bg-canvas">
    <RouterView />
  </main>
  <Prompt />
  <SettingsDialog />
  <HelpDialog />
  <RunDialog />
  <WorkflowDialog />
  <ShareDialog />
  <ConfirmDialog />
  <Tooltip />
</template>
