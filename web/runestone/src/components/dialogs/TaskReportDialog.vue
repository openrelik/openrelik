<script setup lang="ts">
import { File, X } from '@/components/icons'
import { RouterLink } from 'vue-router'

import MarkdownView from '@/components/reports/MarkdownView.vue'
import PriorityBadge from '@/components/reports/PriorityBadge.vue'
import { useTaskReport } from '@/composables/useTaskReport'

/**
 * What a worker found: its report on the whole task, then its report on each
 * file it flagged, highest priority first. Reports are long and read with
 * care, so they get a sheet of their own rather than the side panel.
 */
const { report, close } = useTaskReport()
</script>

<template>
  <Teleport to="body">
    <div v-if="report" class="fixed inset-0 z-50">
      <div class="absolute inset-0 bg-ink/20" aria-hidden="true" @pointerdown="close" />
      <div
        tabindex="-1"
        v-autofocus
        v-trap-focus
        class="sheet absolute top-[8vh] left-1/2 flex max-h-[84vh] w-[min(52rem,calc(100vw-2rem))] -translate-x-1/2 flex-col overflow-hidden text-[12px] shadow-(--shadow-float) outline-none"
        role="dialog"
        aria-modal="true"
        aria-labelledby="report-title"
      >
        <div
          class="flex h-10 shrink-0 items-center gap-2 border-b border-border bg-sunken pr-2 pl-4"
        >
          <h2 id="report-title" class="card-title truncate">{{ report.task.name }} report</h2>
          <button
            type="button"
            class="ml-auto flex size-6 cursor-pointer items-center justify-center rounded-(--radius-control) text-ink-muted hover:bg-surface hover:text-ink"
            aria-label="Close report"
            v-tooltip="'Close'"
            @click="close"
          >
            <X :size="14" :stroke-width="1.5" />
          </button>
        </div>

        <div class="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <section v-if="report.task.report" aria-label="Task report">
            <div class="flex items-start gap-2">
              <PriorityBadge :priority="report.task.report.priority" />
              <p class="font-medium text-ink">{{ report.task.report.summary }}</p>
            </div>
            <MarkdownView
              v-if="report.task.report.markdown"
              class="mt-3"
              :source="report.task.report.markdown"
            />
          </section>

          <section
            v-if="report.task.fileReports.length"
            :class="{ 'mt-6 border-t border-border pt-4': report.task.report }"
            aria-label="File reports"
          >
            <p class="micro-label pb-2">files</p>
            <article
              v-for="file in report.task.fileReports"
              :key="file.fileId"
              class="border-b border-border py-3 last:border-b-0"
            >
              <div class="flex items-start gap-2">
                <PriorityBadge :priority="file.priority" />
                <div class="min-w-0">
                  <RouterLink
                    :to="`/folder/${report.folderId}/file/${file.fileId}`"
                    class="flex items-center gap-1.5 font-medium text-ink hover:text-brand"
                    @click="close"
                  >
                    <File :size="12" :stroke-width="1.5" class="shrink-0 text-ink-muted" />
                    <span class="truncate">{{ file.fileName }}</span>
                  </RouterLink>
                  <p v-if="file.summary" class="mt-0.5 text-ink-secondary">{{ file.summary }}</p>
                </div>
              </div>
              <MarkdownView v-if="file.markdown" class="mt-2 pl-1" :source="file.markdown" />
            </article>
          </section>
        </div>
      </div>
    </div>
  </Teleport>
</template>
