import { describe, expect, it } from 'vitest'
import {
  advanceReviewRun,
  coercePrReview,
  coerceReviewPlan,
  newReviewRun,
  planChecks,
  retryReviewRun,
  reviewOnlyPlan,
  reviewPlanProblems,
  reviewRunStep,
  CHECK_SESSIONS_MAX,
  CHECK_STALL_MS,
  type ReviewRunWorld,
} from '../app/utils/reviewPlan'

const T0 = '2026-11-11T10:00:00.000Z'
const at = (ms: number) => Date.parse(T0) + ms
const check = (key: string, status = 'todo') => ({ key, status, labels: ['afk', 'pr:check'] })
const world = (patch: Partial<ReviewRunWorld> = {}): ReviewRunWorld => ({ now: at(1000), tickets: [], review: null, ...patch })

describe('coerceReviewPlan', () => {
  it('clamps reviewers to 2…4 and defaults verify on', () => {
    const plan = coerceReviewPlan({ steps: [{ id: 'r1', kind: 'review', reviewers: 9 }, { id: 'r2', kind: 'review', reviewers: 1, verify: false }] })!
    expect(plan.steps.map((s) => s.reviewers)).toEqual([4, 2])
    expect(plan.steps.map((s) => s.verify)).toEqual([true, false])
  })

  it('drops unknown kinds, dedupes tickets and mints ids for clashing ones', () => {
    const plan = coerceReviewPlan({ steps: [{ id: 'x', kind: 'merge' }, { id: 'a', kind: 'checks', tickets: ['T-1', 'T-1', 'nope', 3] }, { id: 'a', kind: 'review' }] })!
    expect(plan.steps.map((s) => s.kind)).toEqual(['checks', 'review'])
    expect(plan.steps[0]!.tickets).toEqual(['T-1'])
    expect(new Set(plan.steps.map((s) => s.id)).size).toBe(2)
  })

  it('keeps runners only for the step\'s own tickets', () => {
    const plan = coerceReviewPlan({ steps: [{ kind: 'checks', tickets: ['T-1'], runners: { 'T-1': { model: 'sonnet', effort: 'low' }, 'T-9': { model: 'opus' } } }, { kind: 'review' }] })!
    expect(plan.steps[0]!.runners).toEqual({ 'T-1': { model: 'sonnet', effort: 'low' } })
  })
})

describe('reviewPlanProblems', () => {
  it('a review-only plan is runnable', () => {
    expect(reviewPlanProblems(reviewOnlyPlan(3), [])).toEqual([])
  })

  it('needs exactly one review step, and it is last', () => {
    expect(reviewPlanProblems(coerceReviewPlan({ steps: [] })!, [])[0]!.message).toMatch(/no review step/)
    const backwards = coerceReviewPlan({ steps: [{ kind: 'review' }, { kind: 'gate' }] })!
    expect(reviewPlanProblems(backwards, []).map((p) => p.message).join()).toMatch(/last step/)
  })

  it('checks must be the project\'s check tickets, each once', () => {
    const plan = coerceReviewPlan({ steps: [{ kind: 'checks', tickets: ['T-1', 'T-2', 'T-3'] }, { kind: 'checks', tickets: ['T-1'] }, { kind: 'review' }] })!
    const msgs = reviewPlanProblems(plan, [check('T-1'), { key: 'T-2', status: 'todo', labels: ['afk'] }]).map((p) => p.message)
    expect(msgs.some((m) => m.includes('T-2 is not a check ticket'))).toBe(true)
    expect(msgs.some((m) => m.includes('T-3 is not one of'))).toBe(true)
    expect(msgs.some((m) => m.includes('T-1 is in the plan twice'))).toBe(true)
  })

  it('planChecks lists every check in order', () => {
    const plan = coerceReviewPlan({ steps: [{ kind: 'checks', tickets: ['T-2', 'T-1'] }, { kind: 'checks', tickets: ['T-3'] }, { kind: 'review' }] })!
    expect(planChecks(plan)).toEqual(['T-2', 'T-1', 'T-3'])
  })
})

