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
 * The workers the server can queue, as the picker shows them. They come from
 * the task registry of the workers that are online (`useWorkers`).
 */

export interface WorkerOption {
  key: string
  label: string
  description?: string
  /** How to ask for it: `text`, `textarea`, `checkbox` or `select`. */
  type: string
  default: string
  /** Must be filled in before the worker can run. */
  required?: boolean
  /** The choices of a `select`. */
  items?: string[]
}

export interface Worker {
  /** The Celery task name, e.g. `openrelik-worker-strings.tasks.strings`. */
  id: string
  name: string
  queue: string
  description?: string
  options: WorkerOption[]
}
