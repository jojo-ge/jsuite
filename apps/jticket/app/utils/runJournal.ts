// The run journal: what happened in an auto-mode run, as a list of events
// derived from two consecutive saves of a project's loop state (AutoLoop).
//
// The engine keeps only the present — `paused`, `watch`, `mergeReport` are
// overwritten as the run moves on — so nudges, pauses and replacements are
// gone by the time anyone asks how the run went. Nothing in the engine calls
// this: the store's save path diffs the state it is about to write against
// the state it last wrote (server/utils/runJournal.ts), so every writer —
// the loop, the API routes, a session reporting back — is covered by one
// rule, and an engine change can't forget to log.
//
// Pure: two states in, events out. See tests/runJournal.test.ts.
import type { AutoLoop, AutoOrchestrator, PlanStepRecord } from './autoLoop'
import { groupRunnerOf, runnerOf, type RunPlan, type Runner, type TicketPrediction } from './runPlan'

export type RunEventKind =
  | 'run-started'
  | 'run-ended'
  | 'loop-started'
  | 'loop-finished'
  /** The loop moved to another phase; `data.from`, `data.ms` = time in the phase left. */
  | 'phase'
  /** A run plan's step finished or was skipped — `data` is its record. */
  | 'step-finished'
  /** A ticket's own session was handed to herdr. */
  | 'dispatched'
  /** Its agent was seen stopped with the ticket still open (it may yet recover). */
  | 'ticket-stopped'
  /** The watchdog prompted a stopped session to finish. */
  | 'nudged'
  /** The watchdog closed the ticket itself. */
  | 'forced'
  | 'orchestrator-dispatched'
  /** A fresh orchestrator took over a slot whose session stalled or died. */
  | 'orchestrator-replaced'
  | 'orchestrator-nudged'
  | 'paused'
  /** A pause cleared (Retry step, or the HITL ticket it waited on closed); `data.ms` = how long it stood. */
  | 'resumed'
  | 'gate-passed'
  | 'stop-requested'
  | 'merge-dispatched'
  /** The sweep reported back; `data.unmerged` lists what it couldn't land. */
  | 'merge-reported'
  /** Every ticket finished with no PR to merge — the loop looked again. */
  | 'no-pr-look'
  | 'review-requested'
  /** A review's agreed findings became fix tickets. */
  | 'fix-tickets-filed'
  | 'slice-dispatched'
  | 'slice-reported'
  | 'report-dispatched'
  | 'report-reported'

export interface RunEvent {
  at: string
  kind: RunEventKind
  /** The loop (1-based) and phase the run was in once the change landed. */
  loop: number
  phase: string
  /** Run plan: the step in progress (index and id); -1 / '' for the plain loop. */
  step: number
  stepId: string
  /** The ticket the event is about ('' when it's about the run). */
  ticket: string
  /** 1-based orchestrator slot, 0 when not about one. */
  orchestrator: number
  /** One line for a human: the pause's detail, why a run ended, what was unmerged. */
  detail: string
  data?: Record<string, unknown>
}

const msBetween = (from: string, to: string): number | null => {
  const a = Date.parse(from)
  const b = Date.parse(to)
  return from && to && Number.isFinite(a) && Number.isFinite(b) ? Math.max(0, b - a) : null
}

/** A value that was set, or set to something else, between the two saves. */
const stamped = (before: string | null | undefined, after: string | null | undefined): after is string => !!after && after !== (before ?? '')

const added = (before: readonly string[] | undefined, after: readonly string[]): string[] => {
  const had = new Set(before ?? [])
  return after.filter((k) => !had.has(k))
}

function runKind(auto: AutoLoop): 'plan' | 'once' | 'loop' {
  return auto.plan ? 'plan' : auto.once ? 'once' : 'loop'
}

/** What a run plan intended for one ticket — frozen into `run-started`, since the plan can be edited afterwards. */
export interface PlannedTicket {
  stepId: string
  model: string
  effort: string
  /** In an orchestrator's group (its subagents run on the model above), not its own agent. */
  orchestrated: boolean
  /** The builder's bet — null on a plan built by hand, or by a builder that left it out. */
  prediction: TicketPrediction | null
}

