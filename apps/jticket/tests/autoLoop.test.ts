import { beforeAll, describe, expect, it, vi } from 'vitest'
import {
  FIX_SESSIONS_MAX,
  claimVerdict,
  coerceAutoLoop,
  coerceOrchestration,
  effectiveOrchestration,
  finishLoop,
  isMergePhase,
  MERGE_PHASES,
  newAutoLoop,
  panesToClean,
  NO_PR_RECHECK_MS,
  ORCHESTRATOR_MAX_RUNS,
  newOrchestrator,
  planStep,
  retryStep,
  type AutoLoop,
  type AutoWorld,
  type AutoWorldTicket,
  type HerdrPaneSeen,
  type PlanStepRecord,
  finishPlan,
  planResumePoint,
  resumePlanRun,
  withPlanHistory,
  splitShares,
  inFlightOf,
  slotTickets,} from '../app/utils/autoLoop'

import { newPlanStep, type PlanStep, type PlanStepKind, type RunPlan } from '../app/utils/runPlan'

const AT = '2026-09-24T00:00:00.000Z'

function loop(patch: Partial<AutoLoop> = {}): AutoLoop {
  return { ...newAutoLoop(AT), enabled: true, ...patch }
}
function t(key: string, patch: Partial<AutoWorldTicket> = {}): AutoWorldTicket {
  return { key, status: 'todo', frontier: true, hitl: false, claimed: false, ...patch }
}
function world(patch: Partial<AutoWorld> = {}): AutoWorld {
  return { tickets: [], prs: [], tip: 'sha-base', review: null, now: Date.parse(AT), ...patch }
}

describe('planStep — idle', () => {
  it('starts a loop over the AFK frontier, in key order, based at the tip', () => {
    const step = planStep(loop(), world({ tickets: [t('T-10'), t('T-9'), t('T-3', { hitl: true }), t('T-4', { frontier: false })] }))
    expect(step).toEqual({ kind: 'startLoop', tickets: ['T-9', 'T-10'], baseSha: 'sha-base' })
  })

  it('pauses waiting on the human when only HITL tickets are on the frontier', () => {
    const step = planStep(loop(), world({ tickets: [t('T-1', { hitl: true }), t('T-2', { frontier: false })] }))
    expect(step).toMatchObject({ kind: 'pause', reason: 'waiting-human' })
    expect((step as any).detail).toContain('T-1')
  })

  it('stays waiting (no re-pause) while the human pause holds, and resumes by itself', () => {
    const paused = loop({ paused: { reason: 'waiting-human', detail: 'x', at: AT } })
    expect(planStep(paused, world({ tickets: [t('T-1', { hitl: true })] })).kind).toBe('wait')
    expect(planStep(paused, world({ tickets: [t('T-2')] }))).toMatchObject({ kind: 'startLoop', tickets: ['T-2'] })
  })

  it('moves on to the outcome report when no open work is left', () => {
    expect(planStep(loop(), world({ tickets: [t('T-1', { status: 'merged', frontier: false })] }))).toEqual({ kind: 'enterReport' })
  })

  it('writes the report even when a stop was requested, and with no branch to resolve', () => {
    const done = world({ tip: null, tickets: [t('T-1', { status: 'done', frontier: false })] })
    expect(planStep(loop({ stopRequested: true }), done)).toEqual({ kind: 'enterReport' })
  })

  it('completes with no report when the project has no tickets at all', () => {
    expect(planStep(loop(), world())).toEqual({ kind: 'complete' })
  })

  it('turns off straight away when a stop was requested between loops', () => {
    expect(planStep(loop({ stopRequested: true }), world({ tickets: [t('T-1')] }))).toEqual({ kind: 'turnOff' })
  })

  it('limits a one-loop run to its picked tickets', () => {
    const step = planStep(loop({ once: true, only: ['T-3', 'T-1'] }), world({ tickets: [t('T-1'), t('T-2'), t('T-3')] }))
    expect(step).toEqual({ kind: 'startLoop', tickets: ['T-1', 'T-3'], baseSha: 'sha-base' })
  })

  it('pauses when none of the picked tickets is on the AFK frontier any more', () => {
    const step = planStep(loop({ only: ['T-1'] }), world({ tickets: [t('T-1', { frontier: false, claimed: true }), t('T-2')] }))
    expect(step).toMatchObject({ kind: 'pause', reason: 'waiting-human' })
    expect((step as any).detail).toContain('T-1')
  })

  it('pauses when the integration branch does not resolve', () => {
    expect(planStep(loop(), world({ tip: null, tickets: [t('T-1')] }))).toMatchObject({ kind: 'pause', reason: 'no-branch' })
  })
})

