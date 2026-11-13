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

// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'

import { isCommandModifier, isTyping, promptPassesThrough } from '@/utils/keyboard'

function keyEvent(
  key: string,
  init: KeyboardEventInit = {},
  target?: EventTarget | null,
): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, ...init })
  if (target !== undefined) {
    Object.defineProperty(event, 'target', { value: target })
  }
  return event
}

describe('promptPassesThrough', () => {
  it('always passes Cmd+Enter and Ctrl+Enter through even when the prompt has text', () => {
    expect(promptPassesThrough(keyEvent('Enter', { metaKey: true }), 'filter text')).toBe(true)
    expect(promptPassesThrough(keyEvent('Enter', { ctrlKey: true }), 'filter text')).toBe(true)
  })

  it.each(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter', ' ', 'Home', 'End'])(
    'passes listing key %j through when the prompt line is empty',
    (key) => {
      expect(promptPassesThrough(keyEvent(key), '')).toBe(true)
      expect(promptPassesThrough(keyEvent(key), 'abc')).toBe(false)
    },
  )

  it('passes ? through only when the prompt line is empty and unmodified', () => {
    expect(promptPassesThrough(keyEvent('?'), '')).toBe(true)
    expect(promptPassesThrough(keyEvent('?'), 'abc')).toBe(false)
    expect(promptPassesThrough(keyEvent('?', { metaKey: true }), '')).toBe(false)
    expect(promptPassesThrough(keyEvent('?', { altKey: true }), '')).toBe(false)
  })

  it('keeps non-listing keys in the prompt even when empty', () => {
    expect(promptPassesThrough(keyEvent('a'), '')).toBe(false)
    expect(promptPassesThrough(keyEvent('Escape'), '')).toBe(false)
  })
})

describe('isTyping', () => {
  it('returns false when target is null, document, or a plain non-editable element', () => {
    expect(isTyping(keyEvent('j', {}, null))).toBe(false)
    expect(isTyping(keyEvent('j', {}, document))).toBe(false)
    expect(isTyping(keyEvent('j', {}, document.createElement('div')))).toBe(false)
    expect(isTyping(keyEvent('j', {}, document.createElement('button')))).toBe(false)
  })

  it('returns true for textarea, select, text input, and contentEditable elements', () => {
    expect(isTyping(keyEvent('j', {}, document.createElement('textarea')))).toBe(true)
    expect(isTyping(keyEvent('g', {}, document.createElement('select')))).toBe(true)
    expect(isTyping(keyEvent('Escape', {}, document.createElement('select')))).toBe(true)

    const textInput = document.createElement('input')
    textInput.type = 'text'
    expect(isTyping(keyEvent('j', {}, textInput))).toBe(true)

    const editable = document.createElement('div')
    editable.contentEditable = 'true'
    Object.defineProperty(editable, 'isContentEditable', { value: true, configurable: true })
    expect(isTyping(keyEvent('j', {}, editable))).toBe(true)
  })

  it('returns false for checkbox and radio inputs', () => {
    const checkbox = document.createElement('input')
    checkbox.type = 'checkbox'
    const radio = document.createElement('input')
    radio.type = 'radio'

    expect(isTyping(keyEvent(' ', {}, checkbox))).toBe(false)
    expect(isTyping(keyEvent('ArrowDown', {}, radio))).toBe(false)
  })

  it('delegates data-prompt inputs to promptPassesThrough', () => {
    const promptInput = document.createElement('input')
    promptInput.dataset.prompt = ''
    promptInput.value = ''

    // Empty prompt lets ArrowDown pass through -> not typing
    expect(isTyping(keyEvent('ArrowDown', {}, promptInput))).toBe(false)
    // Letter key belongs to prompt -> typing
    expect(isTyping(keyEvent('a', {}, promptInput))).toBe(true)

    // Non-empty prompt captures ArrowDown -> typing, except Cmd+Enter
    promptInput.value = '/cases'
    expect(isTyping(keyEvent('ArrowDown', {}, promptInput))).toBe(true)
    expect(isTyping(keyEvent('Enter', { metaKey: true }, promptInput))).toBe(false)
  })
})

describe('isCommandModifier', () => {
  it('accepts Meta or Ctrl without Alt and rejects Alt combinations', () => {
    expect(isCommandModifier(keyEvent('k', { metaKey: true }))).toBe(true)
    expect(isCommandModifier(keyEvent('k', { ctrlKey: true }))).toBe(true)
    expect(isCommandModifier(keyEvent('k', { metaKey: true, altKey: true }))).toBe(false)
    expect(isCommandModifier(keyEvent('k', { ctrlKey: true, altKey: true }))).toBe(false)
    expect(isCommandModifier(keyEvent('k', { altKey: true }))).toBe(false)
    expect(isCommandModifier(keyEvent('k'))).toBe(false)
  })
})