/** Every implement-step ticket of `plan`, with who was to run it and what was expected of it. */
export function plannedTickets(plan: RunPlan | null, fallback: Runner): Record<string, PlannedTicket> {
  const out: Record<string, PlannedTicket> = {}
  for (const step of plan?.steps ?? []) {
    if (step.kind !== 'implement') continue
    for (const key of step.tickets) {
      const orchestrated = step.groups.some((g) => g.includes(key))
      const runner = orchestrated ? groupRunnerOf(step, key, fallback) : runnerOf(step, key, fallback)
      out[key] = { stepId: step.id, model: runner.model, effort: runner.effort, orchestrated, prediction: step.predictions?.[key] ?? null }
    }
  }
  return out
}

function stepRecordData(r: PlanStepRecord): Record<string, unknown> {
  return {
    stepId: r.stepId,
    kind: r.kind,
    skipped: r.skipped,
    tickets: r.tickets,
    fixTickets: r.fixTickets,
    prs: r.prs,
    reviewKey: r.reviewKey,
    archReviewKey: r.archReviewKey ?? null,
    forced: r.forced ?? [],
    sliceDoc: r.sliceDoc ?? '',
    startedAt: r.startedAt,
    endedAt: r.endedAt,
    ms: msBetween(r.startedAt, r.endedAt),
  }
}

/**
 * The events between two saves of one project's loop state. `before` is null
 * when the project had no loop state yet. `at` is the time of the save.
 *
 * Only additions count: a run that starts or ends resets most of the state,
 * and a reset is not an event — `run-started` / `run-ended` say it.
 */
