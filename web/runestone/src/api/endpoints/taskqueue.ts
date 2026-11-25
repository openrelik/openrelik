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
 * Task Queue API
 */

import { httpClient, type RequestOptions } from '../client'
import type { RegisteredTask, TaskqueueStatus } from '../types'

type CallOptions = Pick<RequestOptions, 'signal' | 'background'>

export interface TaskqueueStatusOptions extends CallOptions {
  /** Ask the server to bypass its short cache cooldown. */
  refresh?: boolean
}

export const taskqueueApi = {
  /** The worker tasks online workers have registered; empty when none are online. */
  registeredTasks(options?: CallOptions): Promise<RegisteredTask[]> {
    return httpClient.get<RegisteredTask[]>('/taskqueue/tasks/registered', options)
  },

  /** Live aggregate Celery worker, slot, and per-queue/per-task status. */
  status(options?: TaskqueueStatusOptions): Promise<TaskqueueStatus> {
    const { refresh, ...requestOptions } = options ?? {}
    const path = refresh ? '/taskqueue/status?refresh=true' : '/taskqueue/status'
    return httpClient.get<TaskqueueStatus>(path, requestOptions)
  },
}
