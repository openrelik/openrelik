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

/**
 * Workers Composable
 *
 * The workers the server can queue, from the task registry of the workers
 * that are online. Shared by every picker; the list changes only when workers
 * are deployed, so it stays fresh for five minutes.
 */

import { computed, shallowRef, type ComputedRef, type ShallowRef } from 'vue'

import api from '@/api'
import { mapRegisteredTask } from '@/utils/worker'
import type { Worker } from '@/types/worker'
import { ensure, queryState, type QueryState } from '@/composables/useQueryCache'

const KEY = 'workers:registered'
const STALE_MS = 5 * 60_000

const workers = shallowRef<Worker[]>([])
let sessionEpoch = 0

async function fetchWorkers(signal: AbortSignal): Promise<void> {
  const epoch = sessionEpoch
  const tasks = await api.taskqueue.registeredTasks({ signal, background: true })
  if (epoch !== sessionEpoch) return
  workers.value = tasks.map(mapRegisteredTask).sort((a, b) => a.name.localeCompare(b.name))
}

/** Loads the registry unless it is fresh. Never rejects; failures land in `state`. */
export function loadWorkers(options: { force?: boolean } = {}): Promise<void> {
  return ensure(KEY, fetchWorkers, { staleMs: STALE_MS, force: options.force }).catch(() => {})
}

export interface UseWorkersReturn {
  workers: Readonly<ShallowRef<Worker[]>>
  state: ComputedRef<QueryState>
  /** Task names that can run now, or null until the registry has loaded. */
  available: ComputedRef<Set<string> | null>
}

/** Forgets the loaded worker registry (sign-out). */
export function clearWorkers(): void {
  sessionEpoch++
  workers.value = []
}

export function useWorkers(): UseWorkersReturn {
  const state = computed(() => queryState(KEY))
  return {
    workers,
    state,
    available: computed(() =>
      state.value.status === 'success' ? new Set(workers.value.map((w) => w.id)) : null,
    ),
  }
}
