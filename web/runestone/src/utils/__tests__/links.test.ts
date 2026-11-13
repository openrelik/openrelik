import { describe, expect, it } from 'vitest'

import { linkTarget } from '@/utils/links'

describe('linkTarget', () => {
  describe('openable web URLs', () => {
    it.each([
      {
        label: 'standard https URL with path, query, and hash',
        input: 'https://openrelik.org/folder/42?tab=files#L12-L40',
        href: 'https://openrelik.org/folder/42?tab=files#L12-L40',
        host: 'openrelik.org',
      },
      {
        label: 'http URL with explicit port',
        input: 'http://localhost:8710/api/v1/folders',
        href: 'http://localhost:8710/api/v1/folders',
        host: 'localhost:8710',
      },
      {
        label: 'uppercase scheme and mixed-case host normalized to lowercase',
        input: 'HTTPS://Docs.OpenRelik.ORG/Guide',
        href: 'https://docs.openrelik.org/Guide',
        host: 'docs.openrelik.org',
      },
      {
        label: 'default https port omitted in normalized host',
        input: 'https://example.com:443/report',
        href: 'https://example.com/report',
        host: 'example.com',
      },
      {
        label: 'embedded ASCII tabs and newlines stripped like browsers do',
        input: 'https://exa\tmple.com/pa\nth',
        href: 'https://example.com/path',
        host: 'example.com',
      },
      {
        label: 'IPv6 host with port',
        input: 'http://[::1]:8080/healthz',
        href: 'http://[::1]:8080/healthz',
        host: '[::1]:8080',
      },
    ])('allows $label', ({ input, href, host }) => {
      expect(linkTarget(input)).toEqual({
        openable: true,
        href,
        host,
      })
    })
  })

  describe('blocked non-web schemes', () => {
    it.each([
      ['javascript:alert(1)', 'javascript:'],
      ['JAVASCRIPT:alert(document.cookie)', 'javascript:'],
      ['data:text/html,<script>alert(1)</script>', 'data:'],
      ['data:image/svg+xml;base64,PHN2Zy8+', 'data:'],
      ['file:///etc/passwd', 'file:'],
      ['file://localhost/Users/analyst/evidence.dd', 'file:'],
      ['blob:https://openrelik.org/550e8400-e29b-41d4-a716-446655440000', 'blob:'],
      ['vbscript:msgbox(1)', 'vbscript:'],
      ['mailto:soc@example.com', 'mailto:'],
      ['ftp://files.example.com/dump.raw', 'ftp:'],
    ])('blocks %s with protocol %s', (input, protocol) => {
      expect(linkTarget(input)).toEqual({
        openable: false,
        reason: `Only web links open, not ${protocol}`,
      })
    })
  })

  describe('blocked relative, protocol-relative, and malformed URLs', () => {
    it.each([
      '/foo/bar',
      './local-file.txt',
      '../parent/secret.txt',
      'folder/evidence.log',
      '//evil.com/phish',
      '#L12-L40',
      '?page=2',
      '',
      '   ',
      'https://',
      'http://:80',
    ])('rejects %j as not a web address', (input) => {
      expect(linkTarget(input)).toEqual({
        openable: false,
        reason: 'Not a web address: nothing to open',
      })
    })
  })

  describe('spoofing and phishing indicators', () => {
    it('surfaces punycode xn-- host for IDN homograph domains', () => {
      // Cyrillic small letter 'а' (U+0430) masquerading as Latin 'a'.
      const target = linkTarget('https://\u0430pple.com/login')
      expect(target).toEqual({
        openable: true,
        href: 'https://xn--pple-43d.com/login',
        host: 'xn--pple-43d.com',
      })
    })

    it('surfaces punycode xn-- on homograph subdomains', () => {
      // Cyrillic small letter 'е' (U+0435) in subdomain label.
      const target = linkTarget('https://secure.\u0435xample.com/auth')
      expect(target.openable).toBe(true)
      if (!target.openable) return
      expect(target.host).toMatch(/^secure\.xn--/)
      expect(target.href).toContain(target.host)
    })

    it('surfaces the real destination host when userinfo precedes @', () => {
      expect(linkTarget('https://good.com@evil.com/signin')).toEqual({
        openable: true,
        href: 'https://good.com@evil.com/signin',
        host: 'evil.com',
      })
    })

    it('surfaces the real host and port when userinfo includes a fake port', () => {
      expect(linkTarget('https://good.com:443@evil.com:8443/callback')).toEqual({
        openable: true,
        href: 'https://good.com:443@evil.com:8443/callback',
        host: 'evil.com:8443',
      })
    })
  })
})
