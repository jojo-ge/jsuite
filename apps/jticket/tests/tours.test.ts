// Guided tours on the Diff tab (TICK-948): the tour store and artifact
// validation carried over from jDiff (its tests/tour-store.test.ts and the
// cleanTour cases of tests/ai-artifacts.test.ts), plus jTicket's own pieces —
// target → store key, the build-job registry and failures, the hand-back, and
// the gap a stop on hidden context expands.
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { appDataDir } from '@jsuite/data'
import { describe, expect, it } from 'vitest'
import { diffGaps, gapForLine } from '../app/utils/diffGaps'
import { stopFromQuery, tourKeyFor } from '../app/utils/tour'
import { cleanTour, MAX_DETAIL_STOPS } from '../server/utils/tourArtifact'
import { clearTourJob, getTourJob, recordTourFailure, registerTourJob, tourFailure, TOUR_STALE_MS } from '../server/utils/tourJobs'
import { loadTour, saveTour } from '../server/utils/tourStore'
import { completeTour, saveTourArtifact, tourPrompt, tourView, type TourContext } from '../server/utils/tours'

;(globalThis as any).createError ??= (o: { statusCode: number; statusMessage: string }) =>
  Object.assign(new Error(o.statusMessage), o)

let n = 0
const freshTarget = () => `t-${++n}`
const REPO = '/tmp/repo-tours'

const tour = (label: string) => ({ overview: label, stops: [{ path: 'a.ts', side: 'RIGHT' as const, line: 1, endLine: 1, title: label, note: '' }] })
const saved = (number: string, variant?: any, label = 'x') => ({
  repo: REPO, number, ...(variant ? { variant } : {}), tour: tour(label), createdAt: new Date().toISOString(),
})

describe('tour store (jDiff’s .data/jdiff/tours.json)', () => {
  it('keys tours by (repo, target, variant) — variants coexist', () => {
    const key = freshTarget()
    saveTour(saved(key, undefined, 'overview'))
    saveTour(saved(key, 'detail', 'detail'))
    saveTour(saved(key, 'chain:a', 'chain'))
    expect(loadTour(REPO, key, 'overview')?.tour.overview).toBe('overview')
    expect(loadTour(REPO, key, 'detail')?.tour.overview).toBe('detail')
    expect(loadTour(REPO, key, 'chain:a')?.tour.overview).toBe('chain')
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
    expect(loadTour(REPO, key, 'overview')?.tour.overview).toBe('ov-2')
    expect(loadTour(REPO, key, 'detail')?.tour.overview).toBe('dt-1')
  })

  it('the Diff tab walks only the detail tour — never an overview or chain tour jDiff left (TICK-975)', () => {
    const key = freshTarget()
    const view = () => tourView({ repoDir: REPO, key, project: { key: 'PROJ-1' }, target: {} } as unknown as TourContext)
    saveTour(saved(key, 'chain:a', 'chain'))
    saveTour(saved(key, undefined, 'legacy overview'))
    saveTour(saved(key, 'overview', 'overview'))
    expect(view().tour).toBeNull()
    expect(view()).not.toHaveProperty('variant')
    saveTour(saved(key, 'detail', 'detail'))
    expect(view().tour?.overview).toBe('detail')
  })

  it('writes jDiff’s file, in jDiff’s row shape', () => {
    const key = freshTarget()
    saveTour(saved(key, 'detail', 'on disk'))
    const rows = JSON.parse(readFileSync(join(appDataDir('jdiff'), 'tours.json'), 'utf8'))
    expect(rows.find((r: any) => r.number === key)).toMatchObject({ repo: REPO, number: key, variant: 'detail', tour: { overview: 'on disk' } })
  })
})

const stop = (line: number, side: 'LEFT' | 'RIGHT' = 'RIGHT') => ({ path: 'a.ts', side, line, endLine: line, title: 't', note: 'n' })
const many = (count: number) => ({ overview: 'md', stops: Array.from({ length: count }, (_, i) => stop(i + 1)) })

describe('cleanTour (detail tours)', () => {
  it('caps stops at the detail limit', () => {
    expect(cleanTour(many(50)).stops).toHaveLength(MAX_DETAIL_STOPS)
  })

  it('keeps LEFT stops; anything else reads as RIGHT', () => {
    expect(cleanTour({ overview: 'md', stops: [stop(3, 'LEFT')] }).stops[0]!.side).toBe('LEFT')
    expect(cleanTour({ overview: 'md', stops: [{ ...stop(3), side: 'up' }] }).stops[0]!.side).toBe('RIGHT')
  })

  it('drops stops without a path or a positive integer line, and repairs endLine', () => {
    const t = cleanTour({ overview: 'md', stops: [{ line: 2 }, { path: 'a', line: 0 }, { path: 'a', line: 1.5 }, { path: 'b.ts', line: 9, endLine: 3 }] })
    expect(t.stops).toEqual([{ path: 'b.ts', side: 'RIGHT', line: 9, endLine: 9, title: '', note: '' }])
  })

  it('rejects empty stops and a missing overview', () => {
    expect(() => cleanTour({ overview: 'md', stops: [] })).toThrow()
    expect(() => cleanTour({ stops: [stop(1)] })).toThrow()
  })
})

