import { describe, expect, it } from 'vitest'
import {
  claimVerdict,
  coerceAutoLoop,
  coerceOrchestration,
  finishLoop,
  finishedReviews,
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
} from '../app/utils/autoLoop'

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

  it('waits out an unreachable jReview but pauses on a vanished review', () => {
    const asked = reviewing({ reviewRequestedAt: AT, reviewKey: 'r1' })
    expect(planStep(asked, world({ tip: 'sha-new', review: 'unreachable' })).kind).toBe('wait')
    expect(planStep(asked, world({ tip: 'sha-new', review: 'missing' }))).toMatchObject({ kind: 'pause', reason: 'review-failed' })
  })

  it('pauses when a review was requested but its key never recorded', () => {
    expect(planStep(reviewing({ reviewRequestedAt: AT }), world({ tip: 'sha-new' }))).toMatchObject({ kind: 'pause', reason: 'review-failed' })
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
  const orch = { mode: 'orchestrated' as const, budget: 2 }
  const running = (patch: Partial<AutoLoop> = {}) =>
    loop({
      orchestration: orch,
      phase: 'implementing',
      tickets: ['T-1', 'T-2', 'T-3'],
      orchestrator: { ...newOrchestrator(1), dispatchedAt: AT, agent: 'orchestrate-p-1' },
      ...patch,
    })
  const open = [t('T-1', { status: 'in_progress', claimed: true }), t('T-2'), t('T-3')]

  it('starts one orchestrator for the phase instead of a session per ticket', () => {
    const fresh = loop({ orchestration: orch, phase: 'implementing', tickets: ['T-1', 'T-2'] })
    expect(planStep(fresh, world({ tickets: [t('T-1'), t('T-2')] }))).toEqual({ kind: 'dispatchOrchestrator' })
    const fixing = loop({ orchestration: orch, phase: 'fixing', fixTickets: ['T-5'] })
    expect(planStep(fixing, world({ tickets: [t('T-5')] }))).toEqual({ kind: 'dispatchOrchestrator' })
  })

  it('waits on a working orchestrator — and on one herdr has nothing to say about', () => {
    expect(planStep(running(), world({ tickets: open, orchestrator: 'working' }))).toMatchObject({ kind: 'wait', pending: ['T-1', 'T-2', 'T-3'] })
    expect(planStep(running(), world({ tickets: open }))).toMatchObject({ kind: 'wait' })
  })

  it('moves on to the merge like sessions mode once every ticket is finished', () => {
    const done = [t('T-1', { status: 'done' }), t('T-2', { status: 'done' }), t('T-3', { status: 'done' })]
    const prs = [{ key: 'PR-1', ticketKey: 'T-1', status: 'open' as const }]
    expect(planStep(running(), world({ tickets: done, prs, orchestrator: 'working' }))).toEqual({ kind: 'enterMerge', prs: ['PR-1'] })
  })

  it('notes a stopped orchestrator, nudges it after STALL_NUDGE_MS, replaces it STALL_FORCE_MS after the nudge', () => {
    const w = (state: AutoLoop, m: number, seen: 'stopped' | 'working' = 'stopped') =>
      planStep(state, world({ tickets: open, orchestrator: seen, now: T0 + m * min }))
    expect(w(running(), 0)).toEqual({ kind: 'watchOrchestrator', stoppedSince: AT })
    const stopped = running({ orchestrator: { ...running().orchestrator, watch: { stoppedSince: AT, nudgedAt: '' } } })
    expect(w(stopped, 0, 'working')).toEqual({ kind: 'watchOrchestrator', stoppedSince: '' })
    expect(w(stopped, 4).kind).toBe('wait')
    expect(w(stopped, 5)).toEqual({ kind: 'nudgeOrchestrator' })
    const nudged = running({ orchestrator: { ...running().orchestrator, watch: { stoppedSince: AT, nudgedAt: iso(T0 + 5 * min) } } })
    expect(w(nudged, 14).kind).toBe('wait')
    expect(w(nudged, 15)).toMatchObject({ kind: 'restartOrchestrator' })
  })

  it('replaces a vanished orchestrator after AGENT_GONE_MS', () => {
    const gone = running({ orchestrator: { ...running().orchestrator, watch: { stoppedSince: AT, nudgedAt: '' } } })
    expect(planStep(gone, world({ tickets: open, orchestrator: 'gone', now: T0 + 30_000 })).kind).toBe('wait')
    expect(planStep(gone, world({ tickets: open, orchestrator: 'gone', now: T0 + min }))).toMatchObject({ kind: 'restartOrchestrator' })
  })

  it(`pauses once ${ORCHESTRATOR_MAX_RUNS} orchestrators stopped short; Retry step starts a fresh one and frees their tickets`, () => {
    const spent = running({ orchestrator: newOrchestrator(ORCHESTRATOR_MAX_RUNS), dispatched: { 'T-1': AT } })
    expect(planStep(spent, world({ tickets: open }))).toMatchObject({ kind: 'pause', reason: 'orchestrator-failed' })
    const next = retryStep({ ...spent, paused: { reason: 'orchestrator-failed', detail: 'x', at: AT } }, { tickets: open })
    expect(next.orchestrator.runs).toBe(0)
    expect(next.dispatched).toEqual({})
    expect(planStep(next, world({ tickets: open }))).toEqual({ kind: 'dispatchOrchestrator' })
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
    expect(next.orchestrator).toEqual(newOrchestrator())
    expect(next.history.at(-1)).toMatchObject({ loop: 2, orchestrated: true })
    expect(coerceAutoLoop({ enabled: true, orchestration: orch })!.orchestration).toEqual(orch)
    expect(coerceAutoLoop({ enabled: true })!.orchestration).toEqual({ mode: 'sessions', budget: 2 })
    expect(coerceOrchestration({ mode: 'orchestrated', budget: 99 })).toEqual({ mode: 'orchestrated', budget: 4 })
    expect(coerceOrchestration({ mode: 'weird', budget: 0 })).toEqual({ mode: 'sessions', budget: 1 })
    expect(coerceOrchestration(null)).toBeNull()
  })

  it("closes a finished phase's orchestrator pane like the loop's other jobs", () => {
    const panes: HerdrPaneSeen[] = [{ paneId: 'p1', tabLabel: 'P-1 · orchestrate', paneLabel: 'P-1 · orchestrate', agentStatus: 'idle' }]
    expect(panesToClean(panes, { projectKey: 'P-1', doneTickets: new Set(), finishedReviews: new Set() })).toEqual(['p1'])
  })
})

