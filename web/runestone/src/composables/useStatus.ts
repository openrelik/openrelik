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
 * Status Composable
 *
 * Loads live Celery worker/queue status and the current user's accessible
 * active workflows in parallel through `useQueryCache`. Each feed keeps its
 * own `QueryState` so they fail, retry, and refresh independently.
 *
 * Module-scoped state so navigating back within the stale window renders
 * saved data immediately; `clearStatus()` wipes both on sign-out so the next
 * operator never sees the previous user's active workflows.
 */

import { computed, shallowRef, type ComputedRef, type ShallowRef } from 'vue'

import { api } from '@/api'
import type { ActiveWorkflowSummary, SystemStorageStatus, TaskqueueStatus } from '@/api/types'
import { ensure, queryState, type QueryState } from '@/composables/useQueryCache'

const CLUSTER_KEY = 'status:taskqueue'
const WORKFLOWS_KEY = 'status:workflows'
const STORAGE_KEY = 'status:storage'
const CLUSTER_STALE_MS = 5_000
const WORKFLOWS_STALE_MS = 5_000
const STORAGE_STALE_MS = 60_000

const clusterStatus = shallowRef<TaskqueueStatus | null>(null)
const activeWorkflows = shallowRef<ActiveWorkflowSummary[]>([])
const storageStatus = shallowRef<SystemStorageStatus | null>(null)
let sessionEpoch = 0

export interface LoadStatusOptions {
  force?: boolean
  background?: boolean
  signal?: AbortSignal
}

export function loadClusterStatus(options: LoadStatusOptions = {}): Promise<void> {
  const { force = false, background = false, signal } = options
  return ensure(
    CLUSTER_KEY,
    async (reqSignal) => {
      const epoch = sessionEpoch
      const data = await api.taskqueue.status({
        signal: reqSignal,
        background,
        refresh: force,
      })
      if (epoch !== sessionEpoch) return
      clusterStatus.value = data
    },
    { staleMs: CLUSTER_STALE_MS, force, signal },
  ).catch(() => {})
}

export function loadActiveWorkflows(options: LoadStatusOptions = {}): Promise<void> {
  const { force = false, background = false, signal } = options
  return ensure(
    WORKFLOWS_KEY,
    async (reqSignal) => {
      const epoch = sessionEpoch
      const data = await api.workflows.active({ signal: reqSignal, background })
      if (epoch !== sessionEpoch) return
      activeWorkflows.value = data
    },
    { staleMs: WORKFLOWS_STALE_MS, force, signal },
  ).catch(() => {})
}

export function loadStorageStatus(options: LoadStatusOptions = {}): Promise<void> {
  const { force = false, background = false, signal } = options
  return ensure(
    STORAGE_KEY,
    async (reqSignal) => {
      const epoch = sessionEpoch
      const data = await api.configs.status({
        signal: reqSignal,
        background,
        refresh: force,
      })
      if (epoch !== sessionEpoch) return
      storageStatus.value = data
    },
    { staleMs: STORAGE_STALE_MS, force, signal },
  ).catch(() => {})
}

export function loadStatus(options: LoadStatusOptions = {}): Promise<void[]> {
  // Auto-refresh (background) respects the 60s storage cache; explicit Refresh forces it.
  const storageForce = Boolean(options.force && !options.background)
  return Promise.all([
    loadClusterStatus(options),
    loadActiveWorkflows(options),
    loadStorageStatus({ ...options, force: storageForce }),
  ])
}

/** Forgets cached cluster status, storage status, and active workflows (sign-out). */
export function clearStatus(): void {
  sessionEpoch++
  clusterStatus.value = null
  activeWorkflows.value = []
  storageStatus.value = null
}

export interface UseStatusReturn {
  clusterStatus: Readonly<ShallowRef<TaskqueueStatus | null>>
  activeWorkflows: Readonly<ShallowRef<ActiveWorkflowSummary[]>>
  storageStatus: Readonly<ShallowRef<SystemStorageStatus | null>>
  clusterState: ComputedRef<QueryState>
  workflowsState: ComputedRef<QueryState>
  storageState: ComputedRef<QueryState>
}

export function useStatus(): UseStatusReturn {
  return {
    clusterStatus,
    activeWorkflows,
    storageStatus,
    clusterState: computed(() => queryState(CLUSTER_KEY)),
    workflowsState: computed(() => queryState(WORKFLOWS_KEY)),
    storageState: computed(() => queryState(STORAGE_KEY)),
  }
}
