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

import { describe, expect, it, vi } from 'vitest'

import { api } from '@/api'

function stubJsonFetch(body: unknown) {
  const fetchMock = vi.fn().mockImplementation(() =>
    Promise.resolve(
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    ),
  )
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

describe('status API endpoints', () => {
  it('calls taskqueue.status with and without refresh query param', async () => {
    const fetchMock = stubJsonFetch({ collected_at: '2026-11-25T12:00:00Z' })

    await api.taskqueue.status()
    expect(String(fetchMock.mock.calls[0]?.[0])).toMatch(/\/taskqueue\/status$/)

    await api.taskqueue.status({ refresh: true })
    expect(String(fetchMock.mock.calls[1]?.[0])).toMatch(/\/taskqueue\/status\?refresh=true$/)
  })

  it('calls configs.status with and without refresh query param', async () => {
    const fetchMock = stubJsonFetch({ collected_at: '2026-11-25T12:00:00Z' })

    await api.configs.status()
    expect(String(fetchMock.mock.calls[0]?.[0])).toMatch(/\/configs\/status$/)

    await api.configs.status({ refresh: true })
    expect(String(fetchMock.mock.calls[1]?.[0])).toMatch(/\/configs\/status\?refresh=true$/)
  })

  it('calls workflows.active', async () => {
    const fetchMock = stubJsonFetch([])

    await api.workflows.active()
    expect(String(fetchMock.mock.calls[0]?.[0])).toMatch(/\/workflows\/active$/)
  })
})