describe('planStep — implementing / fixing', () => {
  const implementing = (patch: Partial<AutoLoop> = {}) => loop({ phase: 'implementing', tickets: ['T-1', 'T-2'], baseSha: 'sha-base', ...patch })

  it('dispatches loop tickets not yet dispatched', () => {
    expect(planStep(implementing(), world({ tickets: [t('T-1'), t('T-2')] }))).toEqual({ kind: 'dispatchTickets', keys: ['T-1', 'T-2'] })
  })

  it('never re-dispatches a ticket already claimed in `dispatched`', () => {
    const step = planStep(implementing({ dispatched: { 'T-1': AT } }), world({ tickets: [t('T-1'), t('T-2')] }))
    expect(step).toEqual({ kind: 'dispatchTickets', keys: ['T-2'] })
  })

  it('waits until every loop ticket is finished', () => {
    const step = planStep(
      implementing({ dispatched: { 'T-1': AT, 'T-2': AT } }),
      world({ tickets: [t('T-1', { status: 'done' }), t('T-2', { status: 'in_progress', claimed: true })] }),
    )
    expect(step).toEqual({ kind: 'wait', pending: ['T-2'] })
  })

  it("merges the loop tickets' open and conflicted PRs — and only theirs", () => {
    const step = planStep(
      implementing({ dispatched: { 'T-1': AT, 'T-2': AT } }),
      world({
        tickets: [t('T-1', { status: 'done' }), t('T-2', { status: 'done' })],
        prs: [
          { key: 'PR-4', ticketKey: 'T-2', status: 'conflicted' },
          { key: 'PR-3', ticketKey: 'T-1', status: 'open' },
          { key: 'PR-5', ticketKey: 'T-9', status: 'open' },
          { key: 'PR-1', ticketKey: 'T-1', status: 'closed' },
        ],
      }),
    )
    expect(step).toEqual({ kind: 'enterMerge', prs: ['PR-3', 'PR-4'] })
  })

  it('with no PRs, looks again twice 20s apart, then skips: implementing → review, fixing → finish', () => {
    const w = (ms: number) => world({ now: Date.parse(AT) + ms, tickets: [t('T-1', { status: 'done' }), t('T-2', { status: 'done' }), t('T-7', { status: 'done' })] })
    const impl = implementing({ dispatched: { 'T-1': AT, 'T-2': AT } })
    // First look: none — record it.
    expect(planStep(impl, w(0))).toEqual({ kind: 'recheckPrs' })
    // Inside the 20s window: wait.
    const once = { ...impl, prChecks: 1, prCheckAt: AT }
    expect(planStep(once, w(NO_PR_RECHECK_MS - 1)).kind).toBe('wait')
    // First retry at 20s: still none — record it.
    expect(planStep(once, w(NO_PR_RECHECK_MS))).toEqual({ kind: 'recheckPrs' })
    // Second retry at 40s: still none — skip.
    const twice = { ...impl, prChecks: 2, prCheckAt: new Date(Date.parse(AT) + NO_PR_RECHECK_MS).toISOString() }
    expect(planStep(twice, w(2 * NO_PR_RECHECK_MS - 1)).kind).toBe('wait')
    expect(planStep(twice, w(2 * NO_PR_RECHECK_MS))).toEqual({ kind: 'enterReview' })
    const fixing = loop({ phase: 'fixing', fixTickets: ['T-7'], dispatched: { 'T-7': AT }, prChecks: 2, prCheckAt: AT })
    expect(planStep(fixing, w(NO_PR_RECHECK_MS))).toEqual({ kind: 'finishLoop' })
  })

  it('merges a PR that shows up during the re-checks', () => {
    const once = implementing({ dispatched: { 'T-1': AT, 'T-2': AT }, prChecks: 1, prCheckAt: AT })
    const w = world({
      tickets: [t('T-1', { status: 'done' }), t('T-2', { status: 'done' })],
      prs: [{ key: 'PR-9', ticketKey: 'T-1', status: 'open' }],
    })
    expect(planStep(once, w)).toEqual({ kind: 'enterMerge', prs: ['PR-9'] })
  })

  it('treats a deleted ticket as finished rather than waiting forever', () => {
    const after = implementing({ dispatched: { 'T-1': AT, 'T-2': AT }, prChecks: 2, prCheckAt: AT })
    expect(planStep(after, world({ tickets: [], now: Date.parse(AT) + NO_PR_RECHECK_MS }))).toEqual({ kind: 'enterReview' })
  })
})

describe('planStep — merging', () => {
  const open = [{ key: 'PR-3', ticketKey: 'T-1', status: 'open' as const }, { key: 'PR-4', ticketKey: 'T-2', status: 'open' as const }]
  const landed = [{ key: 'PR-3', ticketKey: 'T-1', status: 'merged' as const }]

  it('dispatches the sweep once, then waits for its report — even once every PR landed', () => {
    const merging = loop({ phase: 'merging', prs: ['PR-3', 'PR-4'] })
    expect(planStep(merging, world({ prs: open }))).toEqual({ kind: 'dispatchMerge', prs: ['PR-3', 'PR-4'] })
    const dispatched = { ...merging, mergeDispatchedAt: AT }
    expect(planStep(dispatched, world({ prs: [landed[0]!, { key: 'PR-4', ticketKey: 'T-2', status: 'merged' }] }))).toMatchObject({
      kind: 'wait',
      pending: [],
    })
  })

  it('moves on once the sweep reported and all PRs landed: merging → review, merging-fixes → finish', () => {
    const reported = { prs: ['PR-3'], mergeDispatchedAt: AT, mergeReportedAt: AT, mergeReport: { unmerged: [] } }
    expect(planStep(loop({ phase: 'merging', ...reported }), world({ prs: landed }))).toEqual({ kind: 'enterReview' })
    expect(planStep(loop({ phase: 'merging-fixes', ...reported }), world({ prs: landed }))).toEqual({ kind: 'finishLoop' })
  })

  it('pauses when the sweep reported but a PR did not land, with its reason', () => {
    const state = loop({
      phase: 'merging',
      prs: ['PR-3', 'PR-4'],
      mergeDispatchedAt: AT,
      mergeReportedAt: AT,
      mergeReport: { unmerged: [{ pr: 'PR-4', reason: 'conflict in cart.ts' }] },
    })
    const step = planStep(state, world({ prs: [landed[0]!, { key: 'PR-4', ticketKey: 'T-2', status: 'conflicted' }] }))
    expect(step).toMatchObject({ kind: 'pause', reason: 'merge-incomplete' })
    expect((step as any).detail).toContain('PR-4: conflict in cart.ts')
  })

  it('skips the sweep when every PR already landed before it was dispatched', () => {
    expect(planStep(loop({ phase: 'merging', prs: ['PR-3'] }), world({ prs: landed }))).toEqual({ kind: 'enterReview' })
  })

  it('re-sweeps only the PRs still unmerged after a retry', () => {
    const state = loop({
      phase: 'merging',
      prs: ['PR-3', 'PR-4'],
      mergeDispatchedAt: AT,
      mergeReportedAt: AT,
      mergeReport: { unmerged: [{ pr: 'PR-4', reason: 'x' }] },
      paused: { reason: 'merge-incomplete', detail: 'x', at: AT },
    })
    const retried = retryStep(state, { tickets: [] })
    expect(retried).toMatchObject({ paused: null, mergeDispatchedAt: '', mergeReportedAt: '', mergeReport: null })
    expect(planStep(retried, world({ prs: [landed[0]!, { key: 'PR-4', ticketKey: 'T-2', status: 'conflicted' }] }))).toEqual({
      kind: 'dispatchMerge',
      prs: ['PR-4'],
    })
  })
})

describe('planStep — reviewing', () => {
  const reviewing = (patch: Partial<AutoLoop> = {}) => loop({ phase: 'reviewing', baseSha: 'sha-base', ...patch })

  it('skips the review when nothing landed this loop', () => {
    expect(planStep(reviewing(), world({ tip: 'sha-base' }))).toEqual({ kind: 'finishLoop' })
  })

  it('asks jReview for a review of the new commits', () => {
    expect(planStep(reviewing(), world({ tip: 'sha-new' }))).toEqual({ kind: 'startReview' })
  })

  it('waits for the consensus session, then fixes what it filed', () => {
    const asked = reviewing({ reviewRequestedAt: AT, reviewKey: 'r1' })
    expect(planStep(asked, world({ tip: 'sha-new', review: { status: 'triaging', ticketKeys: [] } }))).toEqual({ kind: 'wait', pending: ['r1'] })
    expect(planStep(asked, world({ tip: 'sha-new', review: { status: 'ticketed', ticketKeys: ['T-12', 'T-11'] } }))).toEqual({
      kind: 'enterFix',
      tickets: ['T-11', 'T-12'],
    })
  })

  it('finishes the loop when the reviewers agreed on nothing', () => {
    const asked = reviewing({ reviewRequestedAt: AT, reviewKey: 'r1' })
    expect(planStep(asked, world({ tip: 'sha-new', review: { status: 'ticketed', ticketKeys: [] } }))).toEqual({ kind: 'finishLoop' })
  })

  it('pauses on a vanished review', () => {
    const asked = reviewing({ reviewRequestedAt: AT, reviewKey: 'r1' })
    expect(planStep(asked, world({ tip: 'sha-new', review: 'missing' }))).toMatchObject({ kind: 'pause', reason: 'review-failed' })
  })

  it('pauses when a review was requested but its key never recorded', () => {
    expect(planStep(reviewing({ reviewRequestedAt: AT }), world({ tip: 'sha-new' }))).toMatchObject({ kind: 'pause', reason: 'review-failed' })
  })
})

