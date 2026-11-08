import { describe, expect, it } from 'vitest'
import {
  advancePlan,
  claimVerdict,
  effectiveOrchestration,
  enterPlanStep,
  finishPlan,
  finishedReviews,
  newAutoLoop,
  newOrchestrator,
  finishSlice,
  enterSlice,
  inFlight,
  soloQueue,
  runnerFor,
  slotRunner,
  orchestratedKeys,
  planStep,
  withPlanHistory,
  type AutoLoop,
  type AutoWorld,
  type AutoWorldTicket,
} from '../app/utils/autoLoop'
import {
  BUDGET_MIN,
  GROUP_MIN,
  REVIEW_DEFAULT,
  coerceGroups,
  liveGroups,
  coerceRunPlan,
  dispatchSummary,
  groupRunnerOf,
  groupShares,
  implementSummary,
  stepGroupEntries,
  newPlanStep,
  reviewSummary,
  runnerOf,
  soloTickets,
  stepGroups,
  planProblems,
  reviewBaseSha,
  stepShape,
  stepShapeLabel,
  stepSoloSlots,
  STEP_BUDGET_MAX,
  STEP_ORCHESTRATORS_MAX,
  STEP_SESSIONS_MAX,
  type PlanDispatch,
  type PlanStep,
  type PlanTicket,
  type RunPlan,
} from '../app/utils/runPlan'

const AT = '2026-09-30T00:00:00.000Z'

const s = (id: string, kind: PlanStep['kind'], patch: Partial<PlanStep> = {}): PlanStep => ({
  id,
  kind,
  tickets: [],
  reviewers: 2,
  base: '',
  note: '',
  dispatch: null,
  groups: [],
  groupRunners: [],
  runners: {},
  review: { ...REVIEW_DEFAULT },
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

  it('refuses a ticket placed twice, an unknown ticket, and an empty implement step — a finished one may stay', () => {
    const p = plan(s('s1', 'implement', { tickets: ['T-1', 'T-9'] }), s('s2', 'merge'), s('s3', 'implement', { tickets: ['T-1', 'T-3', 'T-4'] }), s('s4', 'implement'))
    const msgs = planProblems(p, [pt('T-1'), pt('T-3', { status: 'merged' }), pt('T-4', { status: 'done' })]).map((x) => x.message)
    expect(msgs.some((m) => m.includes('T-1 is already in step 1'))).toBe(true)
    expect(msgs.some((m) => m.includes('T-9 is not one'))).toBe(true)
    expect(msgs.some((m) => m.includes('T-3'))).toBe(false)
    expect(msgs.some((m) => m.includes('T-4'))).toBe(false)
    expect(msgs.some((m) => m.includes('no tickets'))).toBe(true)
  })

  it('a plan that already ran part-way passes as it is — its finished tickets are skipped, not refused', () => {
    // Steps 1–2 ran and merged; T-3 (blocked by T-1) is still to do.
    const p = plan(s('s1', 'implement', { tickets: ['T-1', 'T-2'] }), s('s2', 'merge'), s('s3', 'implement', { tickets: ['T-3'] }))
    const tickets = [pt('T-1', { status: 'merged' }), pt('T-2', { status: 'merged' }), pt('T-3', { blockedBy: ['T-1'] })]
    expect(planProblems(p, tickets)).toEqual([])
    expect(planProblems(p, tickets, { frozen: 2 })).toEqual([])
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
    const st = running(plan(), { orchestration: { mode: 'orchestrated', model: 'opus', effort: 'high', budget: 2, orchestrators: 1 }, phase: 'implementing', tickets: ['T-1', 'T-2', 'T-3', 'T-4'] })
    expect(claimVerdict(st, { tickets: [t('T-1', { hitl: true })] }, 'T-1')).toMatchObject({ ok: false, wait: false })
    expect(claimVerdict(st, { tickets: [t('T-2', { frontier: false })] }, 'T-2')).toMatchObject({ ok: false, wait: true })
  })
})

