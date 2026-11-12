// The run journal's diff: two saves of a project's loop state in, the events
// between them out (app/utils/runJournal.ts).
import { describe, expect, it } from 'vitest'
import { newAutoLoop, type AutoLoop, type PlanStepRecord } from '../app/utils/autoLoop'
import { eventCounts, journalEvents, journalRuns, newRunId, plannedTickets, type JournalLine } from '../app/utils/runJournal'
import { coerceRunPlan, type RunPlan } from '../app/utils/runPlan'

const AT = '2026-11-08T10:00:00.000Z'
const later = (min: number) => new Date(Date.parse(AT) + min * 60_000).toISOString()
const on = (patch: Partial<AutoLoop> = {}): AutoLoop => ({ ...newAutoLoop(AT), enabled: true, ...patch })
const kinds = (before: AutoLoop | null, after: AutoLoop | null, at = later(1)) => journalEvents(before, after, at).map((e) => e.kind)

describe('journalEvents', () => {
  it('says nothing while auto mode is off', () => {
    expect(journalEvents(null, null, AT)).toEqual([])
    expect(journalEvents(null, newAutoLoop(AT), AT)).toEqual([])
    expect(journalEvents(newAutoLoop(AT), { ...newAutoLoop(AT), stopRequested: true }, AT)).toEqual([])
  })

  it('opens a run, naming what kind it is', () => {
    const [e, ...rest] = journalEvents(null, on(), AT)
    expect(rest).toEqual([])
    expect(e).toMatchObject({ at: AT, kind: 'run-started', detail: 'loop', loop: 1, phase: 'idle', step: -1, ticket: '' })
    expect(journalEvents(newAutoLoop(AT), on({ once: true }), AT)[0]).toMatchObject({ kind: 'run-started', detail: 'once' })
  })

  it('a run started and a loop begun are different saves — only the second is a loop', () => {
    const idle = on()
    const going = on({ phase: 'implementing', phaseStartedAt: later(1), loopStartedAt: later(1), tickets: ['T-1', 'T-2'], baseSha: 'abc' })
    const evs = journalEvents(idle, going, later(1))
    expect(evs.map((e) => e.kind)).toEqual(['loop-started', 'phase'])
    expect(evs[0]!.data).toEqual({ tickets: ['T-1', 'T-2'], baseSha: 'abc' })
    expect(evs[1]).toMatchObject({ detail: 'idle → implementing', data: { from: 'idle', to: 'implementing', ms: 60_000 } })
  })

  it('records each dispatch once, and again only when the ticket is dispatched afresh', () => {
    const a = on({ phase: 'implementing' })
    const b = { ...a, dispatched: { 'T-1': later(1) }, agents: { 'T-1': 'T-1' } }
    expect(journalEvents(a, b, later(1))).toMatchObject([{ kind: 'dispatched', ticket: 'T-1', data: { agent: 'T-1' } }])
    expect(kinds(b, { ...b, tickets: ['T-1'] })).toEqual([])
    expect(kinds(b, { ...b, dispatched: { 'T-1': later(9) } })).toEqual(['dispatched'])
  })

  it('follows the watchdog: stopped, nudged, forced', () => {
    const a = on({ phase: 'implementing', dispatched: { 'T-1': AT } })
    const stopped = { ...a, watch: { 'T-1': { stoppedSince: later(2), nudgedAt: '' } } }
    const nudged = { ...a, watch: { 'T-1': { stoppedSince: later(2), nudgedAt: later(7) } } }
    const forced = { ...nudged, forced: ['T-1'] }
    expect(kinds(a, stopped)).toEqual(['ticket-stopped'])
    expect(journalEvents(stopped, nudged, later(7))).toMatchObject([{ kind: 'nudged', ticket: 'T-1', data: { stoppedMs: 5 * 60_000 } }])
    expect(journalEvents(nudged, forced, later(17))).toMatchObject([{ kind: 'forced', ticket: 'T-1' }])
    // Working again clears the watch — a reset is not an event.
    expect(kinds(nudged, { ...a, watch: { 'T-1': { stoppedSince: '', nudgedAt: '' } } })).toEqual([])
  })

  it('tells a replaced orchestrator from a first one, and a nudged one', () => {
    const slot = { tickets: ['T-1', 'T-2', 'T-3', 'T-4'], dispatchedAt: '', agent: '', paneId: '', runs: 0, watch: { stoppedSince: '', nudgedAt: '' } }
    const a = on({ phase: 'implementing', orchestrators: [slot] })
    const first = { ...a, orchestrators: [{ ...slot, dispatchedAt: later(1), agent: 'orch-1', runs: 1 }] }
    const nudged = { ...a, orchestrators: [{ ...first.orchestrators[0]!, watch: { stoppedSince: later(5), nudgedAt: later(10) } }] }
    const replaced = { ...a, orchestrators: [{ ...slot, dispatchedAt: later(21), agent: 'orch-1b', runs: 2 }] }
    expect(journalEvents(a, first, later(1))).toMatchObject([{ kind: 'orchestrator-dispatched', orchestrator: 1, data: { runs: 1 } }])
    expect(kinds(first, nudged)).toEqual(['orchestrator-nudged'])
    expect(journalEvents(nudged, replaced, later(21))).toMatchObject([{ kind: 'orchestrator-replaced', orchestrator: 1, data: { runs: 2, agent: 'orch-1b' } }])
  })

  it('keeps a pause — reason, detail and how long it stood — though the state forgets it', () => {
    const a = on({ phase: 'merging' })
    const paused = { ...a, paused: { reason: 'merge-incomplete' as const, detail: 'PR-3: conflict in a.ts', at: later(5) } }
    expect(journalEvents(a, paused, later(5))).toMatchObject([{ kind: 'paused', detail: 'PR-3: conflict in a.ts', data: { reason: 'merge-incomplete' } }])
    expect(kinds(paused, { ...paused, prChecks: 0 })).toEqual([])
    expect(journalEvents(paused, a, later(35))).toMatchObject([{ kind: 'resumed', detail: 'merge-incomplete', data: { ms: 30 * 60_000 } }])
    // The same pause with a new detail is a new pause.
    expect(kinds(paused, { ...paused, paused: { ...paused.paused, detail: 'PR-4: conflict' } })).toEqual(['paused'])
  })

  it('records merges, the no-PR looks, reviews and the fix tickets they filed', () => {
    const a = on({ phase: 'merging' })
    const sweeping = { ...a, prs: ['PR-1', 'PR-2'], mergeDispatchedAt: later(1) }
    const swept = { ...sweeping, mergeReportedAt: later(4), mergeReport: { unmerged: [{ pr: 'PR-2', reason: 'conflict' }] } }
    expect(journalEvents(a, sweeping, later(1))).toMatchObject([{ kind: 'merge-dispatched', data: { prs: ['PR-1', 'PR-2'] } }])
    expect(journalEvents(sweeping, swept, later(4))).toMatchObject([{ kind: 'merge-reported', detail: 'PR-2: conflict', data: { ms: 3 * 60_000 } }])
    expect(kinds(a, { ...a, prChecks: 1 })).toEqual(['no-pr-look'])
    const reviewing = { ...a, reviewKey: 'rv1', reviewRequestedAt: later(5) }
    expect(journalEvents(a, reviewing, later(5))).toMatchObject([{ kind: 'review-requested', data: { reviewKey: 'rv1', pass: 'consensus' } }])
    expect(journalEvents(reviewing, { ...reviewing, fixTickets: ['T-8', 'T-9'] }, later(40))).toMatchObject([{ kind: 'fix-tickets-filed', data: { tickets: ['T-8', 'T-9'], reviewKey: 'rv1' } }])
    expect(journalEvents(a, { ...a, archReviewKey: 'ar1', archTickets: ['T-7'] }, later(5)).map((e) => [e.kind, e.data?.pass])).toEqual([
      ['review-requested', 'architecture'],
      ['fix-tickets-filed', 'architecture'],
    ])
  })

  it('records a plan step as it finishes, a gate passed, and the reports', () => {
    const rec: PlanStepRecord = { stepId: 's1', kind: 'implement', tickets: ['T-1'], fixTickets: [], prs: ['PR-1'], reviewKey: null, skipped: '', startedAt: AT, endedAt: later(30) }
    const a = on({ phase: 'gate', phaseStartedAt: later(30) })
    expect(journalEvents(a, { ...a, planLog: [rec] }, later(30))).toMatchObject([{ kind: 'step-finished', stepId: 's1', detail: 'implement', data: { ms: 30 * 60_000, tickets: ['T-1'] } }])
    expect(journalEvents(a, { ...a, planLog: [{ ...rec, skipped: 'nothing to do' }] }, later(30))[0]).toMatchObject({ detail: 'skipped: nothing to do' })
    expect(journalEvents(a, { ...a, gatePassed: true }, later(45))).toMatchObject([{ kind: 'gate-passed', data: { ms: 15 * 60_000 } }])
    expect(kinds(a, { ...a, sliceDispatchedAt: later(31) })).toEqual(['slice-dispatched'])
    expect(journalEvents({ ...a, sliceDispatchedAt: later(31) }, { ...a, sliceDispatchedAt: later(31), slicedAt: later(34), sliceDoc: 'DOC-9' }, later(34))).toMatchObject([{ kind: 'slice-reported', detail: 'DOC-9' }])
    expect(kinds(a, { ...a, reportDispatchedAt: later(50) })).toEqual(['report-dispatched'])
    expect(kinds(a, { ...a, stopRequested: true })).toEqual(['stop-requested'])
  })

  it('a resumed plan run does not replay the steps it carried over', () => {
    const rec: PlanStepRecord = { stepId: 's1', kind: 'implement', tickets: ['T-1'], fixTickets: [], prs: [], reviewKey: null, skipped: '', startedAt: AT, endedAt: later(30) }
    const plan = coerceRunPlan({ steps: [{ id: 's1', kind: 'implement', tickets: ['T-1'] }, { id: 's2', kind: 'merge' }] })!
    const evs = journalEvents(newAutoLoop(AT), on({ plan, cursor: 1, planLog: [rec] }), later(60))
    expect(evs.map((e) => e.kind)).toEqual(['run-started'])
    expect(evs[0]).toMatchObject({ detail: 'plan', step: 1, stepId: 's2', data: { resumedAt: 1 } })
  })

  it('closes a run from the state it left behind, whatever reset it', () => {
    const running = on({ phase: 'merging', loop: 2, paused: { reason: 'phase-stalled', detail: 'the sweep went silent', at: later(50) }, dispatched: { 'T-1': AT } })
    const off: AutoLoop = { ...newAutoLoop(later(60), running), ended: { reason: 'turned-off', at: later(60) } }
    const evs = journalEvents(running, off, later(60))
    expect(evs.map((e) => e.kind)).toEqual(['run-ended'])
    expect(evs[0]).toMatchObject({ detail: 'turned-off', loop: 2, phase: 'merging', data: { pausedAs: 'phase-stalled', phaseAtEnd: 'merging', resumable: false } })
  })

  it('a loop that finishes as the run ends is recorded before the end', () => {
    const running = on({ phase: 'merging-fixes' })
    const record = { loop: 1, tickets: ['T-1'], fixTickets: ['T-2'], forced: ['T-1'], reviewKey: 'rv1', startedAt: AT, endedAt: later(90) }
    const off: AutoLoop = { ...newAutoLoop(later(90), { ...running, history: [record] }), ended: { reason: 'complete', at: later(90) } }
    const evs = journalEvents(running, off, later(90))
    expect(evs.map((e) => e.kind)).toEqual(['loop-finished', 'run-ended'])
    expect(evs[0]).toMatchObject({ loop: 1, data: { forced: ['T-1'], reviewKey: 'rv1', ms: 90 * 60_000 } })
  })
})