describe('phaseStall — the watchdog for phases that wait on one session', () => {
  const T0 = Date.parse(AT)
  const min = 60_000
  const at = (m: number) => T0 + m * min
  const open = [{ key: 'PR-3', ticketKey: 'T-1', status: 'open' as const }]

  it('pauses a merge sweep silent past JOB_STALL_MS; Retry step re-dispatches it with a fresh clock', () => {
    const merging = loop({ phase: 'merging', prs: ['PR-3'], mergeDispatchedAt: AT })
    expect(planStep(merging, world({ prs: open, now: at(44) }))).toMatchObject({ kind: 'wait' })
    const stalled = planStep(merging, world({ prs: open, now: at(46) }))
    expect(stalled).toMatchObject({ kind: 'pause', reason: 'phase-stalled' })
    expect((stalled as any).detail).toContain('merge sweep')
    const retryAt = new Date(at(46)).toISOString()
    const retried = retryStep({ ...merging, paused: { reason: 'phase-stalled', detail: 'x', at: retryAt } }, { tickets: [] }, retryAt)
    expect(retried.phaseStartedAt).toBe(retryAt)
    expect(planStep(retried, world({ prs: open, now: at(47) }))).toEqual({ kind: 'dispatchMerge', prs: ['PR-3'] })
    // A sweep that reported back is never stalled, however old the phase.
    const reported = { ...merging, mergeReportedAt: AT, mergeReport: { unmerged: [] } }
    expect(planStep(reported, world({ prs: [{ key: 'PR-3', ticketKey: 'T-1', status: 'merged' }], now: at(500) }))).toEqual({ kind: 'enterReview' })
  })

  it('pauses a review with no verdict past REVIEW_STALL_MS — the arch pass too — and Retry step asks again', () => {
    const asked = loop({ phase: 'reviewing', baseSha: 'sha-base', reviewRequestedAt: AT, reviewKey: 'r1' })
    const pending = (m: number) => world({ tip: 'sha-new', review: { status: 'triaging', ticketKeys: [] }, now: at(m) })
    expect(planStep(asked, pending(89))).toEqual({ kind: 'wait', pending: ['r1'] })
    expect(planStep(asked, pending(91))).toMatchObject({ kind: 'pause', reason: 'phase-stalled' })
    const arch = { ...asked, phase: 'arch-reviewing' as const, archReviewKey: 'r1' }
    expect(planStep(arch, pending(91))).toMatchObject({ kind: 'pause', reason: 'phase-stalled' })
    expect(retryStep({ ...arch, paused: { reason: 'phase-stalled', detail: 'x', at: AT } }, { tickets: [] })).toMatchObject({ paused: null, reviewRequestedAt: '', reviewKey: null, archReviewKey: null })
    // arch-merging retries like the other merges.
    expect(retryStep(loop({ phase: 'arch-merging', mergeDispatchedAt: AT, mergeReportedAt: AT }), { tickets: [] })).toMatchObject({ mergeDispatchedAt: '', mergeReportedAt: '' })
  })

  it('pauses a slice or outcome report session silent past JOB_STALL_MS; nothing dispatched means no clock', () => {
    const slice = loop({ phase: 'slice-reporting', sliceDispatchedAt: AT, sliceFrom: 'sha-0' })
    expect(planStep(slice, world({ now: at(10) })).kind).toBe('wait')
    expect(planStep(slice, world({ now: at(46) }))).toMatchObject({ kind: 'pause', reason: 'phase-stalled' })
    expect(retryStep({ ...slice, paused: { reason: 'phase-stalled', detail: 'x', at: AT } }, { tickets: [] })).toMatchObject({ sliceDispatchedAt: '', slicedAt: '' })
    expect(planStep(loop({ phase: 'reporting', reportDispatchedAt: AT }), world({ now: at(46) }))).toMatchObject({ kind: 'pause', reason: 'phase-stalled' })
    expect(planStep(loop({ phase: 'reporting' }), world({ now: at(500) }))).toEqual({ kind: 'dispatchReport' })
  })
})

describe('recordMergeReport — a merge sweep reports back in every merge phase', () => {
  // The server engine leans on Nuxt's auto-imports for h3's createError and the
  // store's now(); stand them in so the function runs in-process.
  let recordMergeReport: typeof import('../server/utils/autoLoop').recordMergeReport
  beforeAll(async () => {
    vi.stubGlobal('createError', (e: { statusCode: number; statusMessage: string }) => Object.assign(new Error(e.statusMessage), e))
    vi.stubGlobal('now', () => AT)
    ;({ recordMergeReport } = await import('../server/utils/autoLoop'))
  })
  const project = (auto: AutoLoop) => ({ id: 'p1', key: 'PROJ-1', auto }) as any

  it.each(MERGE_PHASES)('records the report while the phase is %s', (phase) => {
    expect(isMergePhase(phase)).toBe(true)
    const auto = loop({ phase, prs: ['PR-3'], mergeDispatchedAt: AT })
    const recorded = recordMergeReport(project(auto), { unmerged: [{ pr: 'PR-3', reason: 'conflicts' }] })
    expect(recorded.mergeReportedAt).toBe(AT)
    expect(recorded.mergeReport).toEqual({ unmerged: [{ pr: 'PR-3', reason: 'conflicts' }] })
    // A repeat report is a no-op, not a 409.
    expect(recordMergeReport(project(recorded), { unmerged: [] }).mergeReport).toEqual({ unmerged: [{ pr: 'PR-3', reason: 'conflicts' }] })
  })

  it('409s when no sweep is out: a non-merge phase, nothing dispatched, or auto off', () => {
    const owed = /no auto-loop merge sweep is waiting/
    expect(() => recordMergeReport(project(loop({ phase: 'arch-fixing', mergeDispatchedAt: AT })), { unmerged: [] })).toThrow(owed)
    expect(() => recordMergeReport(project(loop({ phase: 'arch-merging' })), { unmerged: [] })).toThrow(owed)
    expect(() => recordMergeReport(project(loop({ phase: 'arch-merging', mergeDispatchedAt: AT, enabled: false })), { unmerged: [] })).toThrow(owed)
    expect(isMergePhase('arch-fixing')).toBe(false)
  })
})