describe('per-step dispatch', () => {
  const orch: PlanDispatch = { mode: 'orchestrated', model: 'sonnet', effort: 'high', budget: 3, orchestrators: 1 }

  it('coerces a step\'s dispatch: kept on implement steps, clamped, dropped elsewhere, null when unusable', () => {
    const raw = {
      steps: [
        { id: 's1', kind: 'implement', tickets: ['T-1'], dispatch: { mode: 'orchestrated', model: 'sonnet', effort: 'low', budget: 99 } },
        { id: 's2', kind: 'implement', tickets: ['T-2'], dispatch: { mode: 'weird', model: 'gpt', effort: 'wild', budget: 'x' } },
        { id: 's3', kind: 'implement', tickets: ['T-3'] },
        { id: 's4', kind: 'merge', dispatch: orch },
      ],
    }
    const got = coerceRunPlan(raw)!.steps.map((x) => x.dispatch)
    // An orchestrated step saved before groups existed keeps one orchestrator with everything.
    expect(coerceRunPlan(raw)!.steps.map((x) => x.groups)).toEqual([[['T-1']], [], [], []])
    // A step's budget is clamped to STEP_BUDGET_MAX (the jButton's 1–4 is the plain loop's).
    expect(got).toEqual([
      { mode: 'orchestrated', model: 'sonnet', effort: 'low', budget: STEP_BUDGET_MAX, orchestrators: 1 },
      { mode: 'sessions', model: 'opus', effort: 'high', budget: 2, orchestrators: 1 },
      null,
      null,
    ])
    // On a step the mode follows the groups: grouped tickets → orchestrated, none → sessions.
    const grouped = coerceRunPlan({ steps: [{ id: 's1', kind: 'implement', tickets: ['T-1', 'T-2'], dispatch: { mode: 'sessions' }, groups: [['T-2']] }] })!.steps[0]!
    expect(grouped.dispatch).toMatchObject({ mode: 'orchestrated', orchestrators: 1 })
    const ungrouped = coerceRunPlan({ steps: [{ id: 's1', kind: 'implement', tickets: ['T-1'], dispatch: { mode: 'orchestrated' }, groups: [[]] }] })!.steps[0]!
    expect(ungrouped.groups).toEqual([['T-1']])
  })

  it('coerces a solo ticket\'s own runner (never a grouped one\'s), and a review step\'s setting', () => {
    const step = coerceRunPlan({
      steps: [
        {
          id: 's1',
          kind: 'implement',
          tickets: ['T-1', 'T-2', 'T-3'],
          groups: [['T-3']],
          runners: { 'T-1': { model: 'sonnet', effort: 'low' }, 'T-3': { model: 'haiku', effort: 'max' }, 'T-9': { model: 'opus', effort: 'high' }, 'T-2': 'nope' },
        },
        { id: 's2', kind: 'review', reviewers: 1, review: { model: 'sonnet', effort: 'xhigh', arch: { model: 'fable', effort: 'bogus' } } },
        { id: 's3', kind: 'review', reviewers: 9 },
      ],
    })!.steps
    expect(step[0]!.runners).toEqual({ 'T-1': { model: 'sonnet', effort: 'low' } })
    expect(soloTickets(step[0]!)).toEqual(['T-1', 'T-2'])
    expect(runnerOf(step[0]!, 'T-1', orch)).toEqual({ model: 'sonnet', effort: 'low' })
    expect(runnerOf(step[0]!, 'T-2', orch)).toEqual({ model: 'sonnet', effort: 'high' })
    // Reviewers are 2…4; the review setting is coerced field by field.
    expect(step[1]!.reviewers).toBe(2)
    expect(step[1]!.review).toEqual({ model: 'sonnet', effort: 'xhigh', arch: { model: 'fable', effort: 'high' } })
    expect(step[2]!.reviewers).toBe(4)
    expect(step[2]!.review).toEqual(REVIEW_DEFAULT)
  })

  it('effectiveOrchestration is the implement step\'s own while it is implementing, else the run\'s', () => {
    const p = plan(s('s1', 'implement', { tickets: ['T-1'], dispatch: orch, groups: [['T-1']] }), s('s2', 'review'), s('s3', 'implement', { tickets: ['T-2'] }))
    const run = { mode: 'sessions' as const, model: 'opus' as const, effort: 'high' as const, budget: 2, orchestrators: 1 }
    expect(effectiveOrchestration(running(p, { orchestration: run, phase: 'implementing', cursor: 0 }))).toEqual(orch)
    expect(effectiveOrchestration(running(p, { orchestration: run, phase: 'idle', cursor: 0 }))).toEqual(run)
    expect(effectiveOrchestration(running(p, { orchestration: run, phase: 'fixing', cursor: 1 }))).toEqual(run)
    expect(effectiveOrchestration(running(p, { orchestration: run, phase: 'implementing', cursor: 2 }))).toEqual(run)
  })

  it('an orchestrated step in a sessions run takes claims, under its own budget', () => {
    const p = plan(s('s1', 'implement', { tickets: ['T-1', 'T-2', 'T-3', 'T-4'], dispatch: { ...orch, budget: 1 }, groups: [['T-1', 'T-2', 'T-3', 'T-4']] }))
    const run = { mode: 'sessions' as const, model: 'opus' as const, effort: 'high' as const, budget: 4, orchestrators: 1 }
    const st = running(p, {
      orchestration: run,
      phase: 'implementing',
      cursor: 0,
      tickets: ['T-1', 'T-2', 'T-3', 'T-4'],
      orchestrators: [{ ...newOrchestrator(1, ['T-1', 'T-2', 'T-3', 'T-4']), dispatchedAt: AT }],
    })
    const w = world({ tickets: [t('T-1'), t('T-2'), t('T-3'), t('T-4')] })
    expect(claimVerdict(st, w, 'T-1')).toEqual({ ok: true, again: false })
    const one = { ...st, dispatched: { 'T-1': AT } }
    expect(claimVerdict(one, w, 'T-2')).toMatchObject({ ok: false, status: 409, wait: true })
    // The same run, a step without its own setting: not orchestrated at all.
    const plain = running(plan(s('s1', 'implement', { tickets: ['T-1'] })), { orchestration: run, phase: 'implementing', cursor: 0, tickets: ['T-1'] })
    expect(claimVerdict(plain, w, 'T-1')).toMatchObject({ ok: false, status: 409, wait: false })
  })

  it('the step\'s record says how it ran', () => {
    const four = ['T-1', 'T-2', 'T-3', 'T-4']
    const p = plan(s('s1', 'implement', { tickets: four, dispatch: orch, groups: [four] }), s('s2', 'implement', { tickets: ['T-5'] }))
    const run = { mode: 'sessions' as const, model: 'haiku' as const, effort: 'high' as const, budget: 2, orchestrators: 1 }
    const first = advancePlan(running(p, { orchestration: run, phase: 'implementing', cursor: 0, tickets: four, stepStartedAt: AT }), AT, 'tip-1')
    expect(first.planLog[0]!.dispatch).toEqual(orch)
    const second = advancePlan({ ...first, phase: 'implementing', tickets: ['T-5'], stepStartedAt: AT }, AT, 'tip-2')
    expect(second.planLog[1]!.dispatch).toEqual(run)
    const skipped = advancePlan(running(p, { orchestration: run, phase: 'idle', cursor: 0 }), AT, 'tip-0', 'nothing to run')
    expect(skipped.planLog[0]!.dispatch).toBeUndefined()
  })

  it('summarises a dispatch for the builder', () => {
    expect(dispatchSummary(orch, 3)).toBe('One Fable 5.1 orchestrator runs 3 tickets through Sonnet 5.5 subagents, at most 3 in flight, spec-checking each before it\'s done.')
    expect(dispatchSummary({ mode: 'sessions', model: 'opus', effort: 'high', budget: 2, orchestrators: 1 }, 1)).toBe('1 ticket at once, each in its own Opus 5.5 session and worktree.')
    const mixed = s('s1', 'implement', { tickets: ['T-1', 'T-2', 'T-3'], dispatch: { ...orch, model: 'opus' }, groups: [['T-3']], runners: { 'T-2': { model: 'haiku', effort: 'low' } } })
    expect(implementSummary(mixed, orch)).toBe(
      '2 tickets each with its own agent (1 on Opus 5.5 high, 1 on Haiku 5.5 low), beside 1 Fable 5.1 orchestrator working 1 ticket through Opus 5.5 high subagents, 3 in flight each.',
    )
    expect(reviewSummary(s('s2', 'review', { reviewers: 3, review: { model: 'opus', effort: 'medium', arch: { model: 'opus', effort: 'high' } } }))).toBe(
      'architectural & technical reviewer first (Opus 5.5 high; its architectural findings must be fixed), then 3 reviewers (Opus 5.5 medium) — findings they all raise are fixed and merged here',
    )
    expect(dispatchSummary({ ...orch, orchestrators: 2 }, 5)).toBe(
      '2 Fable 5.1 orchestrators share 5 tickets out between them, each running its share through Sonnet 5.5 subagents, at most 3 in flight each, spec-checking every ticket before it\'s done.',
    )
  })
})

