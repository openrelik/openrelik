<script setup lang="ts">
import { RouterView } from 'vue-router'

import { useKeyboardShortcuts } from '@/composables/useKeyboardShortcuts'
import Prompt from '@/components/prompt/Prompt.vue'
import AccountDialog from '@/components/dialogs/AccountDialog.vue'
import ConfirmDialog from '@/components/dialogs/ConfirmDialog.vue'
import UploadQueuePanel from '@/components/layout/UploadQueuePanel.vue'
import HelpDialog from '@/components/dialogs/HelpDialog.vue'
import RunDialog from '@/components/dialogs/RunDialog.vue'
import SettingsDialog from '@/components/dialogs/SettingsDialog.vue'
import ShareDialog from '@/components/dialogs/ShareDialog.vue'
import TaskReportDialog from '@/components/dialogs/TaskReportDialog.vue'
import WorkflowDialog from '@/components/dialogs/WorkflowDialog.vue'
import Tooltip from '@/components/base/Tooltip.vue'
import LinkMenu from '@/components/markdown/LinkMenu.vue'

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
  <AccountDialog />
  <HelpDialog />
  <RunDialog />
  <WorkflowDialog />
  <ShareDialog />
  <TaskReportDialog />
  <ConfirmDialog />
  <UploadQueuePanel />
  <Tooltip />
  <LinkMenu />
</template>
