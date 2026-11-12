import { describe, expect, it } from 'vitest'
import { coercePrReview, isReviewProject, prReviewDone, prReviewRunState, prReviewVerdict, reviewerCount, reviewNeedsPr, settleRun } from '../app/utils/prReview'

const T0 = '2026-11-11T10:00:00.000Z'
const T1 = '2026-11-11T10:30:00.000Z'
const pr = ({ pr: info, ...rest }: Record<string, any> = {}) =>
  coercePrReview({ pr: { number: 12, title: 'Add a thing', author: 'someone', state: 'OPEN', ...info }, ...rest })!
const record = (n: number, status: string, verdict?: string) => ({ n, status, headSha: 'abc', reviewKey: `R-${n}`, ...(verdict ? { verdict } : {}), startedAt: T0, endedAt: status === 'running' ? '' : T0 })

describe('isReviewProject', () => {
  it('is only the prreview mode', () => {
    expect(isReviewProject({ mode: 'prreview' })).toBe(true)
    expect(isReviewProject({ mode: 'standard' })).toBe(false)
    expect(isReviewProject(null)).toBe(false)
  })
})

describe('reviewerCount', () => {
  it('defaults to 3 and takes 2 to 4 — an agreement needs two to agree', () => {
    expect(reviewerCount(undefined)).toBe(3)
    expect(reviewerCount(null)).toBe(3)
    expect([2, 3, 4].map(reviewerCount)).toEqual([2, 3, 4])
    expect([1, 5, 2.5, 'many'].map(reviewerCount)).toEqual([null, null, null, null])
  })
})

describe('reviewNeedsPr', () => {
  it('is a review project whose pull request has not been picked yet', () => {
    expect(reviewNeedsPr({ mode: 'prreview', prReview: null })).toBe(true)
    expect(reviewNeedsPr({ mode: 'prreview' })).toBe(true)
    expect(reviewNeedsPr({ mode: 'prreview', prReview: pr() })).toBe(false)
  })

  it('is never another type of project, which has no prReview either', () => {
    expect(reviewNeedsPr({ mode: 'standard', prReview: null })).toBe(false)
    expect(reviewNeedsPr(null)).toBe(false)
  })

  it('is active on the Reviews board until a PR is attached — never done', () => {
    expect(prReviewDone(null)).toBe(false)
    expect(prReviewRunState(null)).toBe('idle')
  })
})

describe('prReviewDone', () => {
  it('is done when the PR is merged or closed, whatever the reviews say', () => {
    expect(prReviewDone(pr({ pr: { state: 'MERGED' } }))).toBe(true)
    expect(prReviewDone(pr({ pr: { state: 'CLOSED' }, runs: [record(1, 'running')] }))).toBe(true)
  })

  it('is done when an open PR\'s last review came back', () => {
    expect(prReviewDone(pr({ runs: [record(1, 'done', 'approve')] }))).toBe(true)
  })

  it('is not done before any review, after a stopped one, or while a rerun is out', () => {
    expect(prReviewDone(pr())).toBe(false)
    expect(prReviewDone(pr({ runs: [record(1, 'done'), record(2, 'stopped')] }))).toBe(false)
    expect(prReviewDone(pr({ runs: [record(1, 'done'), record(2, 'running')] }))).toBe(false)
  })

  it('ignores ticket counts — it never sees tickets', () => {
    expect(prReviewDone(null)).toBe(false)
  })
})

describe('prReviewRunState / prReviewVerdict', () => {
  it('is running while the last review is out', () => {
    expect(prReviewRunState(pr({ runs: [record(1, 'done'), record(2, 'running')] }))).toBe('running')
    expect(prReviewRunState(pr({ runs: [record(1, 'done')] }))).toBe('idle')
    expect(prReviewRunState(pr())).toBe('idle')
  })

  it('takes the verdict of the last review that came back with one', () => {
    expect(prReviewVerdict(pr({ runs: [record(1, 'done', 'request-changes'), record(2, 'done', 'approve'), record(3, 'stopped')] }))).toBe('approve')
    expect(prReviewVerdict(pr())).toBe('')
  })
})

describe('settleRun', () => {
  const runs = pr({ runs: [record(1, 'done', 'request-changes'), record(2, 'running')] }).runs

  it('marks the review that came back done, with its verdict', () => {
    const next = settleRun(runs, 'R-2', 'done', T1, 'approve')
    expect(next[1]).toMatchObject({ status: 'done', verdict: 'approve', endedAt: T1 })
    expect(next[0]).toBe(runs[0])
  })

  it('takes a re-POST\'s new verdict, and keeps when the review first ended', () => {
    expect(settleRun(runs, 'R-1', 'done', T1, 'approve')[0]).toMatchObject({ status: 'done', verdict: 'approve', endedAt: T0 })
    expect(settleRun(runs, 'R-1', 'done', T1)[0]!.verdict).toBeUndefined()
  })

  it('stops only a review that is still out', () => {
    expect(settleRun(runs, 'R-2', 'stopped', T1)[1]).toMatchObject({ status: 'stopped', endedAt: T1 })
    expect(settleRun(runs, 'R-1', 'stopped', T1)).toBe(runs)
  })

  it('leaves the runs alone for a review no run started', () => {
    expect(settleRun(runs, 'R-9', 'done', T1, 'approve')).toBe(runs)
  })
})

describe('coercePrReview — records from when a review plan ran the review', () => {
  it('drops the assessment and the plan, and keeps the finished runs', () => {
    const r = pr({ assessment: { reviewers: 3, briefDoc: 'DOC-1' }, assessing: null, plan: { steps: [] }, runs: [record(1, 'done', 'approve')] })
    expect(Object.keys(r).sort()).toEqual(['pr', 'runs'])
    expect(r.runs).toHaveLength(1)
  })

  it('carries a run whose review had started on as a running review', () => {
    const r = pr({ runs: [record(1, 'done')], run: { n: 2, status: 'paused', headSha: 'def', reviewKey: 'R-2', startedAt: T0, plan: { steps: [] } } })
    expect(r.runs.map((x) => [x.n, x.status, x.reviewKey])).toEqual([[1, 'done', 'R-1'], [2, 'running', 'R-2']])
    expect(prReviewRunState(r)).toBe('running')
  })

  it('lets go of a run that was still on its checks, and reads an old paused record as stopped', () => {
    expect(pr({ run: { n: 1, status: 'running', reviewKey: '', plan: { steps: [] } } }).runs).toEqual([])
    expect(pr({ runs: [record(1, 'paused')] }).runs[0]!.status).toBe('stopped')
  })
})