describe('orchestrator groups — the human says which tickets go together', () => {
  const orch: PlanDispatch = { mode: 'orchestrated', model: 'opus', effort: 'high', budget: 2, orchestrators: 1 }
  const keys = ['T-1', 'T-2', 'T-3', 'T-4']

  it('coerces groups: only the step\'s tickets, each once, at most STEP_ORCHESTRATORS_MAX groups (the rest fold into the last), empties kept', () => {
    expect(STEP_ORCHESTRATORS_MAX).toBe(2)
    expect(coerceGroups([['T-1', 'T-9', 'T-2'], ['T-2', 'T-3']], keys)).toEqual([['T-1', 'T-2'], ['T-3']])
    expect(coerceGroups([['T-1'], []], keys)).toEqual([['T-1'], []])
    expect(coerceGroups([['T-1'], ['T-2'], ['T-3'], ['T-4'], ['T-1']], ['T-1', 'T-2', 'T-3', 'T-4', 'T-5'])).toEqual([['T-1'], ['T-2', 'T-3', 'T-4']])
    expect(coerceGroups('nope', keys)).toEqual([])
    const got = coerceRunPlan({ steps: [{ id: 's1', kind: 'implement', tickets: keys, dispatch: { ...orch, orchestrators: 4 }, groups: [['T-1'], ['T-2', 'T-3'], ['T-4']] }] })!.steps[0]!
    expect(got.groups).toEqual([['T-1'], ['T-2', 'T-3', 'T-4']])
    // The groups say how many orchestrators the step has.
    expect(got.dispatch!.orchestrators).toBe(2)
    // The ticket list keeps the builder's order — it's the step's queue.
    const ordered = coerceRunPlan({ steps: [{ id: 's1', kind: 'implement', tickets: ['T-4', 'T-1', 'T-3', 'T-1'] }] })!.steps[0]!
    expect(ordered.tickets).toEqual(['T-4', 'T-1', 'T-3'])
  })

  it('the step shapes: own agents only (4 at once), mixed (1 orchestrator + 3), orchestrators only (2, no solo)', () => {
    expect(STEP_SESSIONS_MAX).toBe(4)
    expect(stepSoloSlots(0)).toBe(4)
    expect(stepSoloSlots(1)).toBe(3)
    expect(stepSoloSlots(2)).toBe(0)
    const six = ['T-1', 'T-2', 'T-3', 'T-4', 'T-5', 'T-6']
    expect(stepShape({ tickets: six, groups: [] })).toEqual({ solo: six, orchestrators: 0, soloSlots: 4, sessions: 4, queued: ['T-5', 'T-6'] })
    expect(stepShape({ tickets: six, groups: [['T-6']] })).toEqual({ solo: six.slice(0, 5), orchestrators: 1, soloSlots: 3, sessions: 4, queued: ['T-4', 'T-5'] })
    expect(stepShape({ tickets: six, groups: [['T-1', 'T-2'], ['T-3', 'T-4', 'T-5', 'T-6']] })).toEqual({ solo: [], orchestrators: 2, soloSlots: 0, sessions: 2, queued: [] })
    expect(stepShape({ tickets: ['T-1'], groups: [] })).toEqual({ solo: ['T-1'], orchestrators: 0, soloSlots: 4, sessions: 1, queued: [] })
    expect(stepShapeLabel({ tickets: six, groups: [], dispatch: null }, orch)).toBe('4 own agents at once (2 queued)')
    expect(stepShapeLabel({ tickets: six, groups: [['T-6']], dispatch: orch }, orch)).toBe('3 own agents at once (2 queued) + 1 orchestrator, 2 in flight')
    expect(stepShapeLabel({ tickets: ['T-1', 'T-2'], groups: [['T-1'], ['T-2']], dispatch: { ...orch, budget: 1 } }, orch)).toBe('2 orchestrators, 1 in flight each')
    // The invalid shape says so plainly — planProblems refuses it.
    expect(stepShapeLabel({ tickets: six, groups: [['T-1'], ['T-2']], dispatch: { ...orch, budget: 1 } }, orch)).toBe('0 own agents at once (4 queued) + 2 orchestrators, 1 in flight each')
    expect(stepShapeLabel({ tickets: ['T-1'], groups: [], dispatch: null }, orch)).toBe('1 own agent at once')
  })

  it('planProblems refuses an own-agent ticket beside two orchestrators, and a group too small to pay for an orchestrator', () => {
    const eight = ['T-1', 'T-2', 'T-3', 'T-4', 'T-5', 'T-6', 'T-7', 'T-8']
    const tickets = eight.map((k) => pt(k))
    const two = plan(s('s1', 'implement', { tickets: eight, groups: [['T-1', 'T-2', 'T-3', 'T-4'], ['T-5', 'T-6', 'T-7']] }))
    expect(planProblems(two, tickets).map((p) => p.message)).toEqual([
      "Step 1 runs 2 orchestrators, so T-8 can't run as its own agent beside them — put it in a group, or in a step of its own.",
      "Step 1's orchestrator 2 has only 3 tickets (T-5, T-6, T-7) — an orchestrator needs 4 or more to pay for itself; run them as their own agents instead.",
    ])
    expect(GROUP_MIN).toBe(4)
    expect(planProblems(plan(s('s1', 'implement', { tickets: eight, groups: [['T-1', 'T-2', 'T-3', 'T-4'], ['T-5', 'T-6', 'T-7', 'T-8']] })), tickets)).toEqual([])
    expect(planProblems(plan(s('s1', 'implement', { tickets: eight, groups: [['T-1', 'T-2', 'T-3', 'T-4']] })), tickets)).toEqual([])
    expect(planProblems(plan(s('s1', 'implement', { tickets: keys, groups: [['T-1']] })), keys.map((k) => pt(k))).map((p) => p.message)).toEqual([
      "Step 1's orchestrator 1 has only one ticket (T-1) — an orchestrator needs 4 or more to pay for itself; run it as its own agent instead.",
    ])
    // More tickets than sessions is no problem: the rest queue.
    const many = [...eight, 'T-9']
    expect(planProblems(plan(s('s1', 'implement', { tickets: many })), many.map((k) => pt(k)))).toEqual([])
    // A frozen (already run) step isn't re-checked.
    expect(planProblems(two, tickets, { frozen: 1 })).toEqual([])
  })

  it('an orchestrated step never runs at budget 1 — coerceRunPlan lifts it to BUDGET_MIN', () => {
    expect(BUDGET_MIN).toBe(2)
    const got = coerceRunPlan({ steps: [{ id: 's1', kind: 'implement', tickets: keys, dispatch: { ...orch, budget: 1 }, groups: [keys] }] })!.steps[0]!
    expect(got.dispatch!.budget).toBe(2)
  })

  it('the engine runs a step\'s own-agent tickets as a queue: as many as there are free sessions, in the step\'s order', () => {
    const run = { mode: 'sessions' as const, model: 'opus' as const, effort: 'high' as const, budget: 2, orchestrators: 1 }
    const six = ['T-1', 'T-2', 'T-3', 'T-4', 'T-5', 'T-6']
    const w = world({ tickets: six.map((k) => t(k)) })
    // Own agents only: four go out, two queue.
    const st = running(plan(s('s1', 'implement', { tickets: six })), { orchestration: run, phase: 'implementing', cursor: 0, tickets: six })
    expect(soloQueue(st, w, six)).toEqual({ ready: ['T-1', 'T-2', 'T-3', 'T-4'], queued: ['T-5', 'T-6'] })
    expect(planStep(st, w)).toEqual({ kind: 'dispatchTickets', keys: ['T-1', 'T-2', 'T-3', 'T-4'] })
    // Four running: the step waits, saying who's queued.
    const four = { ...st, dispatched: { 'T-1': AT, 'T-2': AT, 'T-3': AT, 'T-4': AT } }
    const busy = world({ tickets: six.map((k) => t(k, { status: 'in_progress', claimed: true })), agents: { 'T-1': 'working', 'T-2': 'working', 'T-3': 'working', 'T-4': 'working' } })
    expect(planStep(four, busy)).toMatchObject({ kind: 'wait', pending: six, note: 'T-5, T-6 queued — start as a session frees' })
    // One finishes: the next in the queue goes out, alone.
    const oneDone = world({ tickets: six.map((k) => t(k, k === 'T-2' ? { status: 'done' } : { status: k <= 'T-4' ? 'in_progress' : 'todo' })) })
    expect(planStep(four, oneDone)).toEqual({ kind: 'dispatchTickets', keys: ['T-5'] })
    // A queued ticket not on the frontier is passed over, not counted as queued.
    const held = world({ tickets: six.map((k) => t(k, k === 'T-5' ? { frontier: false } : {})) })
    expect(soloQueue(st, held, six)).toEqual({ ready: ['T-1', 'T-2', 'T-3', 'T-4'], queued: ['T-6'] })
    // Mixed: the orchestrator takes a session, so three own agents run at once.
    const seven = [...six, 'T-7']
    const w7 = world({ tickets: seven.map((k) => t(k)) })
    const mixed = running(plan(s('s1', 'implement', { tickets: seven, groups: [['T-4', 'T-5', 'T-6', 'T-7']] })), { orchestration: run, phase: 'implementing', cursor: 0, tickets: seven })
    expect(planStep(mixed, w7)).toEqual({ kind: 'dispatchTickets', keys: ['T-1', 'T-2', 'T-3'] })
    const mixedOut = { ...mixed, dispatched: { 'T-1': AT, 'T-2': AT, 'T-3': AT } }
    expect(planStep(mixedOut, w7)).toEqual({ kind: 'dispatchOrchestrators', shares: [['T-4', 'T-5', 'T-6', 'T-7']] })
    // Orchestrators only: nothing solo to queue.
    const eight = [...seven, 'T-8']
    const boxed = running(plan(s('s1', 'implement', { tickets: eight, groups: [['T-1', 'T-2', 'T-3', 'T-4'], ['T-5', 'T-6', 'T-7', 'T-8']] })), { orchestration: run, phase: 'implementing', cursor: 0, tickets: eight })
    expect(planStep(boxed, world({ tickets: eight.map((k) => t(k)) }))).toEqual({ kind: 'dispatchOrchestrators', shares: [['T-1', 'T-2', 'T-3', 'T-4'], ['T-5', 'T-6', 'T-7', 'T-8']] })
    // The plain loop has no cap: every frontier ticket goes out at once.
    const loop = { ...newAutoLoop(AT), enabled: true, orchestration: run, phase: 'implementing' as const, tickets: six }
    expect(planStep(loop, w)).toEqual({ kind: 'dispatchTickets', keys: six })
  })

  it('stepGroups is the orchestrators\' tickets; soloTickets everyone else', () => {
    expect(stepGroups({ tickets: keys, groups: [] })).toEqual([])
    expect(soloTickets({ tickets: keys, groups: [] })).toEqual(keys)
    expect(stepGroups({ tickets: keys, groups: [['T-2'], ['T-4'], []] })).toEqual([['T-2'], ['T-4']])
    expect(soloTickets({ tickets: keys, groups: [['T-2'], ['T-4'], []] })).toEqual(['T-1', 'T-3'])
    expect(stepGroups({ tickets: ['T-1'], groups: [['T-1', 'T-9']] })).toEqual([['T-1']])
  })

  it('groupShares cuts the groups down to the open AFK tickets and drops empty ones', () => {
    expect(groupShares([['T-1', 'T-2'], ['T-3'], ['T-4']], ['T-1', 'T-3', 'T-5'])).toEqual([['T-1', 'T-5'], ['T-3']])
    expect(groupShares([[], ['T-2']], ['T-2'])).toEqual([['T-2']])
    expect(groupShares([['T-1']], [])).toEqual([[]])
    expect(groupShares([], ['T-1'])).toEqual([['T-1']])
  })

  it('a grouped step starts one orchestrator per group, with exactly those tickets — however the run was started', () => {
    const run = { mode: 'orchestrated' as const, model: 'opus' as const, effort: 'high' as const, budget: 2, orchestrators: 1 }
    const eight = ['T-1', 'T-2', 'T-3', 'T-4', 'T-5', 'T-6', 'T-7', 'T-8']
    const p = plan(s('s1', 'implement', { tickets: eight, groups: [['T-1', 'T-4', 'T-6', 'T-8'], ['T-2', 'T-3', 'T-5', 'T-7']] }))
    const st = running(p, { orchestration: run, phase: 'implementing', cursor: 0, tickets: eight })
    const w = world({ tickets: eight.map((k) => t(k)) })
    expect(planStep(st, w)).toEqual({ kind: 'dispatchOrchestrators', shares: [['T-1', 'T-4', 'T-6', 'T-8'], ['T-2', 'T-3', 'T-5', 'T-7']] })
    expect(effectiveOrchestration(st)).toEqual({ ...run, orchestrators: 2 })
    // A HITL ticket in a group is left out of the share; an empty box starts nothing.
    const human = world({ tickets: eight.map((k) => t(k, k === 'T-4' ? { hitl: true } : {})) })
    const boxed = running(plan(s('s1', 'implement', { tickets: eight, groups: [[], ['T-1', 'T-2', 'T-3', 'T-4'], ['T-5', 'T-6', 'T-7', 'T-8']] })), { orchestration: run, phase: 'implementing', cursor: 0, tickets: eight })
    expect(planStep(boxed, human)).toEqual({ kind: 'dispatchOrchestrators', shares: [['T-1', 'T-2', 'T-3'], ['T-5', 'T-6', 'T-7', 'T-8']] })
    expect(effectiveOrchestration(boxed)).toEqual({ ...run, orchestrators: 2 })
    // A group that has shrunk under GROUP_MIN by the time the step starts (tickets already finished) runs as own agents.
    expect(liveGroups([['T-1', 'T-2', 'T-3', 'T-4'], ['T-5', 'T-6', 'T-7', 'T-8']], ['T-1', 'T-2', 'T-3', 'T-5', 'T-6', 'T-7', 'T-8'])).toEqual([[], ['T-5', 'T-6', 'T-7', 'T-8']])
    const shrunk = running(p, { orchestration: run, phase: 'implementing', cursor: 0, tickets: ['T-1', 'T-4', 'T-2', 'T-3', 'T-5', 'T-7'] })
    expect(effectiveOrchestration(shrunk)).toEqual({ ...run, orchestrators: 1 })
    expect(orchestratedKeys(shrunk, shrunk.tickets)).toEqual(['T-2', 'T-3', 'T-5', 'T-7'])
    expect(planStep(shrunk, w)).toEqual({ kind: 'dispatchTickets', keys: ['T-1', 'T-4'] })
    // Ungrouped on a plan step = every ticket its own agent, whatever the run's setting says.
    const plain = running(plan(s('s1', 'implement', { tickets: keys, dispatch: { ...orch, orchestrators: 2 } })), { orchestration: run, phase: 'implementing', cursor: 0, tickets: keys })
    expect(effectiveOrchestration(plain).mode).toBe('sessions')
    expect(planStep(plain, w)).toEqual({ kind: 'dispatchTickets', keys })
  })

  it('solo agents and orchestrators run side by side in one step', () => {
    const run = { mode: 'sessions' as const, model: 'opus' as const, effort: 'high' as const, budget: 2, orchestrators: 1 }
    const six = ['T-1', 'T-2', 'T-3', 'T-4', 'T-5', 'T-6']
    const group = ['T-2', 'T-4', 'T-5', 'T-6']
    const step = s('s1', 'implement', { tickets: six, dispatch: { ...orch, model: 'opus' }, groups: [group], runners: { 'T-3': { model: 'haiku', effort: 'low' } } })
    const st = running(plan(step), { orchestration: run, phase: 'implementing', cursor: 0, tickets: six })
    const w = world({ tickets: six.map((k) => t(k)) })
    expect(effectiveOrchestration(st)).toMatchObject({ mode: 'orchestrated', orchestrators: 1, model: 'opus', effort: 'high', budget: 2 })
    expect(orchestratedKeys(st, six)).toEqual(group)
    // The solo tickets go out first, each as its own agent on its own runner…
    expect(planStep(st, w)).toEqual({ kind: 'dispatchTickets', keys: ['T-1', 'T-3'] })
    expect(runnerFor(st, 'T-1')).toEqual({ model: 'opus', effort: 'high' })
    expect(runnerFor(st, 'T-3')).toEqual({ model: 'haiku', effort: 'low' })
    // …then the orchestrator starts with exactly its group.
    const soloOut = { ...st, dispatched: { 'T-1': AT, 'T-3': AT } }
    expect(planStep(soloOut, w)).toEqual({ kind: 'dispatchOrchestrators', shares: [group] })
    // A solo ticket is never an orchestrator's to claim; a grouped one is, under the step's budget.
    const both = { ...soloOut, orchestrators: [{ ...newOrchestrator(1, group), dispatchedAt: AT }] }
    expect(claimVerdict(both, w, 'T-1')).toMatchObject({ ok: false, status: 409, wait: false })
    expect(claimVerdict(both, w, 'T-2')).toEqual({ ok: true, again: false })
    // Solo agents in flight never count against the orchestrator's budget.
    expect(inFlight(both, w)).toEqual([])
    // Everyone dispatched and working: the step waits on them all.
    const all = { ...both, dispatched: { ...both.dispatched, 'T-2': AT } }
    expect(planStep(all, world({ tickets: six.map((k) => t(k, { status: 'in_progress', claimed: true })), agents: { 'T-1': 'working', 'T-3': 'working' }, orchestrators: { 0: 'working' } }))).toMatchObject({ kind: 'wait', pending: six })
  })
})