export function journalEvents(before: AutoLoop | null, after: AutoLoop | null, at: string): RunEvent[] {
  if (!after) return []
  const wasOn = !!before?.enabled
  const isOn = after.enabled
  if (!wasOn && !isOn) return []

  const out: RunEvent[] = []
  const stepOf = (s: AutoLoop) => (s.plan ? { step: s.cursor, stepId: s.plan.steps[s.cursor]?.id ?? '' } : { step: -1, stepId: '' })
  const ev = (kind: RunEventKind, patch: Partial<RunEvent> = {}, of: AutoLoop = after) => {
    out.push({ at, kind, loop: of.loop, phase: of.phase, ...stepOf(of), ticket: '', orchestrator: 0, detail: '', ...patch })
  }

  // ── The run ends: the state was reset, so describe it from `before`. ──
  if (wasOn && !isOn) {
    const last = after.history.at(-1)
    const prev = before!.history.at(-1)
    // A plan run's steps are folded into its history record as it ends.
    if (last && (last.startedAt !== prev?.startedAt || last.endedAt !== prev?.endedAt)) {
      ev('loop-finished', { loop: last.loop, data: { tickets: last.tickets, fixTickets: last.fixTickets, forced: last.forced ?? [], reviewKey: last.reviewKey, startedAt: last.startedAt, endedAt: last.endedAt, ms: msBetween(last.startedAt, last.endedAt) } }, before!)
    }
    ev(
      'run-ended',
      {
        detail: after.ended?.reason ?? '',
        data: { reason: after.ended?.reason ?? '', pausedAs: before!.paused?.reason ?? '', pausedDetail: before!.paused?.detail ?? '', resumable: !!after.resume, phaseAtEnd: before!.phase },
      },
      before!,
    )
    return out
  }

  // ── The run starts. ──
  const started = !wasOn && isOn
  if (started) {
    ev('run-started', {
      detail: runKind(after),
      data: {
        kind: runKind(after),
        orchestration: after.orchestration,
        only: after.only,
        planSteps: after.plan?.steps.map((s) => ({ id: s.id, kind: s.kind })) ?? [],
        planned: plannedTickets(after.plan, after.orchestration),
        // A plan picked up where the last run stopped starts past step 1 with records carried over.
        resumedAt: after.plan && after.cursor > 0 ? after.cursor : 0,
      },
    })
  }
  const b: AutoLoop | null = started ? null : before

  // ── Loops and phases. ──
  // The engine stamps loopStartedAt as a loop's first phase begins (startLoop) —
  // a fresh state's own stamp, while still idle, is the run starting, not a loop.
  if (b && after.phase !== 'idle' && stamped(b.loopStartedAt, after.loopStartedAt)) ev('loop-started', { data: { tickets: after.tickets, baseSha: after.baseSha } })
  const lastRec = after.history.at(-1)
  const prevRec = b?.history.at(-1)
  if (b && lastRec && (lastRec.startedAt !== prevRec?.startedAt || lastRec.endedAt !== prevRec?.endedAt)) {
    ev('loop-finished', { loop: lastRec.loop, data: { tickets: lastRec.tickets, fixTickets: lastRec.fixTickets, forced: lastRec.forced ?? [], reviewKey: lastRec.reviewKey, startedAt: lastRec.startedAt, endedAt: lastRec.endedAt, ms: msBetween(lastRec.startedAt, lastRec.endedAt) } })
  }
  if (b && b.phase !== after.phase) ev('phase', { detail: `${b.phase} → ${after.phase}`, data: { from: b.phase, to: after.phase, ms: msBetween(b.phaseStartedAt, at) } })

  // ── Run plan steps (a resumed run's carried-over records are not news). ──
  if (b) {
    for (const r of after.planLog.slice(b.planLog.length)) ev('step-finished', { stepId: r.stepId, detail: r.skipped ? `skipped: ${r.skipped}` : r.kind, data: stepRecordData(r) })
  }

  // ── Ticket sessions and their watchdog. ──
  for (const [key, when] of Object.entries(after.dispatched)) {
    if (stamped(b?.dispatched[key], when)) ev('dispatched', { ticket: key, data: { agent: after.agents[key] ?? '' } })
  }
  for (const [key, w] of Object.entries(after.watch)) {
    const was = b?.watch[key]
    if (stamped(was?.stoppedSince, w.stoppedSince)) ev('ticket-stopped', { ticket: key })
    if (stamped(was?.nudgedAt, w.nudgedAt)) ev('nudged', { ticket: key, data: { stoppedMs: msBetween(w.stoppedSince, w.nudgedAt) } })
  }
  for (const key of added(b?.forced, after.forced)) ev('forced', { ticket: key })

  // ── Orchestrators: a slot dispatched again is a replacement. ──
  after.orchestrators.forEach((o: AutoOrchestrator, i) => {
    const was = b?.orchestrators[i]
    if (stamped(was?.dispatchedAt, o.dispatchedAt)) {
      ev(o.runs > 1 ? 'orchestrator-replaced' : 'orchestrator-dispatched', { orchestrator: i + 1, data: { runs: o.runs, tickets: o.tickets, agent: o.agent } })
    }
    if (stamped(was?.watch.nudgedAt, o.watch.nudgedAt)) ev('orchestrator-nudged', { orchestrator: i + 1, data: { tickets: o.tickets } })
  })

  // ── Pauses. ──
  const wasPaused = b?.paused ?? null
  if (after.paused && (wasPaused?.reason !== after.paused.reason || wasPaused.detail !== after.paused.detail)) {
    ev('paused', { detail: after.paused.detail, data: { reason: after.paused.reason } })
  }
  if (wasPaused && !after.paused) ev('resumed', { detail: wasPaused.reason, data: { reason: wasPaused.reason, ms: msBetween(wasPaused.at, at) } })
  if (b && !b.gatePassed && after.gatePassed) ev('gate-passed', { data: { ms: msBetween(after.phaseStartedAt, at) } })
  if (!b?.stopRequested && after.stopRequested) ev('stop-requested')

  // ── Merges. ──
  if (stamped(b?.mergeDispatchedAt, after.mergeDispatchedAt)) ev('merge-dispatched', { data: { prs: after.prs } })
  if (stamped(b?.mergeReportedAt, after.mergeReportedAt)) {
    const unmerged = after.mergeReport?.unmerged ?? []
    ev('merge-reported', { detail: unmerged.map((u) => `${u.pr}: ${u.reason}`).join('; ').slice(0, 500), data: { unmerged, ms: msBetween(after.mergeDispatchedAt, after.mergeReportedAt) } })
  }
  if (b && after.prChecks > b.prChecks) ev('no-pr-look', { data: { look: after.prChecks } })

  // ── Reviews and what they filed. ──
  if (stamped(b?.archReviewKey, after.archReviewKey)) ev('review-requested', { detail: after.archReviewKey, data: { reviewKey: after.archReviewKey, pass: 'architecture' } })
  if (stamped(b?.reviewKey, after.reviewKey)) ev('review-requested', { detail: after.reviewKey, data: { reviewKey: after.reviewKey, pass: 'consensus' } })
  const archFixes = added(b?.archTickets, after.archTickets)
  if (archFixes.length) ev('fix-tickets-filed', { detail: archFixes.join(', '), data: { tickets: archFixes, reviewKey: after.archReviewKey, pass: 'architecture' } })
  const fixes = added(b?.fixTickets, after.fixTickets)
  if (fixes.length) ev('fix-tickets-filed', { detail: fixes.join(', '), data: { tickets: fixes, reviewKey: after.reviewKey, pass: 'consensus' } })

  // ── Slice and outcome reports. ──
  if (stamped(b?.sliceDispatchedAt, after.sliceDispatchedAt)) ev('slice-dispatched')
  if (stamped(b?.slicedAt, after.slicedAt)) ev('slice-reported', { detail: after.sliceDoc, data: { doc: after.sliceDoc, ms: msBetween(after.sliceDispatchedAt, after.slicedAt) } })
  if (stamped(b?.reportDispatchedAt, after.reportDispatchedAt)) ev('report-dispatched')
  if (stamped(b?.reportedAt, after.reportedAt)) ev('report-reported', { detail: after.reportDoc, data: { doc: after.reportDoc, ms: msBetween(after.reportDispatchedAt, after.reportedAt) } })

  return out
}

