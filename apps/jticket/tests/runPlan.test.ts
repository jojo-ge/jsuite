import { describe, expect, it } from 'vitest'
import {
  advancePlan,
  claimVerdict,
  enterPlanStep,
  finishPlan,
  finishedReviews,
  newAutoLoop,
  planStep,
  withPlanHistory,
  type AutoLoop,
  type AutoWorld,
  type AutoWorldTicket,
} from '../app/utils/autoLoop'
import { coerceRunPlan, newPlanStep, planProblems, reviewBaseSha, type PlanStep, type PlanTicket, type RunPlan } from '../app/utils/runPlan'

const AT = '2026-09-30T00:00:00.000Z'

const s = (id: string, kind: PlanStep['kind'], patch: Partial<PlanStep> = {}): PlanStep => ({
  id,
  kind,
  tickets: [],
  reviewers: 2,
  base: '',
  note: '',
  ...patch,
})
const plan = (...steps: PlanStep[]): RunPlan => ({ steps })
const pt = (key: string, patch: Partial<PlanTicket> = {}): PlanTicket => ({ key, status: 'todo', blockedBy: [], ...patch })

function running(p: RunPlan, patch: Partial<AutoLoop> = {}): AutoLoop {
  return { ...newAutoLoop(AT), enabled: true, plan: p, ...patch }
}
function t(key: string, patch: Partial<AutoWorldTicket> = {}): AutoWorldTicket {
  return { key, status: 'todo', frontier: true, hitl: false, claimed: false, ...patch }
}
function world(patch: Partial<AutoWorld> = {}): AutoWorld {
  return { tickets: [], prs: [], tip: 'sha-tip', review: null, now: Date.parse(AT), ...patch }
}

describe('planProblems — strict order', () => {
  it('accepts a blocker in an earlier step with a merge between', () => {
    const p = plan(s('s1', 'implement', { tickets: ['T-1'] }), s('s2', 'merge'), s('s3', 'implement', { tickets: ['T-2'] }))
    expect(planProblems(p, [pt('T-1'), pt('T-2', { blockedBy: ['T-1'] })])).toEqual([])
  })

  it('refuses a blocker in the same step, a later step, or with no merge between', () => {
    const tickets = [pt('T-1'), pt('T-2', { blockedBy: ['T-1'] })]
    const same = planProblems(plan(s('s1', 'implement', { tickets: ['T-1', 'T-2'] })), tickets)
    expect(same[0]!.message).toContain('same step')
    const later = planProblems(plan(s('s1', 'implement', { tickets: ['T-2'] }), s('s2', 'implement', { tickets: ['T-1'] })), tickets)
    expect(later[0]!.message).toContain('later')
    const noMerge = planProblems(plan(s('s1', 'implement', { tickets: ['T-1'] }), s('s2', 'review'), s('s3', 'implement', { tickets: ['T-2'] })), tickets)
    expect(noMerge[0]!.message).toContain('merge step between')
  })

  it('refuses an open blocker left out of the plan, but not a finished one', () => {
    const p = plan(s('s1', 'implement', { tickets: ['T-2'] }))
    expect(planProblems(p, [pt('T-1'), pt('T-2', { blockedBy: ['T-1'] })])[0]!.message).toContain('not in the plan')
    expect(planProblems(p, [pt('T-1', { status: 'merged' }), pt('T-2', { blockedBy: ['T-1'] })])).toEqual([])
  })

  it('refuses a ticket placed twice, an unknown or finished ticket, and an empty implement step', () => {
    const p = plan(s('s1', 'implement', { tickets: ['T-1', 'T-9'] }), s('s2', 'merge'), s('s3', 'implement', { tickets: ['T-1', 'T-3'] }), s('s4', 'implement'))
    const msgs = planProblems(p, [pt('T-1'), pt('T-3', { status: 'done' })]).map((x) => x.message)
    expect(msgs.some((m) => m.includes('T-1 is already in step 1'))).toBe(true)
    expect(msgs.some((m) => m.includes('T-9 is not one'))).toBe(true)
    expect(msgs.some((m) => m.includes('T-3 is already done'))).toBe(true)
    expect(msgs.some((m) => m.includes('no tickets'))).toBe(true)
  })

  it('refuses a review based on a step that is not before it; allows the plan start', () => {
    const bad = plan(s('s1', 'review', { base: 's2' }), s('s2', 'merge'))
    expect(planProblems(bad, [])[0]!.stepId).toBe('s1')
    expect(planProblems(plan(s('s1', 'merge'), s('s2', 'review', { base: 'start' })), [])).toEqual([])
  })

  it('does not re-check frozen steps', () => {
    const p = plan(s('s1', 'implement', { tickets: ['T-1'] }), s('s2', 'merge'))
    expect(planProblems(p, [pt('T-1', { status: 'done' })], { frozen: 1 })).toEqual([])
  })
})