describe('a fixing phase goes out in waves of FIX_SESSIONS_MAX', () => {
  it('dispatches three fix tickets, queues the rest, and sends the next as one finishes', () => {
    const fixes = ['T-11', 'T-12', 'T-13', 'T-14', 'T-15']
    const fixing = loop({ phase: 'fixing', fixTickets: fixes })
    expect(FIX_SESSIONS_MAX).toBe(3)
    expect(planStep(fixing, world({ tickets: fixes.map((k) => t(k)) }))).toEqual({ kind: 'dispatchTickets', keys: ['T-11', 'T-12', 'T-13'] })
    const three = { ...fixing, dispatched: { 'T-11': AT, 'T-12': AT, 'T-13': AT } }
    const busy = world({ tickets: fixes.map((k) => t(k, k <= 'T-13' ? { status: 'in_progress', claimed: true } : {})), agents: { 'T-11': 'working', 'T-12': 'working', 'T-13': 'working' } })
    expect(planStep(three, busy)).toMatchObject({ kind: 'wait', note: 'T-14, T-15 queued — start as a session frees' })
    const oneDone = world({ tickets: fixes.map((k) => t(k, k === 'T-12' ? { status: 'done' } : k <= 'T-13' ? { status: 'in_progress', claimed: true } : {})), agents: { 'T-11': 'working', 'T-13': 'working' } })
    expect(planStep(three, oneDone)).toEqual({ kind: 'dispatchTickets', keys: ['T-14'] })
  })
})

describe('pauses, retry, finish', () => {
  it('a failed-dispatch pause holds every step until Retry step', () => {
    const paused = loop({ phase: 'implementing', tickets: ['T-1'], paused: { reason: 'dispatch-failed', detail: 'boom', at: AT } })
    expect(planStep(paused, world({ tickets: [t('T-1')] })).kind).toBe('wait')
  })

  it('retry re-dispatches only tickets nobody claimed, and re-asks a sweep or review', () => {
    const state = loop({
      phase: 'implementing',
      tickets: ['T-1', 'T-2'],
      dispatched: { 'T-1': AT, 'T-2': AT },
      paused: { reason: 'dispatch-failed', detail: 'x', at: AT },
    })
    const next = retryStep(state, { tickets: [t('T-1'), t('T-2', { status: 'in_progress', claimed: true })] })
    expect(next.paused).toBeNull()
    expect(next.dispatched).toEqual({ 'T-2': AT })
    expect(retryStep(loop({ phase: 'merging', mergeDispatchedAt: AT }), { tickets: [] }).mergeDispatchedAt).toBe('')
    expect(retryStep(loop({ phase: 'reviewing', reviewRequestedAt: AT, reviewKey: 'r1' }), { tickets: [] })).toMatchObject({
      reviewRequestedAt: '',
      reviewKey: null,
    })
  })

  it('finishLoop records history and starts the next loop — or stops when asked', () => {
    const done = loop({ loop: 3, phase: 'merging-fixes', tickets: ['T-1'], fixTickets: ['T-5'], reviewKey: 'r1', loopStartedAt: AT })
    const next = finishLoop(done, '2026-09-24T01:00:00.000Z')
    expect(next).toMatchObject({ enabled: true, loop: 4, phase: 'idle', tickets: [], stopRequested: false })
    expect(next.history.at(-1)).toMatchObject({ loop: 3, tickets: ['T-1'], fixTickets: ['T-5'], reviewKey: 'r1' })

    // The stop carries into 'idle', which turns off — or reports first, if the project is done.
    const stopped = finishLoop({ ...done, stopRequested: true }, AT)
    expect(stopped).toMatchObject({ enabled: true, stopRequested: true, loop: 4, phase: 'idle' })
    expect(planStep(stopped, world({ tickets: [t('T-9')] }))).toEqual({ kind: 'turnOff' })
  })

  it('coerceAutoLoop survives junk and keeps what is usable', () => {
    expect(coerceAutoLoop(null)).toBeNull()
    const c = coerceAutoLoop({ enabled: true, phase: 'nonsense', loop: -1, tickets: ['T-1', 3], dispatched: { 'T-1': AT } })!
    expect(c).toMatchObject({ enabled: true, phase: 'idle', loop: 1, tickets: ['T-1'], dispatched: { 'T-1': AT } })
  })
})

describe('planStep — reporting', () => {
  const reporting = (patch: Partial<AutoLoop> = {}) => loop({ phase: 'reporting', ...patch })

  it('dispatches the report session once', () => {
    expect(planStep(reporting(), world())).toEqual({ kind: 'dispatchReport' })
  })

  it('waits for the session to report back, then completes', () => {
    expect(planStep(reporting({ reportDispatchedAt: AT }), world())).toMatchObject({ kind: 'wait' })
    expect(planStep(reporting({ reportDispatchedAt: AT, reportedAt: AT, reportDoc: 'DOC-4' }), world())).toEqual({ kind: 'complete' })
  })

  it('holds on a failed dispatch until Retry step, which re-dispatches', () => {
    const failed = reporting({ paused: { reason: 'dispatch-failed', detail: 'x', at: AT } })
    expect(planStep(failed, world()).kind).toBe('wait')
    const retried = retryStep(reporting({ reportDispatchedAt: AT, paused: failed.paused }), { tickets: [] })
    expect(retried).toMatchObject({ paused: null, reportDispatchedAt: '', reportedAt: '' })
    expect(planStep(retried, world())).toEqual({ kind: 'dispatchReport' })
  })

  it('coerceAutoLoop keeps the reporting phase and its stamps', () => {
    const c = coerceAutoLoop({ enabled: true, phase: 'reporting', reportDispatchedAt: AT, reportDoc: 'DOC-2' })!
    expect(c).toMatchObject({ phase: 'reporting', reportDispatchedAt: AT, reportedAt: '', reportDoc: 'DOC-2' })
  })
})

