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

import { describe, expect, it } from 'vitest'

import { mapOption, mapRegisteredTask, missingOptions, workerShortName } from '@/utils/worker'

describe('utils/worker', () => {
  it('maps TaskConfigOption defaults, labels, types, and stringified values', () => {
    expect(mapOption({ name: 'regex' })).toEqual({
      key: 'regex',
      label: 'regex',
      description: undefined,
      type: 'text',
      default: '',
      required: undefined,
      items: undefined,
    })

    expect(
      mapOption({
        name: 'depth',
        label: 'Max depth',
        description: 'Recursion limit',
        type: 'select',
        value: 3,
        required: true,
        items: ['1', '3', '5'],
      }),
    ).toEqual({
      key: 'depth',
      label: 'Max depth',
      description: 'Recursion limit',
      type: 'select',
      default: '3',
      required: true,
      items: ['1', '3', '5'],
    })

    expect(mapOption({ name: 'flag', value: null, required: false }).default).toBe('')
    expect(mapOption({ name: 'bool', value: false }).default).toBe('false')
  })

  it('maps RegisteredTask with display_name fallback and missing task_config', () => {
    expect(
      mapRegisteredTask({
        task_name: 'openrelik-worker-strings.tasks.strings',
        queue_name: 'openrelik-worker-strings',
      }),
    ).toEqual({
      id: 'openrelik-worker-strings.tasks.strings',
      name: 'openrelik-worker-strings.tasks.strings',
      queue: 'openrelik-worker-strings',
      description: undefined,
      options: [],
    })

    expect(
      mapRegisteredTask({
        task_name: 'openrelik-worker-yara.tasks.scan',
        display_name: 'YARA Scan',
        queue_name: 'openrelik-worker-yara',
        description: 'Run YARA rules',
        task_config: [{ name: 'rules', label: 'Rules', required: true }],
      }),
    ).toEqual({
      id: 'openrelik-worker-yara.tasks.scan',
      name: 'YARA Scan',
      queue: 'openrelik-worker-yara',
      description: 'Run YARA rules',
      options: [
        {
          key: 'rules',
          label: 'Rules',
          description: undefined,
          type: 'text',
          default: '',
          required: true,
          items: undefined,
        },
      ],
    })
  })

  it('lists labels of required options that are missing or whitespace-only', () => {
    const options = [
      mapOption({ name: 'rule', label: 'YARA Rule', required: true }),
      mapOption({ name: 'password', label: 'Archive Password', required: true }),
      mapOption({ name: 'notes', label: 'Notes', required: false }),
    ]

    expect(missingOptions(options, { rule: '   ', notes: '' })).toEqual([
      'YARA Rule',
      'Archive Password',
    ])
    expect(missingOptions(options, { rule: 'rule a {}', password: 'secret' })).toEqual([])
  })

  it('strips the openrelik-worker- prefix in workerShortName', () => {
    expect(workerShortName('openrelik-worker-plaso')).toBe('plaso')
    expect(workerShortName('custom-queue')).toBe('custom-queue')
  })
})