describe('plannedTickets — what the plan intended, frozen as the run starts', () => {
  const plan: RunPlan = coerceRunPlan({
    steps: [
      {
        id: 's1',
        kind: 'implement',
        tickets: ['T-1', 'T-2', 'T-3', 'T-4', 'T-5', 'T-6'],
        dispatch: { mode: 'orchestrated', model: 'opus', effort: 'high', budget: 2, orchestrators: 1 },
        groups: [['T-3', 'T-4', 'T-5', 'T-6']],
        groupRunners: [{ model: 'sonnet', effort: 'low' }],
        runners: { 'T-1': { model: 'fable', effort: 'high' } },
        predictions: { 'T-1': { weight: 'heavy', minutes: 90, risk: 'high', why: 'reshapes the store contract' }, 'T-3': { weight: 'light', minutes: 10, risk: 'low', why: 'copy change' } },
      },
      { id: 's2', kind: 'merge' },
      { id: 's3', kind: 'implement', tickets: ['T-7'] },
    ],
  })!
  const fallback = { model: 'opus' as const, effort: 'medium' as const }

  it('names each ticket\'s runner — its own, its group\'s, the step\'s, or the run\'s — and its prediction', () => {
    const p = plannedTickets(plan, fallback)
    expect(Object.keys(p)).toEqual(['T-1', 'T-2', 'T-3', 'T-4', 'T-5', 'T-6', 'T-7'])
    expect(p['T-1']).toEqual({ stepId: 's1', model: 'fable', effort: 'high', orchestrated: false, prediction: { weight: 'heavy', minutes: 90, risk: 'high', why: 'reshapes the store contract' } })
    expect(p['T-2']).toEqual({ stepId: 's1', model: 'opus', effort: 'high', orchestrated: false, prediction: null })
    expect(p['T-3']).toMatchObject({ model: 'sonnet', effort: 'low', orchestrated: true, prediction: { weight: 'light', minutes: 10 } })
    expect(p['T-7']).toEqual({ stepId: 's3', model: 'opus', effort: 'medium', orchestrated: false, prediction: null })
    expect(plannedTickets(null, fallback)).toEqual({})
  })

  it('rides on run-started, so a later edit of the plan cannot rewrite what was expected', () => {
    const [e] = journalEvents(newAutoLoop(AT), on({ plan }), AT)
    expect(e).toMatchObject({ kind: 'run-started', detail: 'plan' })
    expect((e!.data!.planned as any)['T-1'].prediction.minutes).toBe(90)
    expect((journalEvents(null, on(), AT)[0]!.data as any).planned).toEqual({})
  })
})

describe('journalRuns', () => {
  const line = (runId: string, kind: JournalLine['kind'], at: string, detail = ''): JournalLine => ({ runId, projectId: 'p1', projectKey: 'PROJ', repo: '/repo', at, kind, loop: 1, phase: 'idle', step: -1, stepId: '', ticket: '', orchestrator: 0, detail })

  it('groups lines into runs and reads each one\'s start, end and kind', () => {
    const r1 = newRunId('PROJ', AT)
    const r2 = newRunId('PROJ', later(120))
    const runs = journalRuns([line(r1, 'run-started', AT, 'plan'), line(r1, 'nudged', later(5)), line(r1, 'run-ended', later(60), 'plan-finished'), line(r2, 'run-started', later(120), 'loop')])
    expect(runs.map((r) => [r.runId, r.kind, r.startedAt, r.endedAt, r.endReason, r.events.length])).toEqual([
      [r1, 'plan', AT, later(60), 'plan-finished', 3],
      [r2, 'loop', later(120), '', '', 1],
    ])
    expect(eventCounts(runs[0]!.events)).toEqual({ 'run-started': 1, nudged: 1, 'run-ended': 1 })
  })
})