describe('planStep — the watchdog', () => {
  const T0 = Date.parse(AT)
  const min = 60_000
  const iso = (ms: number) => new Date(ms).toISOString()
  const implementing = (patch: Partial<AutoLoop> = {}) =>
    loop({ phase: 'implementing', tickets: ['T-1'], dispatched: { 'T-1': AT }, agents: { 'T-1': 't-1' }, ...patch })
  const open = [t('T-1', { status: 'in_progress', frontier: false, claimed: true })]

  it('leaves a working session alone', () => {
    expect(planStep(implementing(), world({ tickets: open, agents: { 'T-1': 'working' } }))).toMatchObject({ kind: 'wait', pending: ['T-1'] })
  })

  it('stands still when herdr has nothing to say about the session', () => {
    expect(planStep(implementing(), world({ tickets: open, agents: {} }))).toMatchObject({ kind: 'wait' })
  })

  it('notes when a session stops with its ticket open, and forgets it when it works again', () => {
    expect(planStep(implementing(), world({ tickets: open, agents: { 'T-1': 'stopped' } }))).toEqual({ kind: 'watch', key: 'T-1', stoppedSince: AT })
    const stopped = implementing({ watch: { 'T-1': { stoppedSince: AT, nudgedAt: '' } } })
    expect(planStep(stopped, world({ tickets: open, agents: { 'T-1': 'working' } }))).toEqual({ kind: 'watch', key: 'T-1', stoppedSince: '' })
  })

  it('nudges after STALL_NUDGE_MS stopped, once', () => {
    const stopped = implementing({ watch: { 'T-1': { stoppedSince: AT, nudgedAt: '' } } })
    expect(planStep(stopped, world({ tickets: open, agents: { 'T-1': 'stopped' }, now: T0 + 4 * min })).kind).toBe('wait')
    expect(planStep(stopped, world({ tickets: open, agents: { 'T-1': 'stopped' }, now: T0 + 5 * min }))).toEqual({ kind: 'nudge', key: 'T-1' })
  })

  it('closes the ticket when it stays stopped STALL_FORCE_MS after the nudge', () => {
    const nudged = implementing({ watch: { 'T-1': { stoppedSince: AT, nudgedAt: iso(T0 + 5 * min) } } })
    const at = (m: number) => planStep(nudged, world({ tickets: open, agents: { 'T-1': 'stopped' }, now: T0 + m * min }))
    expect(at(14).kind).toBe('wait')
    expect(at(15)).toMatchObject({ kind: 'forceClose', key: 'T-1' })
  })

  it('gives a nudged session that worked and stopped again the full STALL_FORCE_MS', () => {
    const again = implementing({ watch: { 'T-1': { stoppedSince: iso(T0 + 20 * min), nudgedAt: iso(T0 + 5 * min) } } })
    const at = (m: number) => planStep(again, world({ tickets: open, agents: { 'T-1': 'stopped' }, now: T0 + m * min }))
    expect(at(29).kind).toBe('wait')
    expect(at(30)).toMatchObject({ kind: 'forceClose', key: 'T-1' })
  })

  it('closes the ticket AGENT_GONE_MS after its session disappears', () => {
    const gone = implementing({ watch: { 'T-1': { stoppedSince: AT, nudgedAt: '' } } })
    expect(planStep(gone, world({ tickets: open, agents: { 'T-1': 'gone' }, now: T0 + 30_000 })).kind).toBe('wait')
    expect(planStep(gone, world({ tickets: open, agents: { 'T-1': 'gone' }, now: T0 + min }))).toMatchObject({ kind: 'forceClose', key: 'T-1' })
  })

  it('watches fix tickets too, and never a finished ticket', () => {
    const fixing = loop({ phase: 'fixing', fixTickets: ['T-5'], dispatched: { 'T-5': AT }, watch: { 'T-5': { stoppedSince: AT, nudgedAt: '' } } })
    expect(planStep(fixing, world({ tickets: [t('T-5', { status: 'in_progress' })], agents: { 'T-5': 'stopped' }, now: T0 + 5 * min }))).toEqual({ kind: 'nudge', key: 'T-5' })
    const done = [t('T-5', { status: 'done', frontier: false })]
    expect(planStep(fixing, world({ tickets: done, agents: { 'T-5': 'stopped' }, now: T0 + 60 * min })).kind).not.toBe('forceClose')
  })

  it('records forced tickets in the loop history', () => {
    const next = finishLoop(loop({ loop: 2, phase: 'merging', forced: ['T-1'] }), AT)
    expect(next.history.at(-1)).toMatchObject({ loop: 2, forced: ['T-1'] })
    expect(next.forced).toEqual([])
  })
})

