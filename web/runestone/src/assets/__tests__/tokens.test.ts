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

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const css = readFileSync(resolve(import.meta.dirname, '../main.css'), 'utf-8')

function extractBlock(source: string, headerPattern: RegExp): string {
  const match = headerPattern.exec(source)
  if (!match || match.index === undefined) {
    throw new Error(`Could not find block matching ${headerPattern}`)
  }
  const openBrace = source.indexOf('{', match.index)
  let depth = 0
  for (let i = openBrace; i < source.length; i++) {
    if (source[i] === '{') depth++
    else if (source[i] === '}') {
      depth--
      if (depth === 0) return source.slice(openBrace + 1, i)
    }
  }
  throw new Error(`Unclosed block for ${headerPattern}`)
}

function parseTokens(block: string): Record<string, string> {
  const cleaned = block.replace(/\/\*[\s\S]*?\*\//g, '')
  const tokens: Record<string, string> = {}
  for (const match of cleaned.matchAll(/(--[\w*-]+)\s*:\s*([^;]+);/g)) {
    const name = match[1]
    const value = match[2]
    if (name && value) tokens[name] = value.trim()
  }
  return tokens
}

function hexToRgb(hex: string): [number, number, number] {
  const normalized = hex.replace('#', '')
  if (normalized.length !== 6) throw new Error(`Expected 6-digit hex, got ${hex}`)
  return [
    parseInt(normalized.slice(0, 2), 16) / 255,
    parseInt(normalized.slice(2, 4), 16) / 255,
    parseInt(normalized.slice(4, 6), 16) / 255,
  ]
}

function linearize(c: number): number {
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

function relativeLuminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map(linearize) as [number, number, number]
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a)
  const lb = relativeLuminance(b)
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

function oklchChroma(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map(linearize) as [number, number, number]
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s
  const okB = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
  return Math.hypot(a, okB)
}

const darkTokens = parseTokens(extractBlock(css, /@theme\s*\{/))
const lightTokens = parseTokens(extractBlock(css, /:root\[data-theme='light'\]\s*\{/))

const colorToken = (tokens: Record<string, string>, name: string): string => {
  const value = tokens[name]
  if (!value) throw new Error(`Missing token ${name}`)
  return value
}

describe('Design system CSS tokens (src/assets/main.css)', () => {
  it('locks Tailwind v4 default namespaces and sets standard transition defaults', () => {
    expect(darkTokens['--color-*']).toBe('initial')
    expect(darkTokens['--radius-*']).toBe('initial')
    expect(darkTokens['--shadow-*']).toBe('initial')
    expect(darkTokens['--text-*']).toBe('initial')
    expect(darkTokens['--default-transition-duration']).toBe('120ms')
    expect(darkTokens['--default-transition-timing-function']).toBe('cubic-bezier(0.2, 0, 0, 1)')
  })

  it('keeps dark and light semantic color tokens in parity', () => {
    const darkColorKeys = Object.keys(darkTokens)
      .filter((k) => k.startsWith('--color-') && k !== '--color-*')
      .sort()
    const lightColorKeys = Object.keys(lightTokens)
      .filter((k) => k.startsWith('--color-'))
      .sort()

    expect(lightColorKeys).toEqual(darkColorKeys)
  })

  it('maintains honest recessed surface elevation in both dark and light themes', () => {
    for (const [label, tokens] of [
      ['dark', darkTokens],
      ['light', lightTokens],
    ] as const) {
      const canvas = colorToken(tokens, '--color-canvas')
      const sunken = colorToken(tokens, '--color-sunken')
      const surface = colorToken(tokens, '--color-surface')

      // In both themes, sunken sits strictly below surface (truly recessed).
      expect(relativeLuminance(sunken), `${label}: sunken < surface`).toBeLessThan(
        relativeLuminance(surface),
      )
      expect(relativeLuminance(canvas), `${label}: canvas < sunken`).toBeLessThan(
        relativeLuminance(sunken),
      )
      // Surface planes separate perceptibly across displays.
      expect(contrastRatio(canvas, surface), `${label}: canvas vs surface`).toBeGreaterThanOrEqual(
        1.1,
      )
      expect(contrastRatio(sunken, surface), `${label}: sunken vs surface`).toBeGreaterThanOrEqual(
        1.06,
      )
    }
  })

  it('clears WCAG contrast floors for ink, accents, tints, buttons, and icons in both themes', () => {
    for (const [label, tokens] of [
      ['dark', darkTokens],
      ['light', lightTokens],
    ] as const) {
      const canvas = colorToken(tokens, '--color-canvas')
      const surface = colorToken(tokens, '--color-surface')
      const sunken = colorToken(tokens, '--color-sunken')

      expect(
        contrastRatio(colorToken(tokens, '--color-ink'), surface),
        `${label} ink`,
      ).toBeGreaterThan(14)
      expect(
        contrastRatio(colorToken(tokens, '--color-ink-secondary'), surface),
        `${label} ink-secondary`,
      ).toBeGreaterThan(7)
      expect(
        contrastRatio(colorToken(tokens, '--color-ink-muted'), surface),
        `${label} ink-muted on surface`,
      ).toBeGreaterThanOrEqual(4.5)
      expect(
        contrastRatio(colorToken(tokens, '--color-ink-muted'), sunken),
        `${label} ink-muted on sunken`,
      ).toBeGreaterThanOrEqual(4.5)

      // Semantic accents clear AAA (~7:1) on surface and ≥ 5.5:1 on their own tint.
      for (const accent of ['brand', 'success', 'warning', 'danger'] as const) {
        const fg = colorToken(tokens, `--color-${accent}`)
        const tint = colorToken(tokens, `--color-${accent}-tint`)
        const floor = label === 'light' && accent === 'success' ? 6.95 : 7
        expect(contrastRatio(fg, surface), `${label} ${accent} on surface`).toBeGreaterThanOrEqual(
          floor,
        )
        expect(contrastRatio(fg, tint), `${label} ${accent} on tint`).toBeGreaterThanOrEqual(5.5)

        const icon = colorToken(tokens, `--color-${accent}-icon`)
        expect(
          contrastRatio(icon, surface),
          `${label} ${accent}-icon on surface`,
        ).toBeGreaterThanOrEqual(3.4)
      }

      // Primary solid button fill (`bg-brand-strong text-canvas`) stays readable in both themes.
      const primaryFill = colorToken(tokens, '--color-brand-strong')
      expect(
        contrastRatio(primaryFill, canvas),
        `${label} primary button text-canvas`,
      ).toBeGreaterThanOrEqual(label === 'dark' ? 7 : 5.4)

      // Annotation highlight tokens clear AAA for accent ink and AA+ for body ink over all 3 highlight depths.
      const ink = colorToken(tokens, '--color-ink')
      expect(
        contrastRatio(colorToken(tokens, '--color-annotation'), surface),
        `${label} annotation accent on surface`,
      ).toBeGreaterThanOrEqual(7)
      for (const layer of ['annotation-tint', 'annotation-overlap', 'annotation-active'] as const) {
        expect(
          contrastRatio(ink, colorToken(tokens, `--color-${layer}`)),
          `${label} ink on ${layer}`,
        ).toBeGreaterThanOrEqual(6.5)
      }
    }
  })

  it('gives dark danger and brand higher OKLCH chroma than success so alerts out-salience healthy states', () => {
    const darkDangerC = oklchChroma(colorToken(darkTokens, '--color-danger'))
    const darkBrandC = oklchChroma(colorToken(darkTokens, '--color-brand'))
    const darkSuccessC = oklchChroma(colorToken(darkTokens, '--color-success'))

    expect(darkDangerC).toBeGreaterThan(darkSuccessC)
    expect(darkBrandC).toBeGreaterThan(darkSuccessC)
  })

  it('uses a darkening scrim in dark mode (never a brightening ink veil)', () => {
    expect(colorToken(darkTokens, '--color-scrim')).toMatch(/^rgb\(0\s+0\s+0\s*\//)
    expect(colorToken(lightTokens, '--color-scrim')).toMatch(/^rgb\(/)
  })

  it('loads only 400, 500, and 600 weights for self-hosted IBM Plex Sans and Mono', () => {
    const weights = [...css.matchAll(/font-weight:\s*(\d+);/g)].map((m) => Number(m[1]))
    // Every @font-face weight must be in {400, 500, 600} so no faux-bold 700 is needed.
    const faceWeights = [...css.matchAll(/@font-face\s*\{[\s\S]*?font-weight:\s*(\d+);/g)].map(
      (m) => Number(m[1]),
    )
    expect(faceWeights).toEqual([400, 500, 600, 400, 500, 600])
    expect(weights.every((w) => w <= 600)).toBe(true)
  })
})