describe('tourKeyFor — jDiff’s keys, so its tours load here', () => {
  const project = { mode: 'standard', integrationBranch: 'one-jticket' }
  it('maps each Diff tab target', () => {
    expect(tourKeyFor({ gh: 123 }, project)).toBe('123')
    expect(tourKeyFor({ head: 'feature-x', base: 'main' } as any, project)).toBe('branch/feature-x')
    expect(tourKeyFor({}, project)).toBe('branch/one-jticket')
    expect(tourKeyFor({ pr: 'pr_abc' }, project, 'PR-7')).toBe('PR-7')
  })
  it('a PR review project’s own branch is its GitHub PR', () => {
    expect(tourKeyFor({}, { mode: 'prreview', integrationBranch: 'jreview/pr-42', prReview: { pr: { number: 42 } } })).toBe('42')
  })
  it('nothing to key by → null', () => {
    expect(tourKeyFor({}, { integrationBranch: '  ' })).toBeNull()
    expect(tourKeyFor({ pr: 'PR-9' }, project)).toBeNull()
  })
})

describe('stopFromQuery', () => {
  it('reads ?stop=i', () => {
    expect(stopFromQuery('3')).toBe(3)
    expect(stopFromQuery(['0'])).toBe(0)
    expect(stopFromQuery('-1')).toBeNull()
    expect(stopFromQuery('x')).toBeNull()
    expect(stopFromQuery(undefined)).toBeNull()
  })
})

describe('build-tour jobs and failures', () => {
  it('tracks one run per target and clears the last failure when a new one starts', () => {
    const key = freshTarget()
    recordTourFailure(REPO, key, 'boom')
    expect(tourFailure(REPO, key)).toBe('boom')
    registerTourJob({ repo: REPO, key, startedAt: Date.now(), agent: 'a', tabId: 't' })
    expect(tourFailure(REPO, key)).toBe('')
    expect(getTourJob(REPO, key)?.agent).toBe('a')
    expect(clearTourJob(REPO, key)?.agent).toBe('a')
    expect(getTourJob(REPO, key)).toBeNull()
  })

  it('a run silent past the stale window is dropped with a reason', () => {
    const key = freshTarget()
    registerTourJob({ repo: REPO, key, startedAt: Date.now() - TOUR_STALE_MS - 1, agent: 'gone', tabId: 't' })
    expect(getTourJob(REPO, key)).toBeNull()
    expect(tourFailure(REPO, key)).toMatch(/never reported back/)
  })

  it('keeps jDiff’s other failures for the same target', () => {
    const key = freshTarget()
    const file = join(appDataDir('jdiff'), 'failures.json')
    recordTourFailure(REPO, key, 'tour broke')
    const rows = JSON.parse(readFileSync(file, 'utf8'))
    rows.find((r: any) => r.number === key).failures.push({ jobKind: 'analyze', message: 'old', at: '' })
    writeFileSync(file, JSON.stringify(rows))
    registerTourJob({ repo: REPO, key, startedAt: Date.now(), agent: 'a', tabId: 't' })
    const after = JSON.parse(readFileSync(file, 'utf8')).find((r: any) => r.number === key)
    expect(after.failures.map((f: any) => f.jobKind)).toEqual(['analyze'])
    clearTourJob(REPO, key)
  })
})

describe('the session’s hand-back', () => {
  const ctx = (key: string) => ({ repoDir: REPO, key, project: { key: 'PROJ-1' }, target: {} }) as unknown as TourContext

  it('saves the artifact as the target’s detail tour and settles the run', () => {
    const key = freshTarget()
    registerTourJob({ repo: REPO, key, startedAt: Date.now(), agent: 'a', tabId: 't' })
    expect(saveTourArtifact(ctx(key), many(3))).toMatchObject({ saved: 'tour', key, stops: 3 })
    expect(loadTour(REPO, key, 'detail')?.tour.stops).toHaveLength(3)
    expect(getTourJob(REPO, key)).toBeNull()
  })

  it('a bad artifact saves nothing and leaves the run live', () => {
    const key = freshTarget()
    registerTourJob({ repo: REPO, key, startedAt: Date.now(), agent: 'a', tabId: 't' })
    expect(() => saveTourArtifact(ctx(key), { overview: 'md', stops: [] })).toThrow()
    expect(() => saveTourArtifact(ctx(key), undefined)).toThrow()
    expect(loadTour(REPO, key, 'detail')).toBeNull()
    expect(getTourJob(REPO, key)).not.toBeNull()
    clearTourJob(REPO, key)
  })

  it('sign-off records failures and clears the run', () => {
    const key = freshTarget()
    registerTourJob({ repo: REPO, key, startedAt: Date.now(), agent: 'a', tabId: 't' })
    expect(completeTour(ctx(key), [{ message: 'no diff' }, { message: ' ' }])).toEqual({ done: true, wasTracked: true })
    expect(tourFailure(REPO, key)).toBe('no diff')
    expect(completeTour(ctx(key), [])).toEqual({ done: true, wasTracked: false })
  })

  it('the prompt names the project, the target to echo back, and the exact commits', () => {
    expect(tourPrompt('PROJ-81', { pr: 'PR-3' }, 'aaa', 'bbb')).toBe('/jdiff-tour project=PROJ-81 target={"pr":"PR-3"} range=aaa...bbb head=bbb')
    expect(tourPrompt('PROJ-81', {}, 'a', 'b')).toContain('target={}')
  })
})

describe('gapForLine — where a stop on hidden context lives', () => {
  const file = {
    status: 'modified',
    binary: false,
    hunks: [{ header: '@@ -10,3 +10,4 @@' }, { header: '@@ -40,2 +41,2 @@' }],
  }
  const gaps = diffGaps(file)
  it('finds the leading, middle and trailing gaps', () => {
    expect(gapForLine(gaps, 3, null)).toBe(0)
    expect(gapForLine(gaps, 20, null)).toBe(1)
    expect(gapForLine(gaps, 11, null)).toBeNull() // inside the first hunk
    expect(gapForLine(gaps, 99, null)).toBe(2) // trailing gap, size unknown
    expect(gapForLine(gaps, 99, 60)).toBeNull() // past the end of a 60-line file
  })
})
