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
import { Monitor, Moon, Sun, X } from '@/components/icons'

import Switch from '@/components/base/Switch.vue'
import { settingsOpen, useSettings, type ThemeChoice } from '@/composables/useSettings'
import { PAGE_SIZES } from '@/stores/settings'

/**
 * Settings, as a dialog over whatever page you are on — so changing one never
 * costs you your place.
 *
 * Each row says what it does in words and, on the right, what it is as a
 * config key: `appearance.theme = "dark"`. The words are for deciding; the key
 * is for the person who will later grep a config file for it.
 */
const settings = useSettings()

const close = () => (settingsOpen.value = false)

const THEMES: { value: ThemeChoice; label: string; icon: typeof Sun }[] = [
  { value: 'system', label: 'system', icon: Monitor },
  { value: 'light', label: 'light', icon: Sun },
  { value: 'dark', label: 'dark', icon: Moon },
]
</script>

<template>
  <Teleport to="body">
    <div v-if="settingsOpen" class="fixed inset-0 z-50">
      <div class="absolute inset-0 bg-ink/20" aria-hidden="true" @pointerdown="close" />
      <div
        tabindex="-1"
        v-autofocus
        v-trap-focus
        class="sheet absolute top-[10vh] left-1/2 flex max-h-[80vh] w-[min(40rem,calc(100vw-2rem))] -translate-x-1/2 flex-col overflow-hidden text-[12px] shadow-(--shadow-float) outline-none"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
      >
        <div
          class="flex h-10 shrink-0 items-center gap-2 border-b border-border bg-sunken pr-2 pl-4"
        >
          <h2 id="settings-title" class="card-title">settings</h2>
          <span class="text-ink-muted">saved in this browser</span>
          <button
            type="button"
            class="ml-auto flex size-6 cursor-pointer items-center justify-center rounded-(--radius-control) text-ink-muted hover:bg-surface hover:text-ink"
            aria-label="Close settings"
            v-tooltip="'Close'"
            @click="close"
          >
            <X :size="14" :stroke-width="1.5" />
          </button>
        </div>

        <div class="min-h-0 flex-1 overflow-y-auto py-2">
          <!-- appearance -->
          <section aria-labelledby="settings-appearance">
            <p id="settings-appearance" class="micro-label px-4 pt-2 pb-1">appearance</p>

            <div class="flex items-center gap-3 px-4 py-2.5">
              <div class="min-w-0 flex-1">
                <p class="font-medium text-ink">Theme</p>
                <p class="text-ink-muted">System follows your OS, light or dark stays put</p>
              </div>
              <div
                class="flex shrink-0 items-center gap-0.5 rounded-(--radius-control) border border-border bg-sunken p-0.5"
                role="radiogroup"
                aria-label="Theme"
              >
                <button
                  v-for="theme in THEMES"
                  :key="theme.value"
                  type="button"
                  role="radio"
                  :aria-checked="settings.appearance.theme === theme.value"
                  class="flex h-6 cursor-pointer items-center gap-1.5 rounded-(--radius-check) px-2.5 transition-colors duration-120 ease-(--ease-standard)"
                  :class="
                    settings.appearance.theme === theme.value
                      ? 'bg-brand-tint text-brand'
                      : 'text-ink-muted hover:bg-canvas hover:text-ink-secondary'
                  "
                  @click="settings.appearance.theme = theme.value"
                >
                  <component :is="theme.icon" :size="12" :stroke-width="1.5" aria-hidden="true" />
                  {{ theme.label }}
                </button>
              </div>
              <code class="tabular w-44 shrink-0 text-right text-[11px] text-ink-muted"
                >appearance.theme =
                <span class="text-brand">"{{ settings.appearance.theme }}"</span></code
              >
            </div>
          </section>

          <hr class="my-2 border-border" />

          <!-- explorer -->
          <section aria-labelledby="settings-explorer">
            <p id="settings-explorer" class="micro-label px-4 pt-2 pb-1">explorer</p>

            <div class="flex items-center gap-3 px-4 py-2.5">
              <div class="min-w-0 flex-1">
                <p class="font-medium text-ink">Folders per page</p>
                <p class="text-ink-muted">Top-level list; subfolders always show in full</p>
              </div>
              <div
                class="flex shrink-0 items-center gap-0.5 rounded-(--radius-control) border border-border bg-sunken p-0.5"
                role="radiogroup"
                aria-label="Folders per page"
              >
                <button
                  v-for="size in PAGE_SIZES"
                  :key="size"
                  type="button"
                  role="radio"
                  :aria-checked="settings.explorer.pageSize === size"
                  class="tabular flex h-6 cursor-pointer items-center rounded-(--radius-check) px-2.5 transition-colors duration-120 ease-(--ease-standard)"
                  :class="
                    settings.explorer.pageSize === size
                      ? 'bg-brand-tint text-brand'
                      : 'text-ink-muted hover:bg-canvas hover:text-ink-secondary'
                  "
                  @click="settings.explorer.pageSize = size"
                >
                  {{ size }}
                </button>
              </div>
              <code class="tabular w-44 shrink-0 text-right text-[11px] text-ink-muted"
                >explorer.pageSize =
                <span class="text-brand">{{ settings.explorer.pageSize }}</span></code
              >
            </div>

            <div class="flex items-center gap-3 px-4 py-2.5">
              <Switch v-model="settings.explorer.showEmptyFiles" label="Show empty files" />
              <div class="min-w-0 flex-1">
                <p class="font-medium text-ink">Show empty files</p>
                <p class="text-ink-muted">Files with no content; folded away by default</p>
              </div>
              <code class="tabular shrink-0 text-[11px] text-ink-muted"
                >explorer.showEmptyFiles =
                <span class="text-brand">{{ settings.explorer.showEmptyFiles }}</span></code
              >
            </div>
          </section>
        </div>

        <div
          class="flex h-7 shrink-0 items-center gap-3 border-t border-border bg-sunken px-4 text-[11px] text-ink-muted"
        >
          <span>changes apply immediately</span>
        </div>
      </div>
    </div>
  </Teleport>
</template>
