import { describe, expect, it } from 'vitest'
import { coercePrReview, isReviewProject, prReviewDone, prReviewRunState, prReviewVerdict, reviewOnlyPlan, newReviewRun } from '../app/utils/reviewPlan'

const T0 = '2026-11-11T10:00:00.000Z'
const pr = ({ pr: info, ...rest }: Record<string, any> = {}) =>
  coercePrReview({ pr: { number: 12, title: 'Add a thing', author: 'someone', state: 'OPEN', ...info }, ...rest })!
const record = (n: number, status: string, verdict?: string) => ({ n, status, headSha: 'abc', reviewKey: `R-${n}`, ...(verdict ? { verdict } : {}), startedAt: T0, endedAt: T0 })

describe('isReviewProject', () => {
  it('is only the prreview mode', () => {
    expect(isReviewProject({ mode: 'prreview' })).toBe(true)
    expect(isReviewProject({ mode: 'standard' })).toBe(false)
    expect(isReviewProject(null)).toBe(false)
  })
})

describe('prReviewDone', () => {
  it('is done when the PR is merged or closed, whatever the runs say', () => {
    expect(prReviewDone(pr({ pr: { state: 'MERGED' } }))).toBe(true)
    expect(prReviewDone(pr({ pr: { state: 'CLOSED' }, assessing: { agent: 'a', paneId: 'p', startedAt: T0 } }))).toBe(true)
  })

  it('is done when an open PR\'s last run finished', () => {
    expect(prReviewDone(pr({ runs: [record(1, 'done', 'approve')] }))).toBe(true)
  })

  it('is not done before any run, after a stopped run, or while assessing or rerunning', () => {
    expect(prReviewDone(pr())).toBe(false)
    expect(prReviewDone(pr({ runs: [record(1, 'done'), record(2, 'stopped')] }))).toBe(false)
    expect(prReviewDone(pr({ assessing: { agent: 'a', paneId: 'p', startedAt: T0 } }))).toBe(false)
    const run = newReviewRun(2, reviewOnlyPlan(2), 'abc', T0)
    expect(prReviewDone(pr({ runs: [record(1, 'done')], run }))).toBe(false)
  })

  it('ignores ticket counts — it never sees tickets', () => {
    expect(prReviewDone(null)).toBe(false)
  })
})

describe('prReviewRunState / prReviewVerdict', () => {
  it('reports assessing over a run, and a paused run', () => {
    const run = newReviewRun(1, reviewOnlyPlan(2), 'abc', T0)
    expect(prReviewRunState(pr({ run }))).toBe('running')
    expect(prReviewRunState(pr({ run: { ...run, status: 'paused' } }))).toBe('paused')
    expect(prReviewRunState(pr({ run, assessing: { agent: 'a', paneId: 'p', startedAt: T0 } }))).toBe('assessing')
    expect(prReviewRunState(pr())).toBe('idle')
  })

  it('takes the verdict of the last finished run that had one', () => {
    expect(prReviewVerdict(pr({ runs: [record(1, 'done', 'request-changes'), record(2, 'done', 'approve'), record(3, 'stopped')] }))).toBe('approve')
    expect(prReviewVerdict(pr())).toBe('')
  })
})