describe('orchestrated mode', () => {
  const T0 = Date.parse(AT)
  const min = 60_000
  const iso = (ms: number) => new Date(ms).toISOString()
  const orch = { mode: 'orchestrated' as const, model: 'opus' as const, effort: 'high' as const, budget: 2, orchestrators: 1 }
  const running = (patch: Partial<AutoLoop> = {}) =>
    loop({
      orchestration: orch,
      phase: 'implementing',
      tickets: ['T-1', 'T-2', 'T-3', 'T-4'],
      orchestrators: [{ ...newOrchestrator(1, ['T-1', 'T-2', 'T-3', 'T-4']), dispatchedAt: AT, agent: 'orchestrate-p-1' }],
      ...patch,
    })
  const open = [t('T-1', { status: 'in_progress', claimed: true }), t('T-2'), t('T-3'), t('T-4')]

  it('starts one orchestrator for the phase instead of a session per ticket', () => {
    const fresh = loop({ orchestration: orch, phase: 'implementing', tickets: ['T-1', 'T-2', 'T-3', 'T-4'] })
    expect(planStep(fresh, world({ tickets: [t('T-1'), t('T-2'), t('T-3'), t('T-4')] }))).toEqual({ kind: 'dispatchOrchestrators', shares: [['T-1', 'T-2', 'T-3', 'T-4']] })
    const fixing = loop({ orchestration: orch, phase: 'fixing', fixTickets: ['T-5', 'T-6', 'T-7', 'T-8'] })
    expect(planStep(fixing, world({ tickets: [t('T-5'), t('T-6'), t('T-7'), t('T-8')] }))).toEqual({ kind: 'dispatchOrchestrators', shares: [['T-5', 'T-6', 'T-7', 'T-8']] })
  })

  it('runs a phase of fewer than GROUP_MIN tickets as plain sessions — an orchestrator with nothing to run side by side is overhead', () => {
    const three = loop({ orchestration: orch, phase: 'implementing', tickets: ['T-1', 'T-2', 'T-3'] })
    expect(effectiveOrchestration(three)).toEqual({ ...orch, mode: 'sessions', orchestrators: 1 })
    expect(planStep(three, world({ tickets: [t('T-1'), t('T-2'), t('T-3')] }))).toEqual({ kind: 'dispatchTickets', keys: ['T-1', 'T-2', 'T-3'] })
    const oneFix = loop({ orchestration: orch, phase: 'fixing', fixTickets: ['T-5'] })
    expect(planStep(oneFix, world({ tickets: [t('T-5')] }))).toEqual({ kind: 'dispatchTickets', keys: ['T-5'] })
    // Between phases the setting stands as picked.
    expect(effectiveOrchestration(loop({ orchestration: orch }))).toEqual(orch)
    // Never more orchestrators than GROUP_MIN-ticket shares.
    const six = ['T-1', 'T-2', 'T-3', 'T-4', 'T-5', 'T-6']
    expect(effectiveOrchestration(loop({ orchestration: { ...orch, orchestrators: 3 }, phase: 'implementing', tickets: six })).orchestrators).toBe(1)
  })

  it('waits on a working orchestrator — and on one herdr has nothing to say about', () => {
    expect(planStep(running(), world({ tickets: open, orchestrators: { 0: 'working' } }))).toMatchObject({ kind: 'wait', pending: ['T-1', 'T-2', 'T-3', 'T-4'] })
    expect(planStep(running(), world({ tickets: open }))).toMatchObject({ kind: 'wait' })
  })

  it('moves on to the merge like sessions mode once every ticket is finished', () => {
    const done = [t('T-1', { status: 'done' }), t('T-2', { status: 'done' }), t('T-3', { status: 'done' }), t('T-4', { status: 'done' })]
    const prs = [{ key: 'PR-1', ticketKey: 'T-1', status: 'open' as const }]
    expect(planStep(running(), world({ tickets: done, prs, orchestrators: { 0: 'working' } }))).toEqual({ kind: 'enterMerge', prs: ['PR-1'] })
  })

  it('notes a stopped orchestrator, nudges it after STALL_NUDGE_MS, replaces it STALL_FORCE_MS after the nudge', () => {
    const w = (state: AutoLoop, m: number, seen: 'stopped' | 'working' = 'stopped') =>
      planStep(state, world({ tickets: open, orchestrators: { 0: seen }, now: T0 + m * min }))
    const slot = (watch: { stoppedSince: string; nudgedAt: string }) => running({ orchestrators: [{ ...running().orchestrators[0]!, watch }] })
    expect(w(running(), 0)).toEqual({ kind: 'watchOrchestrator', index: 0, stoppedSince: AT })
    const stopped = slot({ stoppedSince: AT, nudgedAt: '' })
    expect(w(stopped, 0, 'working')).toEqual({ kind: 'watchOrchestrator', index: 0, stoppedSince: '' })
    expect(w(stopped, 4).kind).toBe('wait')
    expect(w(stopped, 5)).toEqual({ kind: 'nudgeOrchestrator', index: 0 })
    const nudged = slot({ stoppedSince: AT, nudgedAt: iso(T0 + 5 * min) })
    expect(w(nudged, 14).kind).toBe('wait')
    expect(w(nudged, 15)).toMatchObject({ kind: 'restartOrchestrator', index: 0 })
  })

  it('replaces a vanished orchestrator after AGENT_GONE_MS', () => {
    const gone = running({ orchestrators: [{ ...running().orchestrators[0]!, watch: { stoppedSince: AT, nudgedAt: '' } }] })
    expect(planStep(gone, world({ tickets: open, orchestrators: { 0: 'gone' }, now: T0 + 30_000 })).kind).toBe('wait')
    expect(planStep(gone, world({ tickets: open, orchestrators: { 0: 'gone' }, now: T0 + min }))).toMatchObject({ kind: 'restartOrchestrator', index: 0 })
  })

  it(`pauses once ${ORCHESTRATOR_MAX_RUNS} orchestrators stopped short; Retry step starts a fresh one and frees their tickets`, () => {
    const spent = running({ orchestrators: [newOrchestrator(ORCHESTRATOR_MAX_RUNS, ['T-1', 'T-2', 'T-3', 'T-4'])], dispatched: { 'T-1': AT } })
    expect(planStep(spent, world({ tickets: open }))).toMatchObject({ kind: 'pause', reason: 'orchestrator-failed' })
    const next = retryStep({ ...spent, paused: { reason: 'orchestrator-failed', detail: 'x', at: AT } }, { tickets: open })
    expect(next.orchestrators[0]!.runs).toBe(0)
    expect(next.dispatched).toEqual({})
    expect(planStep(next, world({ tickets: open }))).toEqual({ kind: 'dispatchOrchestrator', index: 0 })
  })

  describe('several orchestrators side by side', () => {
    const two = { ...orch, orchestrators: 2, budget: 1 }
    // Two orchestrators need two GROUP_MIN-ticket shares.
    const keys = ['T-1', 'T-2', 'T-3', 'T-4', 'T-5', 'T-6', 'T-7', 'T-8']
    const all = keys.map((k) => t(k))
    const shares = [['T-1', 'T-3', 'T-5', 'T-7'], ['T-2', 'T-4', 'T-6', 'T-8']]
    const both = (patch: Partial<AutoLoop> = {}) =>
      loop({
        orchestration: two,
        phase: 'implementing',
        tickets: keys,
        orchestrators: shares.map((share, i) => ({ ...newOrchestrator(1, share), dispatchedAt: AT, agent: `o-${i}` })),
        ...patch,
      })

    it('shares the phase out round-robin — never more orchestrators than tickets', () => {
      expect(splitShares(['T-3', 'T-1', 'T-2', 'T-10'], 2)).toEqual([['T-1', 'T-3'], ['T-2', 'T-10']])
      expect(splitShares(['T-1'], 3)).toEqual([['T-1']])
      expect(splitShares([], 2)).toEqual([[]])
      const fresh = loop({ orchestration: two, phase: 'implementing', tickets: keys })
      expect(planStep(fresh, world({ tickets: all }))).toEqual({ kind: 'dispatchOrchestrators', shares })
      // A HITL ticket in the phase is nobody's share.
      const withHuman = loop({ orchestration: two, phase: 'implementing', tickets: [...keys, 'T-9'] })
      expect(planStep(withHuman, world({ tickets: [...all, t('T-9', { hitl: true })] }))).toEqual({ kind: 'dispatchOrchestrators', shares })
    })

    it('each orchestrator has its own budget, and only its own tickets', () => {
      const st = both({ dispatched: { 'T-1': AT } })
      // Orchestrator 1 is full (budget 1); orchestrator 2 is free.
      expect(claimVerdict(st, { tickets: all }, 'T-3')).toMatchObject({ ok: false, wait: true })
      expect(claimVerdict(st, { tickets: all }, 'T-2')).toEqual({ ok: true, again: false })
      // Claiming as the wrong orchestrator is refused outright.
      expect(claimVerdict(st, { tickets: all }, 'T-2', 0)).toMatchObject({ ok: false, status: 409, wait: false })
      expect(claimVerdict(st, { tickets: all }, 'T-2', 1)).toEqual({ ok: true, again: false })
      expect(inFlightOf(st, { tickets: all }, 0)).toEqual(['T-1'])
      expect(inFlightOf(st, { tickets: all }, 1)).toEqual([])
      expect(slotTickets(st, 1, keys)).toEqual(['T-2', 'T-4', 'T-6', 'T-8'])
    })

    it('watches each one on its own: the second stalling is the step, the first working is left alone', () => {
      const w = (state: AutoLoop, seen: Record<number, 'working' | 'stopped' | 'gone'>, m = 0) =>
        planStep(state, world({ tickets: all, orchestrators: seen, now: T0 + m * min }))
      expect(w(both(), { 0: 'working', 1: 'working' })).toMatchObject({ kind: 'wait' })
      expect(w(both(), { 0: 'working', 1: 'stopped' })).toEqual({ kind: 'watchOrchestrator', index: 1, stoppedSince: AT })
      const stalled = both({ orchestrators: both().orchestrators.with(1, { ...both().orchestrators[1]!, watch: { stoppedSince: AT, nudgedAt: '' } }) })
      expect(w(stalled, { 0: 'working', 1: 'stopped' }, 5)).toEqual({ kind: 'nudgeOrchestrator', index: 1 })
      expect(w(stalled, { 0: 'working', 1: 'gone' }, 1)).toMatchObject({ kind: 'restartOrchestrator', index: 1 })
      // A slot whose share is all finished needs nothing, whatever herdr says.
      const halfDone = keys.map((k) => t(k, Number(k.slice(2)) % 2 ? { status: 'done' } : {}))
      expect(planStep(both(), world({ tickets: halfDone, orchestrators: { 0: 'gone', 1: 'working' }, now: T0 + 60 * min }))).toMatchObject({ kind: 'wait', pending: ['T-2', 'T-4', 'T-6', 'T-8'] })
    })

    it('a replaced slot is re-dispatched alone, with its share; Retry step frees only slots without a session', () => {
      const replaced = both({ orchestrators: both().orchestrators.with(1, newOrchestrator(1, shares[1]!)), dispatched: { 'T-1': AT, 'T-2': AT } })
      expect(planStep(replaced, world({ tickets: all, orchestrators: { 0: 'working' } }))).toEqual({ kind: 'dispatchOrchestrator', index: 1 })
      // T-1 is being worked under orchestrator 1 (kept); T-2 was orchestrator 2's, which has no session (freed).
      const working = [t('T-1', { status: 'in_progress', claimed: true }), t('T-2', { status: 'in_progress', claimed: true }), t('T-3'), t('T-4')]
      const next = retryStep({ ...replaced, paused: { reason: 'orchestrator-failed', detail: 'x', at: AT } }, { tickets: working })
      expect(next.dispatched).toEqual({ 'T-1': AT })
      expect(next.orchestrators.map((o) => o.runs)).toEqual([0, 0])
    })
  })

  it('claims hold the budget: phase tickets only, never past `budget` in flight, a repeat claim handed back', () => {
    const state = running({ dispatched: { 'T-1': AT } })
    expect(claimVerdict(state, { tickets: open }, 'T-2')).toEqual({ ok: true, again: false })
    expect(claimVerdict(state, { tickets: open }, 'T-1')).toEqual({ ok: true, again: true })
    const full = running({ dispatched: { 'T-1': AT, 'T-2': AT } })
    expect(claimVerdict(full, { tickets: open }, 'T-3')).toMatchObject({ ok: false, status: 409, wait: true })
    // A finished ticket frees its place.
    const oneDone = [t('T-1', { status: 'done' }), t('T-2'), t('T-3')]
    expect(claimVerdict(full, { tickets: oneDone }, 'T-3')).toEqual({ ok: true, again: false })
    expect(claimVerdict(full, { tickets: oneDone }, 'T-1')).toMatchObject({ ok: false, wait: false })
    expect(claimVerdict(state, { tickets: open }, 'T-9')).toMatchObject({ ok: false, status: 404 })
    expect(claimVerdict(loop({ phase: 'implementing', tickets: ['T-1'] }), { tickets: open }, 'T-1')).toMatchObject({ ok: false, status: 409 })
    expect(claimVerdict(running({ phase: 'merging' }), { tickets: open }, 'T-2')).toMatchObject({ ok: false, status: 409 })
  })

  it('the setting survives loops and restarts, and is coerced into range', () => {
    const next = finishLoop(running({ loop: 2 }), AT)
    expect(next.orchestration).toEqual(orch)
    expect(next.orchestrators).toEqual([])
    expect(next.history.at(-1)).toMatchObject({ loop: 2, orchestrated: true })
    expect(coerceAutoLoop({ enabled: true, orchestration: orch })!.orchestration).toEqual(orch)
    expect(coerceAutoLoop({ enabled: true })!.orchestration).toEqual({ mode: 'sessions', model: 'opus', effort: 'high', budget: 2, orchestrators: 1 })
    expect(coerceOrchestration({ mode: 'orchestrated', model: 'sonnet', effort: 'low', budget: 99, orchestrators: 9 })).toEqual({ mode: 'orchestrated', model: 'sonnet', effort: 'low', budget: 4, orchestrators: 4 })
    // A budget under BUDGET_MIN is lifted: one subagent at a time is pure overhead.
    expect(coerceOrchestration({ mode: 'weird', model: 'gpt', effort: 'extreme', budget: 0 })).toEqual({ mode: 'sessions', model: 'opus', effort: 'high', budget: 2, orchestrators: 1 })
    expect(coerceOrchestration({ mode: 'orchestrated', model: 'opus', effort: 'high', budget: 1, orchestrators: 1 })!.budget).toBe(2)
    // A run from before orchestrators ran side by side keeps its one orchestrator, with the whole phase.
    const legacy = coerceAutoLoop({ enabled: true, phase: 'implementing', tickets: ['T-1', 'T-2'], orchestrator: { dispatchedAt: AT, agent: 'o', paneId: 'p', runs: 1 } })!
    expect(legacy.orchestrators).toEqual([{ ...newOrchestrator(1, ['T-1', 'T-2']), dispatchedAt: AT, agent: 'o', paneId: 'p' }])
    expect(coerceAutoLoop({ enabled: true, orchestrator: { dispatchedAt: '' } })!.orchestrators).toEqual([])
    expect(coerceOrchestration(null)).toBeNull()
  })

  it("closes a finished phase's orchestrator pane like the loop's other jobs", () => {
    const panes: HerdrPaneSeen[] = [{ paneId: 'p1', tabLabel: 'P-1 · orchestrate', paneLabel: 'P-1 · orchestrate', agentStatus: 'idle' }]
    expect(panesToClean(panes, { projectKey: 'P-1', doneTickets: new Set() })).toEqual(['p1'])
  })
})