describe('coerceRunPlan / newPlanStep', () => {
  it('drops junk, duplicate ids and clamps reviewers', () => {
    const p = coerceRunPlan({ steps: [{ id: 's1', kind: 'review', reviewers: 9 }, { id: 's1', kind: 'merge' }, { kind: 'nope' }, { id: 'start', kind: 'merge' }] })
    expect(p!.steps).toHaveLength(1)
    expect(p!.steps[0]!.reviewers).toBe(4)
  })

  it('mints an unused id', () => {
    expect(newPlanStep(plan(s('s2', 'merge')), 'gate').id).toBe('s3')
    expect(newPlanStep(plan(s('s1', 'merge'), s('s2', 'merge')), 'merge').id).toBe('s3')
  })
})

describe('reviewBaseSha', () => {
  const p = plan(s('s1', 'implement'), s('s2', 'merge'), s('s3', 'review'), s('s4', 'merge'), s('s5', 'review'), s('s6', 'review', { base: 's2' }))
  const cps = { start: 'a', s1: 'a', s2: 'b', s3: 'c', s4: 'd', s5: 'e' }
  it('defaults to the plan start with no earlier review', () => expect(reviewBaseSha(p, 2, cps)).toBe('a'))
  it('defaults to the previous review checkpoint', () => expect(reviewBaseSha(p, 4, cps)).toBe('c'))
  it('honours an explicit base', () => expect(reviewBaseSha(p, 5, cps)).toBe('b'))
})

describe('planStep — walking a plan', () => {
  const p = plan(
    s('s1', 'implement', { tickets: ['T-1', 'T-2'] }),
    s('s2', 'merge'),
    s('s3', 'review', { reviewers: 1 }),
    s('s4', 'gate', { note: 'try it' }),
  )

  it('starts the first step over its open tickets, at the tip', () => {
    const step = planStep(running(p), world({ tickets: [t('T-1'), t('T-2', { status: 'done', frontier: false })] }))
    expect(step).toEqual({ kind: 'enterPlanStep', phase: 'implementing', tickets: ['T-1'], prs: [], baseSha: 'sha-tip', tip: 'sha-tip' })
  })

  it('dispatches only frontier AFK tickets and waits on HITL / blocked ones', () => {
    const st = running(p, { phase: 'implementing', tickets: ['T-1', 'T-2', 'T-3'] })
    const w = world({ tickets: [t('T-1'), t('T-2', { hitl: true }), t('T-3', { frontier: false })] })
    expect(planStep(st, w)).toEqual({ kind: 'dispatchTickets', keys: ['T-1'] })
    const after = planStep({ ...st, dispatched: { 'T-1': AT } }, w)
    expect(after).toMatchObject({ kind: 'wait', pending: ['T-1', 'T-2', 'T-3'] })
    expect((after as any).note).toContain('T-2 (HITL)')
    expect((after as any).note).toContain('T-3 is blocked')
  })

  it('moves to the next step (not a merge) once the implement step is finished with PRs', () => {
    const st = running(p, { phase: 'implementing', tickets: ['T-1'], dispatched: { 'T-1': AT } })
    const w = world({ tickets: [t('T-1', { status: 'done' })], prs: [{ key: 'PR-1', ticketKey: 'T-1', status: 'open' }] })
    expect(planStep(st, w)).toEqual({ kind: 'nextPlanStep', tip: 'sha-tip' })
  })

  it('merges every open PR of the plan so far, or skips with none', () => {
    const log = [{ stepId: 's1', kind: 'implement' as const, tickets: ['T-1', 'T-2'], fixTickets: [], prs: [], reviewKey: null, skipped: '', startedAt: AT, endedAt: AT }]
    const st = running(p, { cursor: 1, planLog: log })
    const prs = [
      { key: 'PR-2', ticketKey: 'T-2', status: 'conflicted' as const },
      { key: 'PR-1', ticketKey: 'T-1', status: 'open' as const },
      { key: 'PR-9', ticketKey: 'T-9', status: 'open' as const },
    ]
    expect(planStep(st, world({ prs }))).toMatchObject({ kind: 'enterPlanStep', phase: 'merging', prs: ['PR-1', 'PR-2'] })
    expect(planStep(st, world())).toMatchObject({ kind: 'skipPlanStep', reason: 'no open PR to merge' })
  })

  it('moves on after the sweep reports everything landed', () => {
    const st = running(p, { cursor: 1, phase: 'merging', prs: ['PR-1'], mergeDispatchedAt: AT, mergeReportedAt: AT })
    expect(planStep(st, world({ prs: [{ key: 'PR-1', ticketKey: 'T-1', status: 'merged' }] }))).toEqual({ kind: 'nextPlanStep', tip: 'sha-tip' })
  })

  it('reviews from its checkpoint, skipping when nothing landed since', () => {
    const st = running(p, { cursor: 2, checkpoints: { start: 'sha-start', s1: 'sha-start', s2: 'sha-tip' } })
    expect(planStep(st, world())).toMatchObject({ kind: 'enterPlanStep', phase: 'reviewing', baseSha: 'sha-start' })
    expect(planStep(st, world({ tip: 'sha-start' }))).toMatchObject({ kind: 'skipPlanStep' })
  })

  it('always fixes a review\'s findings, then merges them, then moves on', () => {
    const reviewing = running(p, { cursor: 2, phase: 'reviewing', reviewRequestedAt: AT, reviewKey: 'R-1' })
    expect(planStep(reviewing, world({ review: { status: 'ticketed', ticketKeys: ['T-7'] } }))).toEqual({ kind: 'enterFix', tickets: ['T-7'] })
    expect(planStep(reviewing, world({ review: { status: 'ticketed', ticketKeys: [] } }))).toEqual({ kind: 'nextPlanStep', tip: 'sha-tip' })
    const fixing = running(p, { cursor: 2, phase: 'fixing', fixTickets: ['T-7'], dispatched: { 'T-7': AT } })
    const w = world({ tickets: [t('T-7', { status: 'done' })], prs: [{ key: 'PR-7', ticketKey: 'T-7', status: 'open' }] })
    expect(planStep(fixing, w)).toEqual({ kind: 'enterMerge', prs: ['PR-7'] })
    const merged = running(p, { cursor: 2, phase: 'merging-fixes', prs: ['PR-7'], mergeDispatchedAt: AT, mergeReportedAt: AT })
    expect(planStep(merged, world({ prs: [{ key: 'PR-7', ticketKey: 'T-7', status: 'merged' }] }))).toEqual({ kind: 'nextPlanStep', tip: 'sha-tip' })
  })

  it('holds at a gate until Continue', () => {
    const gate = running(p, { cursor: 3, phase: 'gate' })
    expect(planStep(gate, world())).toMatchObject({ kind: 'wait', note: expect.stringContaining('try it') })
    expect(planStep({ ...gate, gatePassed: true }, world())).toEqual({ kind: 'nextPlanStep', tip: 'sha-tip' })
  })

  it('finishes past the last step — with the report only when no ticket is open', () => {
    expect(planStep(running(p, { cursor: 4 }), world({ tickets: [t('T-1')] }))).toEqual({ kind: 'finishPlan', report: false })
    expect(planStep(running(p, { cursor: 4 }), world({ tickets: [t('T-1', { status: 'merged' })] }))).toEqual({ kind: 'finishPlan', report: true })
  })

  it('stops between steps when a stop was requested', () => {
    expect(planStep(running(p, { cursor: 1, stopRequested: true }), world())).toEqual({ kind: 'turnOff' })
  })
})

