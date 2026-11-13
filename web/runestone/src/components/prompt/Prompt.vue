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
import { watch } from 'vue'

import PromptResults from '@/components/prompt/PromptResults.vue'
import { usePrompt } from '@/composables/usePrompt'

/**
 * The terminal prompt as a floating overlay, for pages without an inline path bar.
 * It also owns the app-wide shortcut: ⌘K / Ctrl+K anywhere, or `g` when nothing
 * else has the keyboard — which focuses the path bar's prompt where there is one,
 * and opens this where there is not.
 */
const {
  promptOpen,
  close,
  line,
  index,
  query,
  isRm,
  cwdPath,
  scopePath,
  results,
  serverSearch,
  go,
  handleKey,
} = usePrompt(() => close())

watch(promptOpen, () => {
  line.value = ''
  index.value = 0
})

function onInputKey(event: KeyboardEvent) {
  event.stopPropagation()
  if (handleKey(event)) return
  if (event.key === 'Escape') {
    close()
    event.preventDefault()
  }
}
</script>

<template>
  <Teleport to="body">
    <div v-if="promptOpen" class="fixed inset-0 z-50">
      <div class="absolute inset-0 bg-ink/20" aria-hidden="true" @pointerdown="close" />
      <div
        class="sheet absolute top-[12vh] left-1/2 flex max-h-[70vh] w-[min(46rem,calc(100vw-2rem))] -translate-x-1/2 flex-col overflow-hidden text-[12px] shadow-(--shadow-float)"
        role="dialog"
        aria-modal="true"
        aria-label="Prompt"
        v-trap-focus
      >
        <label class="flex h-10 shrink-0 items-center gap-1 border-b border-border bg-sunken px-3">
          <span class="max-w-[45%] shrink-0 truncate text-brand">{{ cwdPath }}</span>
          <span class="shrink-0 text-ink-muted">$</span>
          <div class="relative ml-1 flex min-w-0 flex-1 items-center">
            <input
              v-autofocus
              v-model="line"
              type="text"
              role="combobox"
              spellcheck="false"
              autocomplete="off"
              aria-label="Find a folder or file"
              aria-controls="prompt-results"
              :aria-expanded="results.length > 0"
              :aria-activedescendant="results.length ? `prompt-${index}` : undefined"
              class="peer w-full min-w-0 bg-transparent font-mono text-ink caret-brand-icon outline-none [caret-shape:block] placeholder:text-transparent"
              placeholder="cd, or type to find…"
              @keydown="onInputKey"
            />
            <span
              aria-hidden="true"
              class="pointer-events-none absolute top-1/2 right-0 left-[1.5ch] hidden -translate-y-1/2 truncate font-mono text-ink-muted/60 select-none peer-placeholder-shown:block"
              >cd, or type to find…</span
            >
          </div>
        </label>
        <PromptResults
          class="min-h-0 flex-1"
          :results="results"
          :index="index"
          :query="query"
          :mode="isRm ? 'rm' : 'search'"
          :cwd-path="cwdPath"
          :scope-path="scopePath"
          :server-search="serverSearch"
          @go="go"
          @hover="index = $event"
        />
      </div>
    </div>
  </Teleport>
</template>