describe('review step — the architectural pass before the regular reviewers', () => {
  const arch = { model: 'opus' as const, effort: 'high' as const }
  const p = plan(s('s1', 'implement', { tickets: ['T-1'] }), s('s2', 'review', { review: { model: 'opus', effort: 'medium', arch } }))
  const atReview = (patch: Partial<AutoLoop> = {}) => running(p, { cursor: 1, checkpoints: { start: 'sha-0', s1: 'sha-1' }, ...patch })

  it('enters the arch pass first; a review step without one goes straight to the regular reviewers', () => {
    expect(planStep(atReview(), world({ tip: 'sha-2' }))).toMatchObject({ kind: 'enterPlanStep', phase: 'arch-reviewing', baseSha: 'sha-0' })
    const plain = running(plan(s('s1', 'implement', { tickets: ['T-1'] }), s('s2', 'review')), { cursor: 1, checkpoints: { start: 'sha-0', s1: 'sha-1' } })
    expect(planStep(plain, world({ tip: 'sha-2' }))).toMatchObject({ kind: 'enterPlanStep', phase: 'reviewing' })
  })

  it('arch findings → arch-fixing → merged → the regular review; none → the regular review at once', () => {
    const asked = atReview({ phase: 'arch-reviewing', baseSha: 'sha-1', reviewRequestedAt: AT, reviewKey: 'ra' })
    expect(planStep(atReview({ phase: 'arch-reviewing', baseSha: 'sha-1' }), world({ tip: 'sha-2' }))).toEqual({ kind: 'startReview' })
    expect(planStep(asked, world({ tip: 'sha-2', review: { status: 'ticketed', ticketKeys: ['T-7'] } }))).toEqual({ kind: 'enterFix', tickets: ['T-7'] })
    expect(planStep(asked, world({ tip: 'sha-2', review: { status: 'ticketed', ticketKeys: [] } }))).toEqual({ kind: 'enterReview' })
    // Fixing the architectural findings: a solo session per ticket, then their PRs merge inside the step.
    const fixing = atReview({ phase: 'arch-fixing', fixTickets: ['T-7'], archReviewKey: 'ra', archTickets: ['T-7'] })
    expect(planStep(fixing, world({ tip: 'sha-2', tickets: [t('T-7')] }))).toEqual({ kind: 'dispatchTickets', keys: ['T-7'] })
    const done = world({ tip: 'sha-2', tickets: [t('T-7', { status: 'done' })], prs: [{ key: 'PR-9', ticketKey: 'T-7', status: 'open' }] })
    expect(planStep({ ...fixing, dispatched: { 'T-7': AT } }, done)).toEqual({ kind: 'enterMerge', prs: ['PR-9'] })
    // Merged: the regular reviewers read the result.
    const merging = atReview({ phase: 'arch-merging', prs: ['PR-9'], mergeDispatchedAt: AT, mergeReportedAt: AT, archReviewKey: 'ra', archTickets: ['T-7'] })
    expect(planStep(merging, world({ tip: 'sha-3', prs: [{ key: 'PR-9', ticketKey: 'T-7', status: 'merged' }] }))).toEqual({ kind: 'enterReview' })
    // The step's record carries both passes.
    const consensus = atReview({ phase: 'reviewing', baseSha: 'sha-1', reviewKey: 'rc', archReviewKey: 'ra', archTickets: ['T-7'], fixTickets: ['T-8'], stepStartedAt: AT })
    expect(advancePlan(consensus, AT, 'sha-4').planLog[0]).toMatchObject({ reviewKey: 'rc', archReviewKey: 'ra', fixTickets: ['T-7', 'T-8'] })
  })
})