describe('plan transitions', () => {
  const p = plan(s('s1', 'implement', { tickets: ['T-1'] }), s('s2', 'review'))

  it('enter → advance logs the step, checkpoints the tip and clears the step state', () => {
    let st = running(p)
    st = enterPlanStep(st, { kind: 'enterPlanStep', phase: 'implementing', tickets: ['T-1'], prs: [], baseSha: 'a', tip: 'a' }, AT)
    expect(st.checkpoints.start).toBe('a')
    st = { ...st, dispatched: { 'T-1': AT } }
    st = advancePlan(st, AT, 'b')
    expect(st).toMatchObject({ cursor: 1, phase: 'idle', dispatched: {}, tickets: [], checkpoints: { start: 'a', s1: 'b' } })
    expect(st.planLog[0]).toMatchObject({ stepId: 's1', tickets: ['T-1'], skipped: '' })
  })

  it('finishPlan records one history entry and turns off, or runs the report', () => {
    const st = running(p, { cursor: 2, planLog: [{ stepId: 's2', kind: 'review', tickets: [], fixTickets: ['T-7'], prs: [], reviewKey: 'R-1', skipped: '', startedAt: AT, endedAt: AT }] })
    const off = finishPlan(st, AT, false)
    expect(off).toMatchObject({ enabled: false, plan: null, ended: { reason: 'plan-finished' } })
    expect(off.history.at(-1)).toMatchObject({ fixTickets: ['T-7'], reviewKey: 'R-1' })
    expect(finishPlan(st, AT, true)).toMatchObject({ enabled: true, phase: 'reporting', plan: null })
    expect(finishedReviews(off).has('R-1')).toBe(true)
  })

  it('a plan stopped mid-step keeps what it got through', () => {
    const st = running(p, { phase: 'implementing', tickets: ['T-1'] })
    expect(withPlanHistory(st, AT).history.at(-1)!.plan).toHaveLength(1)
    expect(withPlanHistory(running(p), AT).history).toHaveLength(0)
  })
})

describe('claimVerdict — run plans', () => {
  it('refuses HITL tickets, and makes blocked ones wait', () => {
    const st = running(plan(), { orchestration: { mode: 'orchestrated', budget: 2 }, phase: 'implementing', tickets: ['T-1', 'T-2'] })
    expect(claimVerdict(st, { tickets: [t('T-1', { hitl: true })] }, 'T-1')).toMatchObject({ ok: false, wait: false })
    expect(claimVerdict(st, { tickets: [t('T-2', { frontier: false })] }, 'T-2')).toMatchObject({ ok: false, wait: true })
  })
})
