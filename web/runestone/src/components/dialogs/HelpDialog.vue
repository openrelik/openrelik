<script setup lang="ts">
import { X } from '@/components/icons'
import { onMounted, onUnmounted } from 'vue'

import KeyHint from '@/components/base/KeyHint.vue'
import { useHelp } from '@/composables/useHelp'

/**
 * Every keyboard shortcut, on one sheet, grouped by where it works.
 *
 * `?` opens it from anywhere that is not mid-typing — including the prompt
 * while its line is empty, since the prompt is focused by default and would
 * otherwise swallow the key. `?` or Esc closes it; nothing reaches the page
 * behind while it is open.
 */
const { helpOpen, close } = useHelp()

function onKey(event: KeyboardEvent) {
  if (helpOpen.value && event.key === '?') {
    close()
    event.preventDefault()
    event.stopPropagation()
  }
}
onMounted(() => window.addEventListener('keydown', onKey))
onUnmounted(() => window.removeEventListener('keydown', onKey))

interface Shortcut {
  keys: string[]
  does: string
}

const GROUPS: { title: string; note?: string; shortcuts: Shortcut[] }[] = [
  {
    title: 'anywhere',
    shortcuts: [
      { keys: ['g', '⌘K'], does: 'Prompt: focus path prompt or open prompt' },
      { keys: ['⌘,'], does: 'Settings' },
      { keys: ['click your name'], does: 'Account: API keys, sign out' },
      { keys: ['?'], does: 'This help' },
    ],
  },
  {
    title: 'prompt',
    note: 'Focused when you arrive. Typing searches below the current folder; from the top it also searches the server.',
    shortcuts: [
      { keys: ['/…'], does: 'Search from the top instead' },
      { keys: ['../…'], does: 'Search from the folder above' },
      { keys: ['↑', '↓'], does: 'Pick a result (also ^N ^P)' },
      { keys: ['tab'], does: 'Complete the line to the picked result' },
      { keys: ['⏎'], does: 'Go there' },
      { keys: ['cd ..'], does: 'Up one folder' },
      { keys: ['mkdir …'], does: 'Create a folder here' },
      { keys: ['rm …'], does: 'Delete a folder here (asks first)' },
      { keys: ['^U'], does: 'Clear the line' },
      { keys: ['esc'], does: 'Clear the line, then leave the prompt' },
    ],
  },
  {
    title: 'listing',
    note: 'Letters work once you leave the prompt with esc.',
    shortcuts: [
      { keys: ['↑', '↓'], does: 'Move (also j k)' },
      { keys: ['home', 'end'], does: 'First, last' },
      { keys: ['pgup', 'pgdn'], does: 'Previous, next page (top level)' },
      { keys: ['⏎', '→'], does: 'Open folder or file (also l)' },
      { keys: ['..'], does: 'First row: ⏎ on it goes up one folder' },
      { keys: ['space'], does: 'Select' },
      { keys: ['⇧↑', '⇧↓'], does: 'Extend the selection (also ⇧click)' },
      { keys: ['⌘A'], does: 'Select all' },
      { keys: ['⌘⏎', 'r'], does: 'Run a worker on the highlighted or selected files' },
      { keys: ['w'], does: 'Create a workflow on the highlighted or selected files' },
      { keys: ['i'], does: 'Show or hide the inspector' },
      { keys: ['/'], does: 'Filter this folder' },
      { keys: ['⇧R'], does: 'Refresh this folder from the server' },
      { keys: ['u'], does: 'Upload files here (or drop them on the listing)' },
      { keys: ['s'], does: 'Share this folder' },
      { keys: ['F2', 'e'], does: 'Rename highlighted folder or file' },
      { keys: ['del', '⌫', '⌘⌫'], does: 'Delete the selected or highlighted items' },
      { keys: ['esc'], does: 'Clear the selection, or close a task' },
      { keys: ['f'], does: 'Full-screen flowchart, in a workflow folder' },
      { keys: ['a'], does: 'Add a worker to a draft workflow, after the selected task' },
      { keys: ['⇧⏎'], does: 'Run a draft workflow' },
      { keys: ['del', '⌫'], does: 'Remove the selected task from a draft workflow' },
      { keys: ['⌘Z'], does: 'Undo the last removal, split or merge in a draft workflow' },
      {
        keys: ['⌘click', '⇧click'],
        does: 'In a draft flowchart: select more tasks of a group to split them out, or more groups (click their box) to merge them',
      },
    ],
  },
  {
    title: 'file',
    shortcuts: [
      { keys: ['d'], does: 'Download the file' },
      { keys: ['i'], does: 'Show or hide the side panel (Details, Inspector)' },
      { keys: ['w'], does: 'Create a workflow on the file' },
      { keys: ['esc', 'cd .'], does: 'Back to the folder' },
    ],
  },
  {
    title: 'table view',
    shortcuts: [
      { keys: ['↑', '↓'], does: 'Move through rows; the row shows in full on the right' },
      { keys: ['/'], does: 'Filter rows: text in any cell, or column:value' },
      { keys: ['⌘C'], does: 'Copy the row (tab-separated, or the JSON line)' },
      { keys: ['f'], does: 'Full screen, and back (esc)' },
      { keys: ['esc'], does: 'Clear the row selection, then leave full screen' },
    ],
  },
  {
    title: 'hex view',
    shortcuts: [
      { keys: ['←', '→', '↑', '↓'], does: 'Move the cursor a byte or a row (⇧ selects)' },
      { keys: ['⌘↑', '⌘↓'], does: 'Start, end of the file' },
      { keys: ['o'], does: 'Go to an offset (hex as 0x1f0, or decimal)' },
      { keys: ['[', ']'], does: 'Back, forward through jumps' },
      { keys: ['⌘C', '⇧⌘C'], does: 'Copy the selection as hex, as text' },
    ],
  },
  {
    title: 'full-screen flowchart',
    shortcuts: [
      { keys: ['esc'], does: 'Close the task, then exit' },
      { keys: ['f'], does: 'Exit' },
    ],
  },
]
</script>