describe('slice reports — before every implement step after the first', () => {
  const p = plan(s('s1', 'implement', { tickets: ['T-1'] }), s('s2', 'merge'), s('s3', 'implement', { tickets: ['T-2'] }))
  const open = [t('T-1', { status: 'done' }), t('T-2')]

  it('the first implement step just starts; a later one writes the report first when the tip moved', () => {
    expect(planStep(running(p, { cursor: 0 }), world({ tickets: [t('T-1'), t('T-2')], tip: 'sha-0' }))).toMatchObject({ kind: 'enterPlanStep', phase: 'implementing' })
    const later = running(p, { cursor: 2, checkpoints: { start: 'sha-0', s1: 'sha-1', s2: 'sha-1' } })
    expect(planStep(later, world({ tickets: open, tip: 'sha-1' }))).toEqual({ kind: 'enterSlice', from: 'sha-0', tip: 'sha-1' })
    // Nothing landed since the last report: no report, straight in.
    const quiet = running(p, { cursor: 2, checkpoints: { start: 'sha-0', slice: 'sha-1' } })
    expect(planStep(quiet, world({ tickets: open, tip: 'sha-1' }))).toMatchObject({ kind: 'enterPlanStep', phase: 'implementing' })
    // Finished tickets only: skipped, no report either.
    expect(planStep(later, world({ tickets: [t('T-1', { status: 'done' }), t('T-2', { status: 'done' })], tip: 'sha-1' }))).toMatchObject({ kind: 'skipPlanStep' })
  })

  it('dispatches the writer, waits for it, then checkpoints what it covered and hands the doc to the step', () => {
    const entered = enterSlice(running(p, { cursor: 2, checkpoints: { start: 'sha-0' } }), { kind: 'enterSlice', from: 'sha-0', tip: 'sha-1' }, AT)
    expect(entered).toMatchObject({ phase: 'slice-reporting', sliceFrom: 'sha-0', sliceDispatchedAt: '', slicedAt: '' })
    expect(planStep(entered, world({ tickets: open, tip: 'sha-1' }))).toEqual({ kind: 'dispatchSlice' })
    const dispatched = { ...entered, sliceDispatchedAt: AT }
    expect(planStep(dispatched, world({ tickets: open, tip: 'sha-1' })).kind).toBe('wait')
    const reported = { ...dispatched, slicedAt: AT, sliceDoc: 'DOC-9' }
    expect(planStep(reported, world({ tickets: open, tip: 'sha-1' }))).toEqual({ kind: 'sliceDone', tip: 'sha-1' })
    const idle = finishSlice(reported, 'sha-1', AT)
    expect(idle).toMatchObject({ phase: 'idle', lastSliceDoc: 'DOC-9', sliceDoc: '', checkpoints: { start: 'sha-0', slice: 'sha-1' } })
    // Next tick the step starts, and its record names the report its sessions read.
    expect(planStep(idle, world({ tickets: open, tip: 'sha-1' }))).toMatchObject({ kind: 'enterPlanStep', phase: 'implementing', tickets: ['T-2'] })
    const started = enterPlanStep(idle, { kind: 'enterPlanStep', phase: 'implementing', tickets: ['T-2'], prs: [], baseSha: 'sha-1', tip: 'sha-1' }, AT)
    expect(advancePlan({ ...started, stepStartedAt: AT }, AT, 'sha-2').planLog[0]).toMatchObject({ stepId: 's3', sliceDoc: 'DOC-9' })
  })
})

