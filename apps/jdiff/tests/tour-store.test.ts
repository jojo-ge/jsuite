import { describe, expect, it } from 'vitest'
import { loadTour, loadTourVariants, saveTour } from '../server/utils/tourStore'
import { loadChains, saveChains } from '../server/utils/chainsStore'

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
    expect(loadTour(REPO, key)?.tour.overview).toBe('overview')
    expect(loadTour(REPO, key, 'detail')?.tour.overview).toBe('detail')
    expect(loadTour(REPO, key, 'chain:a')?.tour.overview).toBe('chain')
    expect(loadTourVariants(REPO, key).map((v) => v.variant).sort()).toEqual(['chain:a', 'detail', 'overview'])
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
