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
    aria-label="Settings"
    @click="openSettings"
  >
    <Settings :size="12" :stroke-width="1.5" aria-hidden="true" />
    settings
  </button>
</template>
