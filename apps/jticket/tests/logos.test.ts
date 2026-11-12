import { describe, expect, it } from 'vitest'
import { DEFAULT_LOGO, LOGO_MARKS, LOGO_ON, LOGO_VIEWBOX, findLogo, logoFavicon } from '../app/utils/logos'

// The marks on /logo: one drawing each, shared by the sidebar, the gallery and
// the tab icon — which only works while a body sticks to the three paints.
describe('logo marks', () => {
  it('offers every group, each mark named once', () => {
    const count = (group: string) => LOGO_MARKS.filter((m) => m.group === group).length
    expect(count('original')).toBe(5)
    expect(count('ticket')).toBe(30)
    expect(count('j')).toBe(86)
    expect(count('more')).toBe(59)
    expect(LOGO_MARKS).toHaveLength(180)
    expect(new Set(LOGO_MARKS.map((m) => m.id)).size).toBe(LOGO_MARKS.length)
    expect(new Set(LOGO_MARKS.map((m) => m.name)).size).toBe(LOGO_MARKS.length)
  })

  it('paints every mark with its main, accent and on colours only', () => {
    const allowed = ['none', 'currentColor', 'var(--logo-accent)', 'var(--logo-on)']
    for (const m of LOGO_MARKS) {
      const paints = [...m.body.matchAll(/(?:fill|stroke|color)="([^"]+)"/g)].map((p) => p[1])
      for (const paint of paints) expect(allowed, `${m.id}: ${paint}`).toContain(paint)
      expect(m.body, m.id).not.toMatch(/<script|on\w+=|href=|NaN|undefined/i)
    }
  })

  it('gives every mark two colours, and never lets a neighbour share its main one', () => {
    for (const m of LOGO_MARKS) {
      expect(m.colors.main, m.id).toMatch(/^#[0-9a-f]{6}$/)
      expect(m.colors.accent, m.id).toMatch(/^#[0-9a-f]{6}$/)
      expect(m.colors.accent, m.id).not.toBe(m.colors.main)
    }
    const dealt = LOGO_MARKS.filter((m) => m.id !== 't-golden')
    for (let i = 1; i < dealt.length; i++) {
      if (LOGO_MARKS.indexOf(dealt[i]!) - LOGO_MARKS.indexOf(dealt[i - 1]!) === 1)
        expect(dealt[i]!.colors.main, dealt[i]!.id).not.toBe(dealt[i - 1]!.colors.main)
    }
  })

  it('falls back to the default mark for an id that names none', () => {
    expect(findLogo('slices').id).toBe('slices')
    expect(findLogo('no-such-mark').id).toBe(DEFAULT_LOGO)
    expect(findLogo(null).id).toBe(DEFAULT_LOGO)
  })

  it('makes a tab icon that is a whole SVG with the mark\'s colours written in', () => {
    const mark = findLogo('j-ticket')
    const uri = logoFavicon(mark)
    expect(uri.startsWith('data:image/svg+xml,')).toBe(true)
    const svg = decodeURIComponent(uri.slice('data:image/svg+xml,'.length))
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"')
    expect(svg).toContain(`viewBox="${LOGO_VIEWBOX}"`)
    expect(svg).toContain(`color:${mark.colors.main}`)
    expect(svg).toContain(`--logo-accent:${mark.colors.accent}`)
    expect(svg).toContain(`--logo-on:${LOGO_ON}`)
    expect(svg).toContain(mark.body)
  })
})
