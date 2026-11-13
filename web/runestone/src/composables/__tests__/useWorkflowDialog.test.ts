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

import {
  closeWorkflowDialog,
  openWorkflowDialog,
  useWorkflowDialog,
} from '@/composables/useWorkflowDialog'
import { useModalStore } from '@/stores/modals'
import type { Item } from '@/types/item'

function makeFile(id: number, name: string): Item {
  return {
    id,
    parent: 5,
    kind: 'file',
    name,
    owner: 'Alice',
    modified: '2026-11-01T00:00:00Z',
    size: 512,
  }
}

beforeEach(() => {
  setActivePinia(createPinia())
})

describe('useWorkflowDialog', () => {
  it('opens and closes the workflow dialog via helpers and the writable workflowTarget computed', () => {
    const modalStore = useModalStore()
    const dialog = useWorkflowDialog()
    const file = makeFile(1, 'image.E01')

    // Empty files array is ignored.
    dialog.open([], 5)
    expect(dialog.workflowTarget.value).toBeNull()
    expect(modalStore.isModalOpen('workflow')).toBe(false)

    openWorkflowDialog([file], 5)
    expect(dialog.workflowTarget.value).toEqual({ files: [file], folderId: 5 })
    expect(modalStore.isModalOpen('workflow')).toBe(true)

    closeWorkflowDialog()
    expect(dialog.workflowTarget.value).toBeNull()
    expect(modalStore.isModalOpen('workflow')).toBe(false)

    // Writable computed setter opens when truthy and closes when null.
    dialog.workflowTarget.value = { files: [file], folderId: 9 }
    expect(modalStore.isModalOpen('workflow')).toBe(true)

    dialog.workflowTarget.value = null
    expect(modalStore.isModalOpen('workflow')).toBe(false)
  })

  it('returns null workflowTarget when closeTopModal dismisses the dialog via Escape', () => {
    const modalStore = useModalStore()
    const dialog = useWorkflowDialog()
    const file = makeFile(2, 'disk.raw')

    openWorkflowDialog([file], 7)
    expect(dialog.workflowTarget.value).not.toBeNull()

    modalStore.closeTopModal()
    expect(modalStore.isModalOpen('workflow')).toBe(false)
    expect(dialog.workflowTarget.value).toBeNull()
  })
})
