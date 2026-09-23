/**
 * Configs API
 *
 * What the server is configured to allow, for the UI to follow.
 */

import { httpClient, type RequestOptions } from '../client'

type CallOptions = Pick<RequestOptions, 'signal' | 'background'>

export interface SystemConfig {
  /** Language models the server can use; empty when AI features are off. */
  active_llms?: unknown[]
  /** Data types whose HTML may be previewed rendered (unescaped) in a sandboxed iframe. */
  allowed_data_types_preview?: string[]
  agents_enabled?: boolean
}

export const configsApi = {
  system(options?: CallOptions): Promise<SystemConfig> {
    return httpClient.get<SystemConfig>('/configs/system/', options)
  },
}
