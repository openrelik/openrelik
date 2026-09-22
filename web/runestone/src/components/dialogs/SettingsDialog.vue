<script setup lang="ts">
import { Monitor, Moon, Sun, X } from '@/components/icons'

import KeyHint from '@/components/base/KeyHint.vue'
import Switch from '@/components/base/Switch.vue'
import { settingsOpen, useSettings, type ThemeChoice } from '@/composables/useSettings'

/**
 * Settings, as a dialog over whatever page you are on — so changing one never
 * costs you your place.
 *
 * Each row says what it does in words and, on the right, what it is as a
 * config key: `ai.summaries = true`. The words are for deciding; the key is for
 * the person who will later grep a config file for it. The AI switch rules the
 * three features below it: off, they keep their values but stand greyed out.
 */
const settings = useSettings()

const close = () => (settingsOpen.value = false)

const THEMES: { value: ThemeChoice; label: string; icon: typeof Sun }[] = [
  { value: 'system', label: 'system', icon: Monitor },
  { value: 'light', label: 'light', icon: Sun },
  { value: 'dark', label: 'dark', icon: Moon },
]

const AI_FEATURES = [
  {
    key: 'summaries',
    label: 'File summarization',
    help: 'LLM-generated summaries for files',
  },
  { key: 'chat', label: 'Assistant chat for files', help: 'LLM chat about a file' },
  {
    key: 'workflowNames',
    label: 'Workflow name generation',
    help: 'LLM-generated names for workflows',
  },
] as const
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
            v-tooltip="'Close (esc)'"
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
                  v-tooltip="
                    theme.value === 'system'
                      ? 'Follow system OS appearance'
                      : theme.value === 'light'
                        ? 'Always use light theme'
                        : 'Always use dark theme'
                  "
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

          <!-- ai -->
          <section aria-labelledby="settings-ai">
            <p id="settings-ai" class="micro-label px-4 pt-2 pb-1">ai</p>

            <div class="flex items-center gap-3 px-4 py-2.5">
              <Switch
                v-model="settings.ai.enabled"
                label="Enable AI features"
                :tooltip="settings.ai.enabled ? 'Disable all AI features' : 'Enable AI features'"
              />
              <div class="min-w-0 flex-1">
                <p class="font-medium text-ink">Enable AI features</p>
                <p class="text-ink-muted">Turns every AI feature below on or off</p>
              </div>
              <code class="tabular shrink-0 text-[11px] text-ink-muted"
                >ai.enabled = <span class="text-brand">{{ settings.ai.enabled }}</span></code
              >
            </div>

            <label
              v-for="feature in AI_FEATURES"
              :key="feature.key"
              class="flex items-center gap-3 py-2 pr-4 pl-8"
              :class="settings.ai.enabled ? 'cursor-pointer hover:bg-sunken' : 'opacity-50'"
            >
              <input
                v-model="settings.ai[feature.key]"
                type="checkbox"
                class="accent-brand"
                :disabled="!settings.ai.enabled"
                v-tooltip="
                  !settings.ai.enabled
                    ? 'Requires master AI toggle enabled'
                    : settings.ai[feature.key]
                      ? `Disable ${feature.label}`
                      : `Enable ${feature.label}`
                "
              />
              <span class="min-w-0 flex-1">
                <span class="block text-ink">{{ feature.label }}</span>
                <span class="block text-ink-muted">{{ feature.help }}</span>
              </span>
              <code class="tabular shrink-0 text-[11px] text-ink-muted"
                >ai.{{ feature.key }} =
                <span class="text-brand">{{ settings.ai[feature.key] }}</span></code
              >
            </label>
          </section>

          <hr class="my-2 border-border" />

          <!-- workflow -->
          <section aria-labelledby="settings-workflow">
            <p id="settings-workflow" class="micro-label px-4 pt-2 pb-1">workflow</p>

            <div class="flex items-center gap-3 px-4 py-2.5">
              <div class="min-w-0 flex-1">
                <p class="font-medium text-ink">Default editor</p>
                <p class="text-ink-muted">Which editor opens a workflow</p>
              </div>
              <div
                class="flex shrink-0 items-center gap-0.5 rounded-(--radius-control) border border-border bg-sunken p-0.5"
                role="radiogroup"
                aria-label="Default editor"
              >
                <button
                  v-for="editor in ['new', 'old'] as const"
                  :key="editor"
                  type="button"
                  role="radio"
                  :aria-checked="settings.workflow.editor === editor"
                  v-tooltip="`Use the ${editor} workflow editor by default`"
                  class="h-6 cursor-pointer rounded-(--radius-check) px-2.5 transition-colors duration-120 ease-(--ease-standard)"
                  :class="
                    settings.workflow.editor === editor
                      ? 'bg-brand-tint text-brand'
                      : 'text-ink-muted hover:bg-canvas hover:text-ink-secondary'
                  "
                  @click="settings.workflow.editor = editor"
                >
                  {{ editor }} editor
                </button>
              </div>
              <code class="tabular w-44 shrink-0 text-right text-[11px] text-ink-muted"
                >workflow.editor =
                <span class="text-brand">"{{ settings.workflow.editor }}"</span></code
              >
            </div>

            <label class="flex cursor-pointer items-center gap-3 px-4 py-2 hover:bg-sunken">
              <input
                v-model="settings.workflow.chords"
                type="checkbox"
                class="accent-brand"
                v-tooltip="
                  settings.workflow.chords
                    ? 'Disable workflow chord creation'
                    : 'Enable workflow chord creation'
                "
              />
              <span class="min-w-0 flex-1">
                <span class="block text-ink">Chord creation</span>
                <span class="block text-ink-muted">Allow creating chords in a workflow</span>
              </span>
              <code class="tabular shrink-0 text-[11px] text-ink-muted"
                >workflow.chords =
                <span class="text-brand">{{ settings.workflow.chords }}</span></code
              >
            </label>
          </section>
        </div>

        <div
          class="flex h-7 shrink-0 items-center gap-3 border-t border-border bg-sunken px-4 text-[11px] text-ink-muted"
        >
          <span>changes apply immediately</span>
          <KeyHint keys="esc" label="close" class="ml-auto" />
        </div>
      </div>
    </div>
  </Teleport>
</template>
