// @vitest-environment happy-dom
import { nextTick } from 'vue'
import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import LinkMenu from '@/components/markdown/LinkMenu.vue'
import MarkdownView from '@/components/markdown/MarkdownView.vue'
import { closeLinkMenu, useLinkMenu } from '@/composables/useLinkMenu'
import { directives } from '@/directives'
import type { Block } from '@/utils/markdown'

vi.mock('vue-router', () => ({
  useRoute: () => ({ fullPath: '/' }),
}))

interface MarkdownProps {
  source: string | Block[]
  variant?: 'report' | 'document'
  marked?: { from: number; to: number } | null
}

const wrappers: { unmount: () => void }[] = []

function mountMarkdown(props: MarkdownProps) {
  const wrapper = mount(MarkdownView, {
    props,
    global: { plugins: [directives] },
  })
  wrappers.push(wrapper)
  return wrapper
}

function mountLinkMenu() {
  const wrapper = mount(LinkMenu, {
    global: { plugins: [directives] },
  })
  wrappers.push(wrapper)
  return wrapper
}

function getOpenMenu(): HTMLElement {
  const menu = document.body.querySelector<HTMLElement>('[role="menu"]')
  if (!menu) throw new Error('Expected LinkMenu [role="menu"] in document.body')
  return menu
}

beforeEach(() => {
  closeLinkMenu()
})

afterEach(() => {
  while (wrappers.length > 0) {
    wrappers.pop()?.unmount()
  }
  closeLinkMenu()
})

describe('MarkdownView untrusted DOM safety', () => {
  const HOSTILE_MARKDOWN = [
    '# Report <script>alert(1)</script>',
    '',
    'Inline attack: <img src="x" onerror="alert(1)"> and <iframe src="https://evil.com">',
    '',
    '- [xss](javascript:alert(1))',
    '- [bank](https://bank.com@evil.com/login)',
    '- ![beacon](https://evil.com/pixel.png)',
    '- <javascript:alert(2)>',
    '- <a href="https://evil.com" onclick="alert(1)">raw anchor</a>',
    '',
    '| Col | Payload |',
    '| --- | --- |',
    '| 1 | <img src="y" onerror="alert(2)"> |',
    '',
    '> <script>fetch("https://evil.com")</script>',
  ].join('\n')

  it('renders zero executable, embedded, image, or anchor elements for hostile Markdown', () => {
    const wrapper = mountMarkdown({ source: HOSTILE_MARKDOWN, variant: 'document' })

    expect(wrapper.element.querySelectorAll('script')).toHaveLength(0)
    expect(wrapper.element.querySelectorAll('iframe')).toHaveLength(0)
    expect(wrapper.element.querySelectorAll('img')).toHaveLength(0)
    expect(wrapper.element.querySelectorAll('a')).toHaveLength(0)

    const allElements = [wrapper.element, ...wrapper.element.querySelectorAll('*')]
    for (const el of allElements) {
      expect(el.hasAttribute('href')).toBe(false)
      expect(el.hasAttribute('src')).toBe(false)
      for (const attr of el.getAttributeNames()) {
        expect(attr.toLowerCase().startsWith('on')).toBe(false)
      }
    }

    const text = wrapper.text()
    expect(text).toContain('<script>alert(1)</script>')
    expect(text).toContain('<img src="x" onerror="alert(1)">')
    expect(text).toContain('<iframe src="https://evil.com">')
  })

  it('reveals hidden bidi and zero-width characters instead of passing them into the DOM', () => {
    const wrapper = mountMarkdown({ source: 'invoice\u202Etxt.exe\u200B' })

    expect(wrapper.text()).toContain('‹U+202E›')
    expect(wrapper.text()).toContain('‹U+200B›')
    expect(wrapper.text()).not.toContain('\u202E')
    expect(wrapper.text()).not.toContain('\u200B')
  })
})

describe('MarkdownView document line ranges and marking', () => {
  const DOCUMENT_SOURCE = [
    '# Heading on line 1',
    '## Subheading',
    '### Detail heading',
    '',
    'Paragraph with `code`, **bold**, *em*,\\',
    'and hard break.',
    '- list item on line 7',
    '- list item on line 8',
    '',
    'Trailing paragraph on line 10.',
  ].join('\n')

  it('sets data-line and data-end on blocks and marks only blocks overlapping lines 5–7', () => {
    const wrapper = mountMarkdown({
      source: DOCUMENT_SOURCE,
      variant: 'document',
      marked: { from: 5, to: 7 },
    })

    const blocks = [...wrapper.element.querySelectorAll('[data-line]')]
    expect(
      blocks.map((el) => ({
        tag: el.tagName.toLowerCase(),
        line: el.getAttribute('data-line'),
        end: el.getAttribute('data-end'),
        marked: el.hasAttribute('data-marked'),
      })),
    ).toEqual([
      { tag: 'h1', line: '1', end: '1', marked: false },
      { tag: 'h2', line: '2', end: '2', marked: false },
      { tag: 'h3', line: '3', end: '3', marked: false },
      { tag: 'p', line: '5', end: '6', marked: true },
      { tag: 'ul', line: '7', end: '8', marked: true },
      { tag: 'p', line: '10', end: '10', marked: false },
    ])
    expect(wrapper.find('code').text()).toBe('code')
    expect(wrapper.find('strong').text()).toBe('bold')
    expect(wrapper.find('em').text()).toBe('em')
    expect(wrapper.find('br').exists()).toBe(true)
  })

  it('omits line attributes in the report variant', () => {
    const wrapper = mountMarkdown({
      source: DOCUMENT_SOURCE,
      variant: 'report',
      marked: { from: 1, to: 8 },
    })

    expect(wrapper.element.querySelectorAll('[data-line]')).toHaveLength(0)
    expect(wrapper.element.querySelectorAll('[data-end]')).toHaveLength(0)
    expect(wrapper.element.querySelectorAll('[data-marked]')).toHaveLength(0)
  })
})

