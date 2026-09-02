import { describe, expect, it } from 'vitest'
import {
  MAX_CHAINS,
  MAX_DETAIL_STOPS,
  MAX_ISSUES,
  MAX_TOUR_STOPS,
  cleanChains,
  cleanHunt,
  cleanTour,
  parseTourVariant,
} from '../server/utils/aiArtifacts'

const stop = (line: number, side: 'LEFT' | 'RIGHT' = 'RIGHT') => ({
  path: 'a.ts', side, line, endLine: line, title: 't', note: 'n',
})

const tour = (count: number) => ({
  overview: 'md',
  stops: Array.from({ length: count }, (_, i) => stop(i + 1)),
})

describe('cleanTour', () => {
  it('caps stops per variant', () => {
    expect(cleanTour(tour(50)).stops).toHaveLength(MAX_TOUR_STOPS)
    expect(cleanTour(tour(50), 'detail').stops).toHaveLength(MAX_DETAIL_STOPS)
    expect(cleanTour(tour(50), 'chain:x').stops).toHaveLength(MAX_TOUR_STOPS)
  })

  it('keeps LEFT stops for overview and detail, coerces chains to RIGHT', () => {
    const t = { overview: 'md', stops: [stop(3, 'LEFT')] }
    expect(cleanTour(t).stops[0]!.side).toBe('LEFT')
    expect(cleanTour(t, 'detail').stops[0]!.side).toBe('LEFT')
    expect(cleanTour(t, 'chain:x').stops[0]!.side).toBe('RIGHT')
    expect(cleanTour(t, 'issue:x').stops[0]!.side).toBe('RIGHT')
  })

  it('rejects empty stops and missing overview', () => {
    expect(() => cleanTour({ overview: 'md', stops: [] })).toThrow()
    expect(() => cleanTour({ stops: [stop(1)] })).toThrow()
  })
})

describe('cleanChains', () => {
  const chain = (id: string) => ({ id, title: `T ${id}`, summary: 's', seedPaths: ['a.ts'] })

  it('accepts a valid manifest and caps at MAX_CHAINS', () => {
    const parsed = cleanChains({
      overview: 'md',
      chains: Array.from({ length: 12 }, (_, i) => chain(`c-${i}`)),
    })
    expect(parsed.chains).toHaveLength(MAX_CHAINS)
    expect(parsed.overview).toBe('md')
  })

  it('rejects bad slugs', () => {
    for (const id of ['Upper', 'has space', 'ends;semi', '9starts-digit', 'a'.repeat(41)]) {
      expect(() => cleanChains({ chains: [chain(id)] })).toThrow()
    }
    expect(() => cleanChains({ chains: [chain('ok-slug-9')] })).not.toThrow()
  })

  it('rejects duplicate ids and empty manifests', () => {
    expect(() => cleanChains({ chains: [chain('a'), chain('a')] })).toThrow()
    expect(() => cleanChains({ chains: [] })).toThrow()
  })

  it('caps seedPaths at 10 and drops non-strings', () => {
    const c = cleanChains({
      chains: [{ ...chain('a'), seedPaths: [...Array.from({ length: 15 }, (_, i) => `f${i}.ts`), 42] }],
    })
    expect(c.chains[0]!.seedPaths).toHaveLength(10)
  })
})

describe('cleanHunt', () => {
  const issue = (id: string, severity = 'high') => ({
    id, severity, kind: 'bug', title: `T ${id}`, summary: 's', path: 'a.ts', line: 4, seedPaths: ['a.ts'],
  })

  it('accepts a manifest, orders by severity and caps at MAX_ISSUES', () => {
    const parsed = cleanHunt({
      overview: 'md',
      issues: [issue('low-one', 'low'), issue('hi-one'), issue('mid-one', 'medium')],
    })
    expect(parsed.issues.map((i) => i.id)).toEqual(['hi-one', 'mid-one', 'low-one'])
    expect(parsed.overview).toBe('md')
    expect(cleanHunt({
      issues: Array.from({ length: 20 }, (_, i) => issue(`i-${i}`)),
    }).issues).toHaveLength(MAX_ISSUES)
  })

  it('an empty hunt is a valid result, unlike an empty chains manifest', () => {
    expect(cleanHunt({ overview: 'clean', issues: [] }).issues).toEqual([])
    expect(() => cleanHunt({ overview: 'clean' })).toThrow()
  })

  it('rejects bad slugs and duplicates', () => {
    expect(() => cleanHunt({ issues: [issue('Upper')] })).toThrow()
    expect(() => cleanHunt({ issues: [issue('a'), issue('a')] })).toThrow()
  })

  it('drops issues missing a severity, title or path, and defaults kind', () => {
    const parsed = cleanHunt({
      issues: [
        { ...issue('keep'), kind: 'nonsense' },
        { ...issue('no-sev'), severity: 'critical' },
        { ...issue('no-path'), path: '' },
      ],
    })
    expect(parsed.issues.map((i) => i.id)).toEqual(['keep'])
    expect(parsed.issues[0]!.kind).toBe('bug')
  })
})

describe('parseTourVariant', () => {
  const known = new Set(['chain:known', 'issue:leaky'])

  it('defaults to overview', () => {
    expect(parseTourVariant(undefined, known)).toBe('overview')
    expect(parseTourVariant('overview', known)).toBe('overview')
  })

  it('accepts detail and manifest-backed chain and issue variants', () => {
    expect(parseTourVariant('detail', known)).toBe('detail')
    expect(parseTourVariant('chain:known', known)).toBe('chain:known')
    expect(parseTourVariant('issue:leaky', known)).toBe('issue:leaky')
  })

  it('rejects variants no manifest defines, and junk', () => {
    expect(() => parseTourVariant('chain:unknown', known)).toThrow()
    expect(() => parseTourVariant('issue:unknown', known)).toThrow()
    expect(() => parseTourVariant('chain:Bad Slug', known)).toThrow()
    expect(() => parseTourVariant('other', known)).toThrow()
  })
})
