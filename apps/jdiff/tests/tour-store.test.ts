import { describe, expect, it } from 'vitest'
import { loadTour, loadTourVariants, parseVariantParam, saveTour } from '../server/utils/tourStore'
import { loadChains, saveChains } from '../server/utils/chainsStore'
import { loadHunt, saveHunt, walkableIssues } from '../server/utils/huntStore'

let n = 0
const freshTarget = () => `t-${++n}`
const REPO = '/tmp/repo-tours'

const tour = (label: string) => ({ overview: label, stops: [{ path: 'a.ts', side: 'RIGHT' as const, line: 1, endLine: 1, title: label, note: '' }] })
const saved = (number: string, variant?: any, label = 'x') => ({
  repo: REPO, number, ...(variant ? { variant } : {}), tour: tour(label), createdAt: new Date().toISOString(),
})

describe('tour store variants', () => {
  it('keys tours by (repo, target, variant) — variants coexist', () => {
    const key = freshTarget()
    saveTour(saved(key, undefined, 'overview'))
    saveTour(saved(key, 'detail', 'detail'))
    saveTour(saved(key, 'chain:a', 'chain'))
    saveTour(saved(key, 'issue:a', 'issue'))
    expect(loadTour(REPO, key)?.tour.overview).toBe('overview')
    expect(loadTour(REPO, key, 'detail')?.tour.overview).toBe('detail')
    expect(loadTour(REPO, key, 'chain:a')?.tour.overview).toBe('chain')
    expect(loadTour(REPO, key, 'issue:a')?.tour.overview).toBe('issue')
    expect(loadTourVariants(REPO, key).map((v) => v.variant).sort())
      .toEqual(['chain:a', 'detail', 'issue:a', 'overview'])
  })

  it('treats a legacy variant-less row as overview', () => {
    const key = freshTarget()
    saveTour(saved(key, undefined, 'legacy'))
    expect(loadTour(REPO, key, 'overview')?.tour.overview).toBe('legacy')
  })

  it('a variant save replaces only its own variant', () => {
    const key = freshTarget()
    saveTour(saved(key, undefined, 'ov-1'))
    saveTour(saved(key, 'detail', 'dt-1'))
    saveTour(saved(key, undefined, 'ov-2'))
    expect(loadTour(REPO, key)?.tour.overview).toBe('ov-2')
    expect(loadTour(REPO, key, 'detail')?.tour.overview).toBe('dt-1')
  })
})

describe('chains store', () => {
  const manifest = (number: string) => ({
    repo: REPO,
    number,
    overview: 'md',
    chains: [{ id: 'a', title: 'A', summary: '', seedPaths: [] }],
    createdAt: new Date().toISOString(),
  })

  it('saves latest-only per target', () => {
    const key = freshTarget()
    saveChains(manifest(key))
    saveChains({ ...manifest(key), overview: 'second' })
    expect(loadChains(REPO, key)?.overview).toBe('second')
  })

  it('a new manifest deletes the old chain tours but not the others', () => {
    const key = freshTarget()
    saveTour(saved(key, undefined, 'overview'))
    saveTour(saved(key, 'detail', 'detail'))
    saveTour(saved(key, 'chain:a', 'chain-a'))
    saveChains(manifest(key))
    expect(loadTour(REPO, key, 'chain:a')).toBeNull()
    expect(loadTour(REPO, key)?.tour.overview).toBe('overview')
    expect(loadTour(REPO, key, 'detail')?.tour.overview).toBe('detail')
  })
})

describe('hunt store', () => {
  const manifest = (number: string) => ({
    repo: REPO,
    number,
    overview: 'md',
    issues: [
      { id: 'a', severity: 'high' as const, kind: 'bug' as const, title: 'A', summary: '', path: 'a.ts', line: 1, seedPaths: [] },
      { id: 'b', severity: 'low' as const, kind: 'bug' as const, title: 'B', summary: '', path: 'b.ts', line: null, seedPaths: [] },
    ],
    createdAt: new Date().toISOString(),
  })

  it('saves latest-only per target', () => {
    const key = freshTarget()
    saveHunt(manifest(key))
    saveHunt({ ...manifest(key), overview: 'second' })
    expect(loadHunt(REPO, key)?.overview).toBe('second')
  })

  it('only high-severity issues get walked', () => {
    expect(walkableIssues(manifest('x').issues).map((i) => i.id)).toEqual(['a'])
  })

  it('a new hunt deletes the old issue tours but not the chain or detail ones', () => {
    const key = freshTarget()
    saveTour(saved(key, 'detail', 'detail'))
    saveTour(saved(key, 'chain:a', 'chain-a'))
    saveTour(saved(key, 'issue:a', 'issue-a'))
    saveHunt(manifest(key))
    expect(loadTour(REPO, key, 'issue:a')).toBeNull()
    expect(loadTour(REPO, key, 'chain:a')?.tour.overview).toBe('chain-a')
    expect(loadTour(REPO, key, 'detail')?.tour.overview).toBe('detail')
  })
})

describe('variant params', () => {
  it('accepts the four shapes and rejects anything else', () => {
    expect(parseVariantParam(undefined)).toBe('overview')
    expect(parseVariantParam('overview')).toBe('overview')
    expect(parseVariantParam('detail')).toBe('detail')
    expect(parseVariantParam('chain:a-b')).toBe('chain:a-b')
    expect(parseVariantParam('issue:a-b')).toBe('issue:a-b')
    expect(() => parseVariantParam('chain:Bad Slug')).toThrow()
    expect(() => parseVariantParam('chain:')).toThrow()
    expect(() => parseVariantParam('issue:')).toThrow()
    expect(() => parseVariantParam('bogus')).toThrow()
  })
})