describe('reviewRunStep', () => {
  const plan = coerceReviewPlan({ steps: [{ id: 'c', kind: 'checks', tickets: ['T-1', 'T-2', 'T-3', 'T-4', 'T-5'] }, { id: 'g', kind: 'gate', note: 'look' }, { id: 'r', kind: 'review', reviewers: 3 }] })!
  const fresh = () => newReviewRun(1, plan, 'abc', T0)

  it('does nothing unless running', () => {
    expect(reviewRunStep({ ...fresh(), status: 'paused' }, world()).kind).toBe('none')
  })

  it('dispatches checks up to the session ceiling, then queues', () => {
    const tickets = ['T-1', 'T-2', 'T-3', 'T-4', 'T-5'].map((k) => check(k))
    const step = reviewRunStep(fresh(), world({ tickets }))
    expect(step).toEqual({ kind: 'dispatchChecks', keys: ['T-1', 'T-2', 'T-3', 'T-4'].slice(0, CHECK_SESSIONS_MAX) })
    const busy = { ...fresh(), dispatched: { 'T-1': T0, 'T-2': T0, 'T-3': T0, 'T-4': T0 } }
    expect(reviewRunStep(busy, world({ tickets })).kind).toBe('wait')
    // One finishes: the queued one goes out.
    const next = reviewRunStep(busy, world({ tickets: tickets.map((t) => (t.key === 'T-2' ? { ...t, status: 'done' } : t)) }))
    expect(next).toEqual({ kind: 'dispatchChecks', keys: ['T-5'] })
  })

  it('advances once every check is finished, and pauses a stalled one', () => {
    const run = { ...fresh(), dispatched: Object.fromEntries(['T-1', 'T-2', 'T-3', 'T-4', 'T-5'].map((k) => [k, T0])) }
    const done = ['T-1', 'T-2', 'T-3', 'T-4', 'T-5'].map((k) => check(k, 'done'))
    expect(reviewRunStep(run, world({ tickets: done })).kind).toBe('advance')
    const stuck = done.map((t) => (t.key === 'T-3' ? { ...t, status: 'in_progress' } : t))
    expect(reviewRunStep(run, world({ tickets: stuck, now: at(CHECK_STALL_MS + 1000) })).kind).toBe('pause')
  })

  it('holds a gate until Continue', () => {
    const run = advanceReviewRun(fresh(), T0)
    expect(reviewRunStep(run, world()).kind).toBe('wait')
    expect(reviewRunStep({ ...run, gatePassed: true }, world()).kind).toBe('advance')
  })

  it('asks for the review, waits on it, and finishes on the hand-back with its verdict', () => {
    const run = advanceReviewRun(advanceReviewRun(fresh(), T0), T0)
    expect(reviewRunStep(run, world()).kind).toBe('startReview')
    const asked = { ...run, reviewRequestedAt: T0, reviewKey: 'k' }
    expect(reviewRunStep(asked, world({ review: { status: 'reviewing' } })).kind).toBe('wait')
    expect(reviewRunStep(asked, world({ review: 'unreachable' })).kind).toBe('wait')
    expect(reviewRunStep(asked, world({ review: 'missing' })).kind).toBe('pause')
    expect(reviewRunStep(asked, world({ review: { status: 'triaged', verdict: 'approve-with-nits' } }))).toEqual({ kind: 'finish', verdict: 'approve-with-nits' })
  })

  it('pauses when the review request never got a key', () => {
    const run = { ...advanceReviewRun(advanceReviewRun(fresh(), T0), T0), reviewRequestedAt: T0 }
    expect(reviewRunStep(run, world({ now: at(30_000) })).kind).toBe('wait')
    expect(reviewRunStep(run, world({ now: at(5 * 60_000) })).kind).toBe('pause')
  })

  it('finishes past the last step', () => {
    expect(reviewRunStep({ ...fresh(), cursor: 3 }, world()).kind).toBe('finish')
  })
})

describe('retryReviewRun', () => {
  it('re-dispatches the open checks and forgets a review request', () => {
    const plan = coerceReviewPlan({ steps: [{ kind: 'checks', tickets: ['T-1', 'T-2'] }, { kind: 'review' }] })!
    const run = { ...newReviewRun(1, plan, 'abc', T0), status: 'paused' as const, pausedFor: 'x', dispatched: { 'T-1': T0, 'T-2': T0 } }
    const retried = retryReviewRun(run, T0, ['T-2'])
    expect(retried.status).toBe('running')
    expect(retried.dispatched).toEqual({ 'T-1': T0 })
    const review = retryReviewRun({ ...advanceReviewRun(run, T0), reviewRequestedAt: T0, reviewKey: 'k' }, T0, [])
    expect([review.reviewRequestedAt, review.reviewKey]).toEqual(['', ''])
  })
})

describe('coercePrReview', () => {
  it('needs a PR number, and fills the rest', () => {
    expect(coercePrReview({})).toBeNull()
    const r = coercePrReview({ pr: { number: 7 }, assessment: { reviewers: 12, risk: 'odd', briefDoc: 'bad doc' } })!
    expect(r.pr.state).toBe('OPEN')
    expect(r.assessment).toMatchObject({ reviewers: 4, risk: 'medium', briefDoc: '' })
    expect(r.runs).toEqual([])
  })
})