<template>
  <Teleport to="body">
    <div v-if="helpOpen" class="fixed inset-0 z-50">
      <div class="absolute inset-0 bg-ink/20" aria-hidden="true" @pointerdown="close" />
      <div
        tabindex="-1"
        v-autofocus
        v-trap-focus
        class="sheet absolute top-[8vh] left-1/2 flex max-h-[84vh] w-[min(48rem,calc(100vw-2rem))] -translate-x-1/2 flex-col overflow-hidden text-[12px] shadow-(--shadow-float) outline-none"
        role="dialog"
        aria-modal="true"
        aria-labelledby="help-title"
      >
        <div
          class="flex h-10 shrink-0 items-center gap-2 border-b border-border bg-sunken pr-2 pl-4"
        >
          <h2 id="help-title" class="card-title">keyboard shortcuts</h2>
          <button
            type="button"
            class="ml-auto flex size-6 cursor-pointer items-center justify-center rounded-(--radius-control) text-ink-muted hover:bg-surface hover:text-ink"
            aria-label="Close help"
            v-tooltip="'Close (esc)'"
            @click="close"
          >
            <X :size="14" :stroke-width="1.5" />
          </button>
        </div>

        <div class="min-h-0 flex-1 columns-2 gap-6 overflow-y-auto px-4 py-3 max-md:columns-1">
          <section
            v-for="group in GROUPS"
            :key="group.title"
            class="mb-4 break-inside-avoid"
            :aria-labelledby="`help-${group.title}`"
          >
            <p :id="`help-${group.title}`" class="micro-label pb-1">{{ group.title }}</p>
            <p v-if="group.note" class="pb-1.5 text-[11px] text-ink-muted">{{ group.note }}</p>
            <dl class="divide-y divide-border">
              <div
                v-for="shortcut in group.shortcuts"
                :key="shortcut.does"
                class="flex items-baseline gap-3 py-1.5"
              >
                <dt class="flex w-24 shrink-0 flex-wrap gap-1">
                  <kbd
                    v-for="key in shortcut.keys"
                    :key="key"
                    class="rounded-(--radius-check) border border-border-strong bg-sunken px-1 text-[11px] leading-4 whitespace-nowrap text-ink"
                    >{{ key }}</kbd
                  >
                </dt>
                <dd class="text-ink-secondary">{{ shortcut.does }}</dd>
              </div>
            </dl>
          </section>
        </div>

        <div
          class="flex h-7 shrink-0 items-center gap-3 border-t border-border bg-sunken px-4 text-[11px] text-ink-muted"
        >
          <span>⌘ is Ctrl on Windows and Linux</span>
          <span class="ml-auto flex items-center gap-3">
            <KeyHint keys="?" label="close" />
            <KeyHint keys="esc" label="close" />
          </span>
        </div>
      </div>
    </div>
  </Teleport>
</template>
