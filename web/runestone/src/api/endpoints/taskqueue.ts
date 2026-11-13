/**
 * Task Queue API
 */

import { httpClient, type RequestOptions } from '../client'
import type { RegisteredTask } from '../types'

type CallOptions = Pick<RequestOptions, 'signal' | 'background'>

export const taskqueueApi = {
  /** The worker tasks online workers have registered; empty when none are online. */
  registeredTasks(options?: CallOptions): Promise<RegisteredTask[]> {
    return httpClient.get<RegisteredTask[]>('/taskqueue/tasks/registered', options)
  },
}