describe('panesToClean', () => {
  const pane = (paneId: string, tabLabel: string, paneLabel: string, agentStatus = 'unknown'): HerdrPaneSeen => ({
    paneId,
    tabLabel,
    paneLabel,
    agentStatus,
  })
  const ctx = { projectKey: 'PROJ-4', doneTickets: new Set(['T-1', 'T-2']) }

  it("closes a done ticket's pane and the loop's job panes in the project's tabs", () => {
    const panes = [
      pane('p1', 'PROJ-4', 'T-1 · Add the thing'),
      pane('p2', 'PROJ-4 · 2', 'T-2 · Other', 'idle'),
      pane('p3', 'PROJ-4 · merge 3', 'PROJ-4 · merge', 'done'),
      pane('p4', 'PROJ-4 · outcome report', 'PROJ-4 · outcome report'),
    ]
    expect(panesToClean(panes, ctx)).toEqual(['p1', 'p2', 'p3', 'p4'])
  })

  it('keeps working/blocked agents, open tickets, unlabelled panes and jobs the loop does not run', () => {
    const panes = [
      pane('p1', 'PROJ-4', 'T-1 · still wrapping up', 'working'),
      pane('p2', 'PROJ-4', 'T-2 · asking permission', 'blocked'),
      pane('p3', 'PROJ-4 · T-3', 'T-3 · HITL, waiting on the human', 'idle'),
      pane('p4', 'PROJ-4 · merge 7', '', 'idle'),
      pane('p5', 'PROJ-4 · worktree', 'PROJ-4 · worktree', 'idle'),
    ]
    expect(panesToClean(panes, ctx)).toEqual([])
  })

  it("never touches another project's tabs, even with a matching ticket key", () => {
    const panes = [pane('p1', 'PROJ-40', 'T-1 · x'), pane('p2', 'PROJ-40 · merge', 'PROJ-4 · merge'), pane('p3', 'notes', 'T-1 · x')]
    expect(panesToClean(panes, ctx)).toEqual([])
  })

  it("leaves every review's reviewer and triage tabs to the review watcher — the one sweep that closes them", () => {
    const panes = [
      pane('p1', 'review proj-4-auto-loop-1-app', 'reviewer 1 · x', 'done'),
      pane('p2', 'review proj-4-auto-loop-1-app · 2', 'reviewer 3 · x'),
      pane('p3', 'triage proj-4-auto-loop-1-app 2', 'consensus · x', 'idle'),
    ]
    expect(panesToClean(panes, ctx)).toEqual([])
  })
})