describe('panesToClean', () => {
  const pane = (paneId: string, tabLabel: string, paneLabel: string, agentStatus = 'unknown'): HerdrPaneSeen => ({
    paneId,
    tabLabel,
    paneLabel,
    agentStatus,
  })
  const ctx = { projectKey: 'PROJ-4', doneTickets: new Set(['T-1', 'T-2']), finishedReviews: new Set(['proj-4-auto-loop-1-app']) }

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

  it("closes a finished review's reviewer and triage tabs, not a live review's", () => {
    const panes = [
      pane('p1', 'review proj-4-auto-loop-1-app', 'reviewer 1 · x', 'done'),
      pane('p2', 'review proj-4-auto-loop-1-app · 2', 'reviewer 3 · x'),
      pane('p3', 'triage proj-4-auto-loop-1-app 2', 'consensus · x', 'idle'),
      pane('p4', 'review proj-4-auto-loop-2-app', 'reviewer 1 · x', 'done'),
      pane('p5', 'review proj-4-auto-loop-1-app-2', 'reviewer 1 · x', 'done'),
    ]
    expect(panesToClean(panes, ctx)).toEqual(['p1', 'p2', 'p3'])
  })

  it("counts this loop's review finished only once the loop has left the review phase", () => {
    const history = [{ loop: 1, tickets: [], fixTickets: [], reviewKey: 'r-1', startedAt: AT, endedAt: AT }]
    expect([...finishedReviews(loop({ phase: 'reviewing', reviewKey: 'r-2', history }))]).toEqual(['r-1'])
    expect([...finishedReviews(loop({ phase: 'fixing', reviewKey: 'r-2', history }))]).toEqual(['r-1', 'r-2'])
  })
})
