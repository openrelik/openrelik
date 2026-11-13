// @vitest-environment happy-dom
import { nextTick } from 'vue'
import { createMemoryHistory, createRouter, type Router } from 'vue-router'
import { createPinia, setActivePinia } from 'pinia'
import { DOMWrapper, flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import TaskReportDialog from '@/components/dialogs/TaskReportDialog.vue'
import directives from '@/directives'
import { openTaskReport, useTaskReport } from '@/composables/useTaskReport'
import { useModalStore } from '@/stores/modals'
import type { Task } from '@/types/workflow'

const pinia = createPinia()
setActivePinia(pinia)

let wrapper: VueWrapper | null = null

async function mountDialog(): Promise<{ body: DOMWrapper<HTMLElement>; router: Router }> {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', component: { template: '<div />' } },
      { path: '/folder/:folderId/file/:fileId', component: { template: '<div />' } },
    ],
  })
  await router.push('/')
  await router.isReady()

  wrapper = mount(TaskReportDialog, {
    attachTo: document.body,
    global: {
      plugins: [pinia, directives, router],
    },
  })
  return { body: new DOMWrapper(document.body), router }
}

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: '0123456789abcdef0123456789abcdef',
    name: 'Hayabusa',
    module: 'openrelik-worker-hayabusa.tasks.scan',
    queue: 'openrelik-worker-hayabusa',
    status: 'success',
    outputs: [11],
    fileReports: [],
    options: [],
    config: {},
    groups: [],
    ...overrides,
  }
}

beforeEach(() => {
  setActivePinia(pinia)
  useModalStore().closeAllModals()
})

afterEach(() => {
  useModalStore().closeAllModals()
  wrapper?.unmount()
  wrapper = null
  document.body.innerHTML = ''
})

describe('TaskReportDialog', () => {
  it('renders task report with priority badge, safe Markdown, and per-file reports', async () => {
    const { body, router } = await mountDialog()
    expect(body.find('[role="dialog"]').exists()).toBe(false)

    openTaskReport(
      makeTask({
        report: {
          priority: 85,
          summary: 'Critical lateral movement detected',
          markdown: 'Found **PsExec** execution.\n\n<script>alert(1)</script>',
        },
        fileReports: [
          {
            fileId: 77,
            fileName: 'Security.evtx',
            priority: 45,
            summary: 'Event 7045 service installation',
            markdown: '- Service `PSEXESVC` installed',
          },
          {
            fileId: 78,
            fileName: 'System.evtx',
            priority: 5,
            summary: '',
            markdown: '',
          },
        ],
      }),
      42,
    )
    await nextTick()

    const dialog = body.get('[role="dialog"]')
    expect(dialog.get('#report-title').text()).toBe('Hayabusa report')

    const taskSection = dialog.get('section[aria-label="Task report"]')
    expect(taskSection.text()).toContain('critical')
    expect(taskSection.text()).toContain('Critical lateral movement detected')
    expect(taskSection.text()).toContain('PsExec')
    expect(taskSection.element.querySelectorAll('script')).toHaveLength(0)

    const filesSection = dialog.get('section[aria-label="File reports"]')
    expect(filesSection.text()).toContain('Security.evtx')
    expect(filesSection.text()).toContain('Event 7045 service installation')
    expect(filesSection.text()).toContain('PSEXESVC')
    expect(filesSection.text()).toContain('System.evtx')

    // Clicking a file link navigates to FileView and closes the report dialog
    const fileLink = filesSection.findAll('a')[0]!
    expect(fileLink.attributes('href')).toBe('/folder/42/file/77')
    await fileLink.trigger('click')
    await flushPromises()

    expect(router.currentRoute.value.fullPath).toBe('/folder/42/file/77')
    expect(useTaskReport().report.value).toBeNull()
    expect(body.find('[role="dialog"]').exists()).toBe(false)
  })

  it('renders file-only report and closes via close button or backdrop', async () => {
    const { body } = await mountDialog()

    openTaskReport(
      makeTask({
        name: 'Strings',
        report: { priority: 20, summary: 'Medium summary only', markdown: '' },
        fileReports: [],
      }),
      10,
    )
    await nextTick()

    expect(body.find('section[aria-label="Task report"]').exists()).toBe(true)
    expect(body.find('section[aria-label="File reports"]').exists()).toBe(false)

    await body.get('button[aria-label="Close report"]').trigger('click')
    expect(body.find('[role="dialog"]').exists()).toBe(false)

    openTaskReport(
      makeTask({
        name: 'Yara',
        fileReports: [
          {
            fileId: 9,
            fileName: 'sample.bin',
            priority: 80,
            summary: 'Matched rule',
            markdown: '',
          },
        ],
      }),
      10,
    )
    await nextTick()
    expect(body.find('section[aria-label="Task report"]').exists()).toBe(false)
    expect(body.find('section[aria-label="File reports"]').exists()).toBe(true)

    await body.get('[aria-hidden="true"]').trigger('pointerdown')
    expect(body.find('[role="dialog"]').exists()).toBe(false)
  })

  it('renders multiple fileReports entries even when sharing a fileId without key collisions', async () => {
    const { body } = await mountDialog()

    openTaskReport(
      makeTask({
        name: 'Strings',
        fileReports: [
          {
            fileId: 9,
            fileName: 'sample.bin',
            priority: 60,
            summary: 'First pass finding',
            markdown: '',
          },
          {
            fileId: 9,
            fileName: 'sample.bin (chunk 2)',
            priority: 40,
            summary: 'Second pass finding',
            markdown: '',
          },
        ],
      }),
      10,
    )
    await nextTick()

    const articles = body.findAll('section[aria-label="File reports"] article')
    expect(articles).toHaveLength(2)
    expect(body.text()).toContain('First pass finding')
    expect(body.text()).toContain('Second pass finding')
  })
})
