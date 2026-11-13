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