/** One event as it sits in the journal file: stamped with whose run it was. */
export interface JournalLine extends RunEvent {
  /** `<PROJ-key>@<run start>` — stable for the whole run, across restarts. */
  runId: string
  projectId: string
  projectKey: string
  repo: string
}

/** `PROJ-3@20261108T100000Z` — safe in a URL path and a file name. */
export function newRunId(projectKey: string, startedAt: string): string {
  return `${projectKey}@${startedAt.replace(/\.\d+Z$/, 'Z').replace(/[-:]/g, '')}`
}

/** A run as the journal tells it: its events, and where it stands. */
export interface JournalRun {
  runId: string
  projectId: string
  projectKey: string
  repo: string
  kind: string
  startedAt: string
  /** '' while it is still running (or the server died mid-run). */
  endedAt: string
  endReason: string
  events: JournalLine[]
}

/** Group journal lines into runs, oldest first. */
export function journalRuns(lines: JournalLine[]): JournalRun[] {
  const runs = new Map<string, JournalRun>()
  for (const l of lines) {
    let run = runs.get(l.runId)
    if (!run) {
      run = { runId: l.runId, projectId: l.projectId, projectKey: l.projectKey, repo: l.repo, kind: '', startedAt: l.at, endedAt: '', endReason: '', events: [] }
      runs.set(l.runId, run)
    }
    run.events.push(l)
    if (l.kind === 'run-started') {
      run.startedAt = l.at
      run.kind = l.detail
    }
    if (l.kind === 'run-ended') {
      run.endedAt = l.at
      run.endReason = l.detail
    }
  }
  return [...runs.values()].sort((a, b) => a.startedAt.localeCompare(b.startedAt))
}

/** How many of each kind — the run's shape at a glance. */
export function eventCounts(events: RunEvent[]): Partial<Record<RunEventKind, number>> {
  const out: Partial<Record<RunEventKind, number>> = {}
  for (const e of events) out[e.kind] = (out[e.kind] ?? 0) + 1
  return out
}
