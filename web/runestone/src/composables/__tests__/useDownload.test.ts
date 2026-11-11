// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { downloadFile, downloadFiles } from '@/composables/useDownload'
import { api } from '@/api'

describe('useDownload', () => {
  const clicked: {
    href: string
    download: string
    target: string
    rel: string
    display: string
    inBody: boolean
  }[] = []

  beforeEach(() => {
    clicked.length = 0
    vi.useFakeTimers()
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      clicked.push({
        href: this.getAttribute('href') ?? '',
        download: this.download,
        target: this.target,
        rel: this.rel,
        display: this.style.display,
        inBody: document.body.contains(this),
      })
    })
  })

  afterEach(() => {
    vi.useRealTimers()
    document.body.innerHTML = ''
  })

  it('triggers a hidden _blank anchor download and removes the element', () => {
    downloadFile(42, 'disk.dd')

    expect(clicked).toEqual([
      {
        href: api.files.downloadUrl(42),
        download: 'disk.dd',
        target: '_blank',
        rel: 'noopener',
        display: 'none',
        inBody: true,
      },
    ])
    expect(document.body.querySelectorAll('a')).toHaveLength(0)
  })

  it('omits the download attribute when no filename is passed', () => {
    downloadFile(7)

    expect(clicked).toHaveLength(1)
    expect(clicked[0]?.href).toBe(api.files.downloadUrl(7))
    expect(clicked[0]?.download).toBe('')
  })

  it('staggers multiple downloads by 300ms each', () => {
    downloadFiles([
      { id: 1, name: 'a.log' },
      { id: 2, name: 'b.log' },
      { id: 3, name: 'c.log' },
    ])

    expect(clicked).toHaveLength(0)

    vi.advanceTimersByTime(0)
    expect(clicked.map((entry) => entry.download)).toEqual(['a.log'])

    vi.advanceTimersByTime(299)
    expect(clicked.map((entry) => entry.download)).toEqual(['a.log'])

    vi.advanceTimersByTime(1)
    expect(clicked.map((entry) => entry.download)).toEqual(['a.log', 'b.log'])

    vi.advanceTimersByTime(300)
    expect(clicked.map((entry) => entry.download)).toEqual(['a.log', 'b.log', 'c.log'])
  })
})
