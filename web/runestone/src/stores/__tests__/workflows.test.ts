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

import { useWorkflowsStore } from '@/stores/workflows'
import type { Workflow } from '@/types/workflow'

function makeWorkflow(id: number, folderId: number, name = `Workflow ${id}`): Workflow {
  return {
    id,
    folderId,
    name,
    created: '2026-01-01T00:00:00Z',
    inputs: [],
    groups: [],
    draft: true,
  }
}

describe('stores/workflows', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('upserts, reads, forgets individual workflows by folderId, and clears all', () => {
    const store = useWorkflowsStore()
    const first = makeWorkflow(1, 10, 'Initial')
    const second = makeWorkflow(2, 20, 'Other')

    expect(store.workflowOf(10)).toBeUndefined()

    store.upsertWorkflow(first)
    store.upsertWorkflow(second)
    expect(store.workflowOf(10)?.name).toBe('Initial')
    expect(store.workflowOf(20)?.name).toBe('Other')

    store.upsertWorkflow(makeWorkflow(1, 10, 'Renamed'))
    expect(store.workflowOf(10)?.name).toBe('Renamed')

    store.forgetWorkflow(10)
    expect(store.workflowOf(10)).toBeUndefined()
    expect(store.workflowOf(20)?.name).toBe('Other')

    store.forgetWorkflows()
    expect(store.workflows.size).toBe(0)
  })
})