describe('run plan — continuing a stopped run', () => {
  const step = (id: string, kind: PlanStepKind, tickets: string[] = []): PlanStep => newPlanStep({ steps: [] }, kind, { id, tickets })
  const plan = (...steps: PlanStep[]): RunPlan => ({ steps })
  const THREE = plan(step('s1', 'implement', ['T-1']), step('s2', 'merge'), step('s3', 'implement', ['T-2']), step('s4', 'review'))
  const record = (stepId: string, kind: PlanStepKind, tickets: string[] = []): PlanStepRecord => ({ stepId, kind, tickets, fixTickets: [], prs: [], reviewKey: null, skipped: '', startedAt: AT, endedAt: AT })
  // Stopped while step 3 was implementing: steps 1–2 finished, checkpoints recorded.
  const midRun = (): AutoLoop =>
    loop({
      plan: THREE,
      cursor: 2,
      phase: 'implementing',
      tickets: ['T-2'],
      planLog: [record('s1', 'implement', ['T-1']), record('s2', 'merge')],
      checkpoints: { start: 'sha-0', s1: 'sha-1', s2: 'sha-2' },
      lastSliceDoc: 'DOC-9',
    })

  it('stopping leaves where it got to — the step it was in, the finished steps and the checkpoints', () => {
    const stopped = withPlanHistory(midRun(), AT)
    expect(stopped.resume).toMatchObject({ cursor: 2, checkpoints: { start: 'sha-0', s1: 'sha-1', s2: 'sha-2' }, lastSliceDoc: 'DOC-9', stoppedAt: AT })
    expect(stopped.resume!.planLog.map((r) => r.stepId)).toEqual(['s1', 's2'])
    expect(stopped.resume!.plan).toEqual(THREE)
    // The history record still counts the abandoned step as far as it got.
    expect(stopped.history.at(-1)!.plan!.map((r) => r.stepId)).toEqual(['s1', 's2', 's3'])
  })

  it('a run that never entered a step, or ran to the end, leaves nothing to continue', () => {
    expect(planResumePoint(loop({ plan: THREE, cursor: 0 }), AT)).toBeNull()
    expect(planResumePoint(loop({ plan: THREE, cursor: 4, checkpoints: { start: 'sha-0' } }), AT)).toBeNull()
    expect(finishPlan(midRun(), AT, false).resume).toBeNull()
  })

  it('the resume point outlives a plain loop in between, and survives the disk', () => {
    const stopped = withPlanHistory(midRun(), AT)
    expect(newAutoLoop(AT, stopped).resume).toEqual(stopped.resume)
    expect(coerceAutoLoop(JSON.parse(JSON.stringify(stopped)))!.resume).toEqual(stopped.resume)
  })

  it('an unedited plan continues at the step it stopped in, with the finished steps done', () => {
    const resume = withPlanHistory(midRun(), AT).resume!
    const start = resumePlanRun(resume, THREE)
    expect(start.cursor).toBe(2)
    expect(start.planLog.map((r) => r.stepId)).toEqual(['s1', 's2'])
    expect(start.checkpoints).toEqual({ start: 'sha-0', s1: 'sha-1', s2: 'sha-2' })
    expect(start.lastSliceDoc).toBe('DOC-9')
  })

  it('an edited plan is matched by step id — finished steps stay finished wherever they sit', () => {
    const resume = withPlanHistory(midRun(), AT).resume!
    // The merge step was taken out: the run continues at what is now step 2.
    const shorter = plan(step('s1', 'implement', ['T-1']), step('s3', 'implement', ['T-2']), step('s4', 'review'))
    expect(resumePlanRun(resume, shorter)).toMatchObject({ cursor: 1 })
    expect(resumePlanRun(resume, shorter).planLog.map((r) => r.stepId)).toEqual(['s1'])
    // A new step slotted in before the stopped one runs first; the finished steps before it stay done.
    const inserted = plan(step('s1', 'implement', ['T-1']), step('s2', 'merge'), step('s5', 'gate'), step('s3', 'implement', ['T-2']))
    expect(resumePlanRun(resume, inserted).cursor).toBe(2)
    // A finished step edited since (a ticket added) is new work: the run continues from it.
    const edited = plan(step('s1', 'implement', ['T-1', 'T-9']), step('s2', 'merge'), step('s3', 'implement', ['T-2']))
    expect(resumePlanRun(resume, edited)).toMatchObject({ cursor: 0, planLog: [] })
    // Every step the stopped run finished was removed: it starts over, but keeps the plan's start checkpoint.
    const fresh = plan(step('s9', 'implement', ['T-3']))
    expect(resumePlanRun(resume, fresh)).toMatchObject({ cursor: 0, planLog: [], checkpoints: { start: 'sha-0', s1: 'sha-1', s2: 'sha-2' } })
  })
})