describe('MarkdownInline and LinkMenu', () => {
  it('updates useLinkMenu state on click and Enter for links and images', async () => {
    const { state } = useLinkMenu()
    const wrapper = mountMarkdown({
      source: '[bank](https://bank.com@evil.com/login) and ![beacon](https://evil.com/pixel.png)',
    })

    const [linkTrigger, imageTrigger] = wrapper.findAll('[role="button"]')
    if (!linkTrigger || !imageTrigger) {
      throw new Error('Expected link and image triggers')
    }

    await linkTrigger.trigger('click')
    expect(state.value).toEqual({
      url: 'https://bank.com@evil.com/login',
      kind: 'link',
      anchor: linkTrigger.element,
    })

    closeLinkMenu()
    expect(state.value).toBeNull()

    await linkTrigger.trigger('keydown', { key: 'a' })
    expect(state.value).toBeNull()

    await linkTrigger.trigger('keydown', { key: 'Enter' })
    expect(state.value).toEqual({
      url: 'https://bank.com@evil.com/login',
      kind: 'link',
      anchor: linkTrigger.element,
    })

    closeLinkMenu()
    await imageTrigger.trigger('click')
    expect(state.value).toEqual({
      url: 'https://evil.com/pixel.png',
      kind: 'image',
      anchor: imageTrigger.element,
    })

    closeLinkMenu()
    await imageTrigger.trigger('keydown', { key: 'Enter' })
    expect(state.value).toEqual({
      url: 'https://evil.com/pixel.png',
      kind: 'image',
      anchor: imageTrigger.element,
    })
  })

  it('disables opening a javascript: link and shows the reason in LinkMenu', async () => {
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null)
    const wrapper = mountMarkdown({ source: '[xss](javascript:alert(1))' })
    mountLinkMenu()

    await wrapper.get('[role="button"]').trigger('click')
    await nextTick()
    await nextTick()

    const menu = getOpenMenu()
    const [copyButton, openButton] = menu.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')
    if (!copyButton || !openButton) {
      throw new Error('Expected Copy and Open menu items')
    }

    expect(copyButton.textContent).toContain('Copy link')
    expect(copyButton.hasAttribute('aria-disabled')).toBe(false)

    expect(openButton.textContent).toContain('Open in a new tab')
    expect(openButton.getAttribute('aria-disabled')).toBe('true')
    expect(menu.textContent).toContain('Not a web link')
    expect(menu.textContent).toContain('Only web links open, not javascript:')

    openButton.click()
    expect(openSpy).not.toHaveBeenCalled()
  })

  it('shows evil.com as the real destination host for userinfo-spoofed URLs', async () => {
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null)
    const wrapper = mountMarkdown({ source: '[bank](https://bank.com@evil.com/login)' })
    mountLinkMenu()

    await wrapper.get('[role="button"]').trigger('click')
    await nextTick()
    await nextTick()

    const menu = getOpenMenu()
    const hostLabel = menu.querySelector('p span')
    expect(hostLabel?.textContent).toBe('evil.com')
    expect(menu.textContent).toContain('The site will see your IP address.')

    const [, openButton] = menu.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')
    if (!openButton) throw new Error('Expected Open menu item')
    expect(openButton.hasAttribute('aria-disabled')).toBe(false)

    openButton.click()
    expect(openSpy).toHaveBeenCalledWith(
      'https://bank.com@evil.com/login',
      '_blank',
      'noopener,noreferrer',
    )
  })

  it('shows Image, not loaded and renders only Copy for Markdown images', async () => {
    const wrapper = mountMarkdown({ source: '![beacon](https://evil.com/pixel.png)' })
    mountLinkMenu()

    await wrapper.get('[role="button"]').trigger('keydown', { key: 'Enter' })
    await nextTick()
    await nextTick()

    const menu = getOpenMenu()
    expect(menu.getAttribute('aria-label')).toBe('Image link')
    expect(menu.textContent).toContain('Image, not loaded')
    expect(menu.textContent).toContain('https://evil.com/pixel.png')

    const items = [...menu.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')]
    expect(items).toHaveLength(1)
    expect(items[0]?.textContent).toContain('Copy link')
    expect(menu.textContent).not.toContain('Open in a new tab')
  })
})
