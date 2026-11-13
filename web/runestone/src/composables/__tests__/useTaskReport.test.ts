/*
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
*/

import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'

import { clearTaskReport, openTaskReport, useTaskReport } from '@/composables/useTaskReport'
import { useModalStore } from '@/stores/modals'
import type { Task } from '@/types/workflow'

function makeTask(id: string): Task {
  return {
    id,
    name: `Task ${id}`,
    module: `worker.${id}`,
    queue: 'default',
    status: 'success',
    outputs: [],
    report: { summary: 'Found 3 hits', priority: 40, markdown: '# Report' },
    fileReports: [],
    options: [],
    config: {},
    groups: [],
  }
}

beforeEach(() => {
  setActivePinia(createPinia())
})

describe('useTaskReport', () => {
  it('opens the report modal with task and folderId, and clears report when closed directly or via modal stack', () => {
    const modalStore = useModalStore()
    const { report, close } = useTaskReport()

    expect(report.value).toBeNull()
    expect(modalStore.isModalOpen('report')).toBe(false)

    const task = makeTask('yara-1')
    openTaskReport(task, 88)
    expect(modalStore.isModalOpen('report')).toBe(true)
    expect(report.value).toEqual({ task, folderId: 88 })

    close()
    expect(modalStore.isModalOpen('report')).toBe(false)
    expect(report.value).toBeNull()

    // Reopen and dismiss via modal stack (Esc behavior).
    const secondTask = makeTask('strings-2')
    openTaskReport(secondTask, 99)
    expect(report.value).toEqual({ task: secondTask, folderId: 99 })

    modalStore.closeTopModal()
    expect(report.value).toBeNull()

    // clearTaskReport clears both the modal stack and retained report state (sign-out).
    openTaskReport(secondTask, 99)
    expect(report.value).toEqual({ task: secondTask, folderId: 99 })
    clearTaskReport()
    expect(modalStore.isModalOpen('report')).toBe(false)
    expect(report.value).toBeNull()
  })
})