describe('group runners — an orchestrator group with its own subagent model and effort', () => {
  const orch: PlanDispatch = { mode: 'orchestrated', model: 'opus', effort: 'high', budget: 2, orchestrators: 1 }
  const keys = ['T-1', 'T-2', 'T-3', 'T-4', 'T-5']

  it('coerces one runner per group by position, null where the group has none (or is empty)', () => {
    const step = coerceRunPlan({
      steps: [
        {
          id: 's1',
          kind: 'implement',
          tickets: keys,
          dispatch: orch,
          groups: [['T-1', 'T-2'], ['T-3']],
          groupRunners: [{ model: 'sonnet', effort: 'low' }, 'nope'],
        },
      ],
    })!.steps[0]!
    expect(step.groupRunners).toEqual([{ model: 'sonnet', effort: 'low' }, null])
    // The runner of whichever group holds the key; a solo key or a group without one gets the step's.
    expect(groupRunnerOf(step, 'T-2', orch)).toEqual({ model: 'sonnet', effort: 'low' })
    expect(groupRunnerOf(step, 'T-3', orch)).toEqual({ model: 'opus', effort: 'high' })
    expect(groupRunnerOf(step, 'T-5', orch)).toEqual({ model: 'opus', effort: 'high' })
    // Entries drop an empty box and keep each group's runner with it; a bogus model falls back to the step's.
    const boxed = coerceRunPlan({
      steps: [{ id: 's1', kind: 'implement', tickets: keys, dispatch: orch, groups: [[], ['T-4']], groupRunners: [{ model: 'haiku', effort: 'low' }, { model: 'bogus', effort: 'max' }] }],
    })!.steps[0]!
    expect(boxed.groupRunners).toEqual([null, { model: 'opus', effort: 'max' }])
    expect(groupRunnerOf(boxed, 'T-4', orch)).toEqual({ model: 'opus', effort: 'max' })
    expect(stepGroupEntries(step, orch)).toEqual([
      { tickets: ['T-1', 'T-2'], runner: { model: 'sonnet', effort: 'low' } },
      { tickets: ['T-3'], runner: { model: 'opus', effort: 'high' } },
    ])
    // A plan from before group runners has none.
    expect(coerceRunPlan({ steps: [{ id: 's1', kind: 'implement', tickets: ['T-1'], groups: [['T-1']] }] })!.steps[0]!.groupRunners).toEqual([null])
  })

  it('the summary tallies the subagents by runner, and says the queue pace when there are more own agents than sessions', () => {
    const step = s('s1', 'implement', { tickets: keys, dispatch: orch, groups: [['T-1', 'T-2'], ['T-3']], groupRunners: [{ model: 'sonnet', effort: 'low' }, null] })
    expect(implementSummary(step, orch)).toBe(
      '2 tickets each with its own agent (2 on Opus 5.5 high) — none can run beside 2 orchestrators, beside 2 Fable 5.1 orchestrators working 3 tickets through subagents (2 on Sonnet 5.5 low, 1 on Opus 5.5 high), 2 in flight each.',
    )
    const mixed = s('s1', 'implement', { tickets: keys, dispatch: orch, groups: [['T-1']] })
    expect(implementSummary(mixed, orch)).toBe(
      '4 tickets each with its own agent (4 on Opus 5.5 high), 3 at once in queue order, beside 1 Fable 5.1 orchestrator working 1 ticket through Opus 5.5 high subagents, 2 in flight each.',
    )
    const same = s('s1', 'implement', { tickets: ['T-1', 'T-2'], dispatch: orch, groups: [['T-1', 'T-2']] })
    expect(implementSummary(same, orch)).toBe('1 Fable 5.1 orchestrator working 2 tickets through Opus 5.5 high subagents, 2 in flight each.')
  })

  it("each orchestrator slot runs its group's runner; a slot off a plan step runs the phase's", () => {
    const run = { mode: 'sessions' as const, model: 'opus' as const, effort: 'high' as const, budget: 2, orchestrators: 1 }
    const eight = ['T-1', 'T-2', 'T-3', 'T-4', 'T-5', 'T-6', 'T-7', 'T-8']
    const step = s('s1', 'implement', { tickets: eight, dispatch: orch, groups: [['T-1', 'T-2', 'T-3', 'T-4'], ['T-5', 'T-6', 'T-7', 'T-8']], groupRunners: [{ model: 'sonnet', effort: 'low' }, null] })
    const st = running(plan(step), {
      orchestration: run,
      phase: 'implementing',
      cursor: 0,
      tickets: eight,
      // Shares come from groupShares — T-2 was HITL, so slot 0 holds the other three.
      orchestrators: [{ ...newOrchestrator(1, ['T-1', 'T-3', 'T-4']), dispatchedAt: AT }, { ...newOrchestrator(1, ['T-5', 'T-6', 'T-7', 'T-8']), dispatchedAt: AT }],
    })
    expect(slotRunner(st, 0)).toEqual({ model: 'sonnet', effort: 'low' })
    expect(slotRunner(st, 1)).toEqual({ model: 'opus', effort: 'high' })
    expect(slotRunner(st, 7)).toEqual({ model: 'opus', effort: 'high' })
    // The plain loop: every slot on the run's setting.
    const loop = { ...newAutoLoop(AT), enabled: true, orchestration: { ...run, mode: 'orchestrated' as const }, phase: 'implementing' as const, tickets: keys, orchestrators: [{ ...newOrchestrator(1, keys), dispatchedAt: AT }] }
    expect(slotRunner(loop, 0)).toEqual({ model: 'opus', effort: 'high' })
  })
})
