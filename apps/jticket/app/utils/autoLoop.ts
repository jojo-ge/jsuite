// Auto mode — the loop the jButton turns on. Shared by the server (which
// drives it: server/utils/autoLoop.ts + plugins/autoLoop.ts) and the project
// page (which shows it). Pure: no Nuxt, no I/O — tests/autoLoop.test.ts.
//
// One loop:
//
//   implementing   the AFK frontier, snapshotted at loop start, each ticket
//                  dispatched into herdr (Opus); waits until all are finished.
//                  Finished with no PR in sight, it looks again twice, 20s
//                  apart, before deciding there is nothing to merge — an agent
//                  may still be opening one
//   merging        the merge sweep over those tickets' local PRs (Sonnet);
//                  waits for the sweep to report back (POST …/auto/merge-report),
//                  then moves on if every PR landed, or pauses if any didn't
//   reviewing      a 2-reviewer consensus review in jReview over this loop's
//                  diff (baseSha...integration tip); its consensus session
//                  files the findings BOTH reviewers raised as tickets here
//   fixing         those tickets dispatched (Opus); waits until finished
//   merging-fixes  the merge sweep over the fix PRs
//
// then the next loop starts from 'idle' — unless a stop was requested, in which
// case auto mode turns itself off. A one-loop run (the board's "Run as loop")
// is auto mode started with `once`: the loop it starts asks to stop at its own
// end, and `only` narrows that loop to the tickets the human picked. Every step with nothing to do is skipped
// (no PRs → no merge; no new commits → no review; no agreed findings → no fix).
//
// When 'idle' finds no open ticket left, the project is finished — even on a
// loop asked to stop — and one last phase runs before auto mode turns off:
//
//   reporting      an outcome report session (Opus) writes what the project
//                  built and how it works (≤500 words) as the project's
//                  'outcome'-labelled doc, then reports back
//                  (POST …/auto/outcome-report); the Graphs page shows it
//
// The watchdog (implementing / fixing): a ticket the loop dispatched must never
// hang unfinished and hold the loop. Each tick reads its herdr agent. Stopped
// (idle, done, blocked) with the ticket still open for STALL_NUDGE_MS → the
// loop prompts the session to finish. Still stopped STALL_FORCE_MS after that
// nudge, or its session gone for AGENT_GONE_MS → the loop closes the ticket
// itself (done, with a comment) and files the rest as a carryover ticket, so
// nothing is lost and the loop moves on. Hand-dispatched tickets are never
// watched — only the loop's own.
//
// Orchestration: how implementing / fixing hand their tickets to herdr.
// 'sessions' (the default) is the above — one session per ticket, all at
// once. 'orchestrated' trades wall clock for load: ONE Fable orchestrator
// session per phase (/jorchestrate) works the phase's tickets through Opus
// subagents inside its own claude process, deciding itself which to run side
// by side and which one after another. The server holds the cap: a ticket
// runs only once the orchestrator claims it (POST …/auto/claim), and a claim
// past `budget` tickets in flight is refused. Each subagent's work is
// spec-checked by the orchestrator before the ticket is marked done; the
// loop's review at the end stays as it is. The watchdog then watches the one
// orchestrator instead of each ticket: stopped with tickets open → nudged;
// still stopped, or gone → replaced by a fresh one (its in-flight tickets are
// un-claimed so the next one picks them up from their branches), at most
// ORCHESTRATOR_MAX_RUNS times a phase before the loop pauses.
//
// Run plans (app/utils/runPlan.ts): auto mode with a script. Started with
// `plan`, the run copies the project's Run setup plan into `plan` and walks it
// step by step instead of looping — `cursor` is the step in progress. Each step
// is one of the phases above with the human's parameters: implement is
// 'implementing' over the step's tickets (HITL ones are waited on, never
// dispatched; one not on the frontier yet waits), merge is 'merging' over the
// plan's open PRs, review is 'reviewing' from the step's checkpoint and always
// runs on through 'fixing' and 'merging-fixes', and gate is 'gate' until the
// human presses Continue. Where the loop would move to its next phase, a plan
// moves to its next step, recording the integration tip as that step's
// checkpoint (reviews name a checkpoint as their base). A step with nothing to
// do is skipped. After the last step the plan is done: the outcome report runs
// if no open ticket is left, and auto mode turns off.
//
// Cleanup: after every step that ends a phase, the loop closes the herdr
// panes it's finished with (panesToClean) so they don't stack up.
//
// The state lives on the project (project.auto in jticket.json), so the loop
// survives a restart and every change reaches the page over /api/stream.

import { coerceRunPlan, reviewBaseSha, type PlanStepKind, type RunPlan } from './runPlan'

export type AutoPhase = 'idle' | 'implementing' | 'merging' | 'reviewing' | 'fixing' | 'merging-fixes' | 'gate' | 'reporting'

export const AUTO_PHASES: ReadonlyArray<{ phase: Exclude<AutoPhase, 'idle'>; label: string }> = [
  { phase: 'implementing', label: 'Implement' },
  { phase: 'merging', label: 'Merge' },
  { phase: 'reviewing', label: 'Review' },
  { phase: 'fixing', label: 'Fix' },
  { phase: 'merging-fixes', label: 'Merge fixes' },
]

/** The once-per-project last phase — shown in place of the loop stepper while it runs. */
export const REPORT_PHASE = { phase: 'reporting', label: 'Outcome report' } as const

/** The label that marks a project's outcome report among its docs. */
export const OUTCOME_LABEL = 'outcome'

/** Upper bound on the outcome report's length — the report prompt holds the session to it. */
export const OUTCOME_WORD_LIMIT = 500

export type AutoPauseReason =
  /** Nothing AFK on the frontier, but open work remains (HITL or blocked) — clears itself. */
  | 'waiting-human'
  /** A herdr dispatch failed — Retry step. */
  | 'dispatch-failed'
  /** jReview couldn't start the review, or lost it — Retry step. */
  | 'review-failed'
  /** The merge sweep reported back with PRs still unmerged — Retry step sweeps them again. */
  | 'merge-incomplete'
  /** The project lost its repo or integration branch. */
  | 'no-branch'
  /** ORCHESTRATOR_MAX_RUNS orchestrators in a row stopped with tickets open — Retry step starts a fresh one. */
  | 'orchestrator-failed'

export interface AutoPause {
  reason: AutoPauseReason
  detail: string
  at: string
}

/** How implementing / fixing hand tickets to herdr — see the header. */
export type AutoMode = 'sessions' | 'orchestrated'

export interface AutoOrchestration {
  mode: AutoMode
  /** Orchestrated only: the most tickets in flight at once (claimed, not yet done). */
  budget: number
}

export const ORCHESTRATION_BUDGET_MAX = 4
export const DEFAULT_ORCHESTRATION: AutoOrchestration = { mode: 'sessions', budget: 2 }

/** The phase's orchestrator session (orchestrated mode). */
export interface AutoOrchestrator {
  /** When it was handed to herdr ('' = not yet, or replaced). Claimed before the dispatch. */
  dispatchedAt: string
  /** Its herdr agent name ('' until the dispatch returns). */
  agent: string
  paneId: string
  /** Orchestrators this phase has started — a replacement counts. */
  runs: number
  watch: AutoWatch
}

/** A phase that has started this many orchestrators, all of which stopped short, pauses. */
export const ORCHESTRATOR_MAX_RUNS = 3

/** What one step of a run plan did — kept on the run while it goes, then in its history record. */
export interface PlanStepRecord {
  stepId: string
  kind: PlanStepKind
  tickets: string[]
  fixTickets: string[]
  prs: string[]
  reviewKey: string | null
  forced?: string[]
  /** Why it was skipped ('' = it ran). */
  skipped: string
  startedAt: string
  endedAt: string
}

export interface AutoLoopRecord {
  loop: number
  tickets: string[]
  fixTickets: string[]
  /** Tickets the watchdog had to close itself. */
  forced?: string[]
  /** Set when the loop ran orchestrated. */
  orchestrated?: boolean
  /** Set when this was a run plan, not a loop: what each of its steps did. */
  plan?: PlanStepRecord[]
  reviewKey: string | null
  startedAt: string
  endedAt: string
}

export interface AutoLoop {
  enabled: boolean
  /** "Stop at the end of next loop" — the loop in progress finishes, then auto turns off. */
  stopRequested: boolean
  /** A one-loop run: the next loop to start turns this into stopRequested. */
  once: boolean
  /** Ticket keys the next loop is limited to ([] = the whole AFK frontier); cleared once it starts. */
  only: string[]
  /** How implementing / fixing dispatch — kept from run to run, set when the jButton starts it. */
  orchestration: AutoOrchestration
  /** 1-based; the loop in progress (or about to start, while idle). */
  loop: number
  phase: AutoPhase
  phaseStartedAt: string
  loopStartedAt: string
  paused: AutoPause | null
  /** The integration branch tip when this loop started — the review's base. */
  baseSha: string
  /** The loop's implementation tickets (the AFK frontier at loop start). */
  tickets: string[]
  /** Tickets the consensus review filed. */
  fixTickets: string[]
  /** ticketKey → when this loop handed it to herdr. Claimed before the dispatch, so a restart never dispatches twice. */
  dispatched: Record<string, string>
  /** ticketKey → the herdr agent name its session runs under (the watchdog reads it). */
  agents: Record<string, string>
  /** ticketKey → the watchdog's view of a dispatched ticket's session. */
  watch: Record<string, AutoWatch>
  /** Tickets the watchdog closed itself this loop. */
  forced: string[]
  /** Orchestrated mode: the current phase's orchestrator. */
  orchestrator: AutoOrchestrator
  /** The PRs the current merge sweep is landing. */
  prs: string[]
  /** How many times this phase's tickets were all finished with no PR to merge — see NO_PR_RETRIES. */
  prChecks: number
  /** When the last of those looks happened ('' = none yet). */
  prCheckAt: string
  /** When the current sweep was handed to herdr ('' = not yet). */
  mergeDispatchedAt: string
  /** When the sweep reported back that it's finished ('' = not yet) — the merge phase waits on it. */
  mergeReportedAt: string
  /** What the sweep said it couldn't land, and why. */
  mergeReport: AutoMergeReport | null
  /** When jReview was asked for this loop's review ('' = not yet). */
  reviewRequestedAt: string
  reviewKey: string | null
  /** When the outcome report session was handed to herdr ('' = not yet). */
  reportDispatchedAt: string
  /** When it reported back with its doc ('' = not yet) — the reporting phase waits on it. */
  reportedAt: string
  /** The outcome report doc it wrote (DOC-n), once reported. */
  reportDoc: string
  /** The run plan being walked (null = the plain loop). Steps after the cursor may still be edited. */
  plan: RunPlan | null
  /** Run plan: the index of the step in progress — or, while 'idle', about to start. */
  cursor: number
  /** Run plan: when the step in progress started. */
  stepStartedAt: string
  /** Run plan: the steps already finished (or skipped). */
  planLog: PlanStepRecord[]
  /** Run plan: stepId (or 'start') → the integration tip when it finished — a review's base. */
  checkpoints: Record<string, string>
  /** Run plan: the human pressed Continue on the gate in progress. */
  gatePassed: boolean
  history: AutoLoopRecord[]
  /** Why auto mode last turned itself off. */
  ended: null | { reason: 'stopped' | 'complete' | 'turned-off' | 'plan-finished'; at: string }
}

export interface AutoWatch {
  /** Since when its agent has been seen stopped with the ticket open ('' = working). */
  stoppedSince: string
  /** When the loop prompted it to finish ('' = not yet). One nudge per ticket. */
  nudgedAt: string
}

export interface AutoMergeReport {
  unmerged: Array<{ pr: string; reason: string }>
}

export const AUTO_HISTORY_CAP = 20

/**
 * Every ticket finished but no PR to merge: an agent may still be opening one
 * (it marks the ticket done and opens the PR moments apart). Look again this
 * many times, NO_PR_RECHECK_MS apart, before skipping the merge.
 */
export const NO_PR_RETRIES = 2
export const NO_PR_RECHECK_MS = 20_000

/** Stopped this long with its ticket still open → the session is prompted to finish. */
export const STALL_NUDGE_MS = 5 * 60_000
/** Stopped this long after the nudge (and at least this long since it) → the loop closes the ticket. */
export const STALL_FORCE_MS = 10 * 60_000
/** Its session gone (pane closed, claude exited) this long → the loop closes the ticket. */
export const AGENT_GONE_MS = 60_000

/** Marks the ticket the watchdog files for work a closed ticket left behind. */
export const CARRYOVER_LABEL = 'auto-loop:carryover'

export function newAutoLoop(at: string, prev?: AutoLoop | null): AutoLoop {
  return {
    enabled: false,
    stopRequested: false,
    once: false,
    only: [],
    orchestration: prev?.orchestration ?? { ...DEFAULT_ORCHESTRATION },
    loop: (prev?.history.at(-1)?.loop ?? 0) + 1,
    phase: 'idle',
    phaseStartedAt: at,
    loopStartedAt: at,
    paused: null,
    baseSha: '',
    tickets: [],
    fixTickets: [],
    dispatched: {},
    agents: {},
    watch: {},
    forced: [],
    orchestrator: newOrchestrator(),
    prs: [],
    prChecks: 0,
    prCheckAt: '',
    mergeDispatchedAt: '',
    mergeReportedAt: '',
    mergeReport: null,
    reviewRequestedAt: '',
    reviewKey: null,
    reportDispatchedAt: '',
    reportedAt: '',
    reportDoc: '',
    plan: null,
    cursor: 0,
    stepStartedAt: '',
    planLog: [],
    checkpoints: {},
    gatePassed: false,
    history: prev?.history ?? [],
    ended: prev?.ended ?? null,
  }
}

/** A phase's orchestrator before anything was dispatched — `runs` carries a count over. */
export function newOrchestrator(runs = 0): AutoOrchestrator {
  return { dispatchedAt: '', agent: '', paneId: '', runs, watch: { stoppedSince: '', nudgedAt: '' } }
}

/** An orchestration setting off the wire or the disk — null when there's nothing usable. */
export function coerceOrchestration(raw: any): AutoOrchestration | null {
  if (!raw || typeof raw !== 'object') return null
  const mode: AutoMode = raw.mode === 'orchestrated' ? 'orchestrated' : raw.mode === 'sessions' ? 'sessions' : DEFAULT_ORCHESTRATION.mode
  const n = Number(raw.budget)
  const budget = Number.isInteger(n) ? Math.min(ORCHESTRATION_BUDGET_MAX, Math.max(1, n)) : DEFAULT_ORCHESTRATION.budget
  return { mode, budget }
}

function coerceOrchestrator(raw: any): AutoOrchestrator {
  if (!raw || typeof raw !== 'object') return newOrchestrator()
  return {
    dispatchedAt: str(raw.dispatchedAt),
    agent: str(raw.agent),
    paneId: str(raw.paneId),
    runs: Number.isInteger(raw.runs) && raw.runs > 0 ? raw.runs : 0,
    watch: { stoppedSince: str(raw.watch?.stoppedSince), nudgedAt: str(raw.watch?.nudgedAt) },
  }
}

const PHASES: AutoPhase[] = ['idle', 'implementing', 'merging', 'reviewing', 'fixing', 'merging-fixes', 'gate', 'reporting']
const strs = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])
const str = (v: unknown) => (typeof v === 'string' ? v : '')

/** Whatever is on disk, made safe to drive — null when there's nothing usable. */
export function coerceAutoLoop(raw: any): AutoLoop | null {
  if (!raw || typeof raw !== 'object') return null
  const base = newAutoLoop(str(raw.phaseStartedAt) || new Date(0).toISOString())
  return {
    ...base,
    enabled: raw.enabled === true,
    stopRequested: raw.stopRequested === true,
    once: raw.once === true,
    only: strs(raw.only),
    orchestration: coerceOrchestration(raw.orchestration) ?? { ...DEFAULT_ORCHESTRATION },
    loop: Number.isInteger(raw.loop) && raw.loop > 0 ? raw.loop : 1,
    phase: PHASES.includes(raw.phase) ? raw.phase : 'idle',
    loopStartedAt: str(raw.loopStartedAt) || base.loopStartedAt,
    paused: raw.paused && typeof raw.paused === 'object' ? { reason: raw.paused.reason, detail: str(raw.paused.detail), at: str(raw.paused.at) } : null,
    baseSha: str(raw.baseSha),
    tickets: strs(raw.tickets),
    fixTickets: strs(raw.fixTickets),
    dispatched: raw.dispatched && typeof raw.dispatched === 'object' ? { ...raw.dispatched } : {},
    agents: raw.agents && typeof raw.agents === 'object' ? { ...raw.agents } : {},
    watch: coerceWatch(raw.watch),
    forced: strs(raw.forced),
    orchestrator: coerceOrchestrator(raw.orchestrator),
    prs: strs(raw.prs),
    prChecks: Number.isInteger(raw.prChecks) && raw.prChecks > 0 ? raw.prChecks : 0,
    prCheckAt: str(raw.prCheckAt),
    mergeDispatchedAt: str(raw.mergeDispatchedAt),
    mergeReportedAt: str(raw.mergeReportedAt),
    mergeReport: coerceMergeReport(raw.mergeReport),
    reviewRequestedAt: str(raw.reviewRequestedAt),
    reviewKey: str(raw.reviewKey) || null,
    reportDispatchedAt: str(raw.reportDispatchedAt),
    reportedAt: str(raw.reportedAt),
    reportDoc: str(raw.reportDoc),
    plan: coerceRunPlan(raw.plan),
    cursor: Number.isInteger(raw.cursor) && raw.cursor > 0 ? raw.cursor : 0,
    stepStartedAt: str(raw.stepStartedAt),
    planLog: Array.isArray(raw.planLog) ? raw.planLog.filter((r: any) => r && typeof r === 'object' && typeof r.stepId === 'string') : [],
    checkpoints:
      raw.checkpoints && typeof raw.checkpoints === 'object'
        ? Object.fromEntries(Object.entries(raw.checkpoints).filter((e): e is [string, string] => typeof e[1] === 'string'))
        : {},
    gatePassed: raw.gatePassed === true,
    history: Array.isArray(raw.history) ? raw.history.slice(-AUTO_HISTORY_CAP) : [],
    ended: raw.ended && typeof raw.ended === 'object' ? raw.ended : null,
  }
}

function coerceWatch(raw: any): Record<string, AutoWatch> {
  if (!raw || typeof raw !== 'object') return {}
  return Object.fromEntries(
    Object.entries(raw).map(([k, w]: [string, any]) => [k, { stoppedSince: str(w?.stoppedSince), nudgedAt: str(w?.nudgedAt) }]),
  )
}

/** A merge report off the wire or the disk — null when there's nothing usable. */
export function coerceMergeReport(raw: any): AutoMergeReport | null {
  if (!raw || typeof raw !== 'object') return null
  const unmerged = Array.isArray(raw.unmerged)
    ? raw.unmerged
        .map((u: any) => (typeof u === 'string' ? { pr: u, reason: '' } : { pr: str(u?.pr).trim(), reason: str(u?.reason).trim().slice(0, 300) }))
        .filter((u: { pr: string }) => u.pr)
    : []
  return { unmerged }
}

// ── The world, as one tick sees it ──────────────────────────────────────────

export interface AutoWorldTicket {
  key: string
  status: 'todo' | 'in_progress' | 'done' | 'merged'
  /** ticketIsFrontier — todo, unclaimed, unblocked, ours. */
  frontier: boolean
  hitl: boolean
  /** Assigned — an agent claimed it. */
  claimed: boolean
}

export interface AutoWorldPr {
  key: string
  ticketKey: string
  status: 'open' | 'conflicted' | 'merged' | 'closed'
}

export interface AutoWorld {
  /** The project's tickets. */
  tickets: AutoWorldTicket[]
  /** The project's local PRs. */
  prs: AutoWorldPr[]
  /** The integration branch tip; null when it doesn't resolve. */
  tip: string | null
  /**
   * This loop's jReview review: null when there is none to look at (no key
   * yet, or jReview says it's gone), 'unreachable' when jReview is down.
   */
  review: null | 'unreachable' | 'missing' | { status: string; ticketKeys: string[] }
  /** The tick's clock (ms since epoch) — paces the no-PR re-checks and the watchdog. */
  now: number
  /**
   * herdr's view of each open dispatched ticket's session: 'working', 'stopped'
   * (idle / done / blocked — its turn is over), or 'gone'. A ticket missing
   * here is unknown (herdr down, agent never recorded) and is left alone.
   */
  agents?: Record<string, AutoAgentSeen>
  /** Orchestrated mode: herdr's view of the phase's orchestrator — missing = unknown, left alone. */
  orchestrator?: AutoAgentSeen
}

export type AutoAgentSeen = 'working' | 'stopped' | 'gone'

export type AutoStep =
  | { kind: 'wait'; pending: string[]; note?: string }
  | { kind: 'pause'; reason: AutoPauseReason; detail: string }
  | { kind: 'complete' }
  | { kind: 'turnOff' }
  | { kind: 'startLoop'; tickets: string[]; baseSha: string }
  | { kind: 'dispatchTickets'; keys: string[] }
  | { kind: 'recheckPrs' }
  | { kind: 'enterMerge'; prs: string[] }
  | { kind: 'dispatchMerge'; prs: string[] }
  | { kind: 'enterReview' }
  | { kind: 'startReview' }
  | { kind: 'enterFix'; tickets: string[] }
  | { kind: 'finishLoop' }
  | { kind: 'enterReport' }
  | { kind: 'dispatchReport' }
  | { kind: 'watch'; key: string; stoppedSince: string }
  | { kind: 'nudge'; key: string }
  | { kind: 'forceClose'; key: string; reason: string }
  | { kind: 'dispatchOrchestrator' }
  | { kind: 'watchOrchestrator'; stoppedSince: string }
  | { kind: 'nudgeOrchestrator' }
  | { kind: 'restartOrchestrator'; reason: string }
  | { kind: 'enterPlanStep'; phase: 'implementing' | 'merging' | 'reviewing' | 'gate'; tickets: string[]; prs: string[]; baseSha: string; tip: string }
  | { kind: 'skipPlanStep'; reason: string; tip: string }
  | { kind: 'nextPlanStep'; tip: string }
  | { kind: 'finishPlan'; report: boolean }

const finished = (t: AutoWorldTicket | undefined) => !t || t.status === 'done' || t.status === 'merged'
const landed = (p: AutoWorldPr | undefined) => !p || p.status === 'merged' || p.status === 'closed'
const byKey = (a: string, b: string) => {
  const n = (k: string) => Number(k.split('-').pop())
  return n(a) - n(b) || a.localeCompare(b)
}

/**
 * The one decision a tick makes: given the loop's state and the world, what
 * happens next. Exactly one step per tick — the applier persists it, and the
 * next tick (seconds later) sees the result.
 */
export function planStep(state: AutoLoop, world: AutoWorld): AutoStep {
  // A pause the human has to clear (Retry step) holds everything; waiting on
  // the human's own tickets re-checks itself below.
  if (state.paused && state.paused.reason !== 'waiting-human') return { kind: 'wait', pending: [], note: state.paused.detail }

  const ticket = (k: string) => world.tickets.find((t) => t.key === k)
  // Where the loop would move on to its next phase, a run plan moves on to its next step.
  const plan = !!state.plan
  const nextStep: AutoStep = { kind: 'nextPlanStep', tip: world.tip ?? '' }

  switch (state.phase) {
    case 'idle': {
      if (plan) return planIdleStep(state, world)
      // No open ticket left: the project is finished — write its outcome
      // report, whether or not a stop was asked for (an empty project has
      // nothing to report).
      const open = world.tickets.filter((t) => !finished(t))
      if (!open.length) return world.tickets.length ? { kind: 'enterReport' } : { kind: 'complete' }
      // Between loops: nothing is in flight, so a stop takes effect now.
      if (state.stopRequested) return { kind: 'turnOff' }
      if (!world.tip) return { kind: 'pause', reason: 'no-branch', detail: 'the integration branch does not resolve in the repo' }
      const picked = (t: AutoWorldTicket) => !state.only.length || state.only.includes(t.key)
      const afk = world.tickets.filter((t) => t.frontier && !t.hitl && picked(t)).map((t) => t.key).sort(byKey)
      if (afk.length) return { kind: 'startLoop', tickets: afk, baseSha: world.tip }
      if (state.paused?.reason === 'waiting-human') return { kind: 'wait', pending: open.map((t) => t.key), note: state.paused.detail }
      if (state.only.length) {
        return {
          kind: 'pause',
          reason: 'waiting-human',
          detail: `none of the picked tickets (${state.only.join(', ')}) is on the AFK frontier any more — turn auto off and pick again`,
        }
      }
      const hitl = open.filter((t) => t.frontier && t.hitl).map((t) => t.key)
      return {
        kind: 'pause',
        reason: 'waiting-human',
        detail: hitl.length
          ? `only HITL tickets are on the frontier (${hitl.join(', ')}) — work them and the loop carries on`
          : `no AFK ticket is on the frontier — ${open.length} open ticket${open.length === 1 ? '' : 's'} are claimed or blocked`,
      }
    }

    case 'implementing':
    case 'fixing': {
      const keys = state.phase === 'implementing' ? state.tickets : state.fixTickets
      const pending = keys.filter((k) => !finished(ticket(k)))
      // A run plan's HITL tickets are the human's: waited on, never dispatched.
      const afk = pending.filter((k) => !ticket(k)?.hitl)
      if (state.orchestration.mode === 'orchestrated') {
        if (afk.length) return orchestratorStep(state, world, afk)
      } else {
        // A run plan's ticket goes out once it's on the frontier — one still
        // blocked, or claimed by hand, waits its turn.
        const toDispatch = afk.filter((k) => !state.dispatched[k] && (!plan || ticket(k)?.frontier))
        if (toDispatch.length) return { kind: 'dispatchTickets', keys: toDispatch }
        const watched = watchStep(state, world, pending)
        if (watched) return watched
      }
      if (pending.length) {
        const human = pending.filter((k) => ticket(k)?.hitl)
        const held = afk.filter((k) => !state.dispatched[k] && !ticket(k)?.frontier)
        const note = [
          human.length ? `waiting on you for ${human.join(', ')} (HITL)` : '',
          held.length ? `${held.join(', ')} ${held.length === 1 ? 'is' : 'are'} blocked or claimed — dispatched once free` : '',
        ].filter(Boolean).join('; ')
        return { kind: 'wait', pending, ...(note ? { note } : {}) }
      }
      const prs = world.prs
        .filter((p) => keys.includes(p.ticketKey) && (p.status === 'open' || p.status === 'conflicted'))
        .map((p) => p.key)
        .sort(byKey)
      // A run plan merges only where the human put a merge step.
      if (prs.length) return plan && state.phase === 'implementing' ? nextStep : { kind: 'enterMerge', prs }
      // No PR yet. Look again NO_PR_RETRIES times, NO_PR_RECHECK_MS apart,
      // before deciding this phase had nothing to merge.
      // (first look at 0s, retries at 20s and 40s; the 40s one skips).
      const due = state.prCheckAt ? Date.parse(state.prCheckAt) + NO_PR_RECHECK_MS : 0
      if (world.now < due) return { kind: 'wait', pending: [], note: 'every ticket is finished but no PR has shown up yet' }
      if (state.prChecks < NO_PR_RETRIES) return { kind: 'recheckPrs' }
      if (plan) return nextStep
      return state.phase === 'implementing' ? { kind: 'enterReview' } : { kind: 'finishLoop' }
    }

    case 'merging':
    case 'merging-fixes': {
      const next: AutoStep = plan ? nextStep : state.phase === 'merging' ? { kind: 'enterReview' } : { kind: 'finishLoop' }
      const pending = state.prs.filter((k) => !landed(world.prs.find((p) => p.key === k)))
      if (!state.mergeDispatchedAt) return pending.length ? { kind: 'dispatchMerge', prs: pending } : next
      // The sweep says when it's finished; until then it may still be rebasing.
      if (!state.mergeReportedAt) return { kind: 'wait', pending, note: 'waiting for the merge sweep to report back' }
      if (pending.length) {
        const why = (state.mergeReport?.unmerged ?? [])
          .filter((u) => pending.includes(u.pr) && u.reason)
          .map((u) => `${u.pr}: ${u.reason}`)
        return {
          kind: 'pause',
          reason: 'merge-incomplete',
          detail: `the merge sweep finished but ${pending.join(', ')} did not land${why.length ? ` (${why.join('; ')})` : ''} — Retry step sweeps ${pending.length === 1 ? 'it' : 'them'} again`,
        }
      }
      return next
    }

    case 'reviewing': {
      if (!state.reviewRequestedAt) {
        // Nothing landed this loop (every ticket finished without a PR) — nothing to review.
        if (world.tip && world.tip === state.baseSha) return plan ? nextStep : { kind: 'finishLoop' }
        return { kind: 'startReview' }
      }
      if (!state.reviewKey) {
        return { kind: 'pause', reason: 'review-failed', detail: 'jReview was asked for a review but its key was never recorded — Retry step asks again' }
      }
      if (world.review === 'unreachable') return { kind: 'wait', pending: [state.reviewKey], note: 'jReview is not reachable on :43008' }
      if (world.review === 'missing' || !world.review) {
        return { kind: 'pause', reason: 'review-failed', detail: `jReview no longer has review ${state.reviewKey} — Retry step starts a new one` }
      }
      if (world.review.status !== 'ticketed') return { kind: 'wait', pending: [state.reviewKey] }
      const fixes = [...world.review.ticketKeys].sort(byKey)
      return fixes.length ? { kind: 'enterFix', tickets: fixes } : plan ? nextStep : { kind: 'finishLoop' }
    }

    case 'gate': {
      if (state.gatePassed) return nextStep
      const note = state.plan?.steps[state.cursor]?.note
      return { kind: 'wait', pending: [], note: `gate — press Continue when you're ready${note ? `: ${note}` : ''}` }
    }

    case 'reporting': {
      if (!state.reportDispatchedAt) return { kind: 'dispatchReport' }
      if (!state.reportedAt) return { kind: 'wait', pending: [], note: 'waiting for the outcome report session to report back' }
      return { kind: 'complete' }
    }
  }
}

/**
 * A run plan between steps: start the step at the cursor — or skip it when it
 * has nothing to do — or, past the last step, finish the plan.
 */
function planIdleStep(state: AutoLoop, world: AutoWorld): AutoStep {
  const plan = state.plan!
  const step = plan.steps[state.cursor]
  if (!step) return { kind: 'finishPlan', report: !!world.tickets.length && world.tickets.every(finished) }
  // Between steps nothing is in flight, so a stop takes effect now.
  if (state.stopRequested) return { kind: 'turnOff' }
  if (!world.tip) return { kind: 'pause', reason: 'no-branch', detail: 'the integration branch does not resolve in the repo' }
  const tip = world.tip
  const enter = (phase: Extract<AutoStep, { kind: 'enterPlanStep' }>['phase'], patch: { tickets?: string[]; prs?: string[]; baseSha?: string } = {}): AutoStep => ({
    kind: 'enterPlanStep',
    phase,
    tickets: patch.tickets ?? [],
    prs: patch.prs ?? [],
    baseSha: patch.baseSha ?? tip,
    tip,
  })
  switch (step.kind) {
    case 'implement': {
      const open = step.tickets.filter((k) => !finished(world.tickets.find((t) => t.key === k)))
      return open.length ? enter('implementing', { tickets: open }) : { kind: 'skipPlanStep', reason: 'every ticket in it was already finished', tip }
    }
    case 'merge': {
      // Every open PR of the plan's tickets so far — review fixes included, and
      // anything an earlier sweep left behind.
      const ours = new Set(state.planLog.flatMap((r) => [...r.tickets, ...r.fixTickets]))
      const prs = world.prs
        .filter((p) => ours.has(p.ticketKey) && (p.status === 'open' || p.status === 'conflicted'))
        .map((p) => p.key)
        .sort(byKey)
      return prs.length ? enter('merging', { prs }) : { kind: 'skipPlanStep', reason: 'no open PR to merge', tip }
    }
    case 'review': {
      const checkpoints = { ...state.checkpoints, start: state.checkpoints.start || tip }
      const base = reviewBaseSha(plan, state.cursor, checkpoints)
      return base === tip ? { kind: 'skipPlanStep', reason: 'nothing landed since its base', tip } : enter('reviewing', { baseSha: base })
    }
    case 'gate':
      return enter('gate')
  }
}

/** The run plan's step in progress (or about to start), if a plan is running. */
export function currentPlanStep(state: AutoLoop) {
  return state.plan?.steps[state.cursor] ?? null
}

/**
 * The run plan's record of the step in progress, as it stands — `skipped`
 * set when it never ran.
 */
export function planStepRecord(state: AutoLoop, at: string, skipped = ''): PlanStepRecord | null {
  const step = currentPlanStep(state)
  if (!step) return null
  const ran = !skipped
  return {
    stepId: step.id,
    kind: step.kind,
    tickets: ran && step.kind === 'implement' ? state.tickets : [],
    fixTickets: ran && step.kind === 'review' ? state.fixTickets : [],
    prs: ran ? state.prs : [],
    reviewKey: ran && step.kind === 'review' ? state.reviewKey : null,
    ...(ran && state.forced.length ? { forced: state.forced } : {}),
    skipped,
    startedAt: state.stepStartedAt || at,
    endedAt: at,
  }
}

/** A run plan's step is over: log it, checkpoint the tip, and move the cursor on. */
export function advancePlan(state: AutoLoop, at: string, tip: string, skipped = ''): AutoLoop {
  const record = planStepRecord(state, at, skipped)
  const step = currentPlanStep(state)
  const cleared = newAutoLoop(at, state)
  return {
    ...state,
    ...stepFields(cleared),
    phase: 'idle',
    phaseStartedAt: at,
    paused: null,
    cursor: state.cursor + 1,
    stepStartedAt: '',
    gatePassed: false,
    planLog: record ? [...state.planLog, record] : state.planLog,
    checkpoints: { ...state.checkpoints, ...(state.checkpoints.start ? {} : { start: tip }), ...(step ? { [step.id]: tip } : {}) },
  }
}

/** The per-phase working fields — what a new step (or loop) starts from empty. */
export function stepFields(s: AutoLoop): Partial<AutoLoop> {
  return {
    baseSha: s.baseSha,
    tickets: s.tickets,
    fixTickets: s.fixTickets,
    dispatched: s.dispatched,
    agents: s.agents,
    watch: s.watch,
    forced: s.forced,
    orchestrator: s.orchestrator,
    prs: s.prs,
    prChecks: s.prChecks,
    prCheckAt: s.prCheckAt,
    mergeDispatchedAt: s.mergeDispatchedAt,
    mergeReportedAt: s.mergeReportedAt,
    mergeReport: s.mergeReport,
    reviewRequestedAt: s.reviewRequestedAt,
    reviewKey: s.reviewKey,
  }
}

/** Start the run plan's step at the cursor (planIdleStep chose how). */
export function enterPlanStep(state: AutoLoop, step: Extract<AutoStep, { kind: 'enterPlanStep' }>, at: string): AutoLoop {
  return {
    ...state,
    ...stepFields(newAutoLoop(at, state)),
    phase: step.phase,
    phaseStartedAt: at,
    stepStartedAt: at,
    paused: null,
    gatePassed: false,
    baseSha: step.baseSha,
    tickets: step.tickets,
    prs: step.prs,
    checkpoints: state.checkpoints.start ? state.checkpoints : { ...state.checkpoints, start: step.tip },
  }
}

/**
 * Past the run plan's last step: its history record goes in, then either the
 * outcome report runs (no open ticket left) or auto mode turns off.
 */
export function finishPlan(state: AutoLoop, at: string, report: boolean): AutoLoop {
  const next = newAutoLoop(at, withPlanHistory(state, at))
  return report
    ? { ...next, enabled: true, phase: 'reporting', phaseStartedAt: at, ended: null }
    : { ...next, enabled: false, ended: { reason: 'plan-finished', at } }
}

/** A run plan ending early (stopped, turned off) still leaves its record. */
export function withPlanHistory(state: AutoLoop, at: string): AutoLoop {
  if (!state.plan || (!state.planLog.length && state.phase === 'idle')) return state
  // The step it stopped in counts as far as it got.
  const partial = state.phase !== 'idle' ? planStepRecord(state, at) : null
  const log = partial ? { ...state, planLog: [...state.planLog, partial] } : state
  return { ...state, history: [...state.history, planHistoryRecord(log, at)].slice(-AUTO_HISTORY_CAP) }
}

/**
 * The run plan is done (or stopped): one history record for the whole run,
 * with what each step did.
 */
export function planHistoryRecord(state: AutoLoop, at: string): AutoLoopRecord {
  const log = state.planLog
  return {
    loop: state.loop,
    tickets: log.flatMap((r) => r.tickets),
    fixTickets: log.flatMap((r) => r.fixTickets),
    ...(log.some((r) => r.forced?.length) ? { forced: log.flatMap((r) => r.forced ?? []) } : {}),
    ...(state.orchestration.mode === 'orchestrated' ? { orchestrated: true } : {}),
    plan: log,
    reviewKey: log.filter((r) => r.reviewKey).at(-1)?.reviewKey ?? null,
    startedAt: state.loopStartedAt,
    endedAt: at,
  }
}

/**
 * The watchdog's one step for this tick, or null when every open dispatched
 * ticket's session is working, within its grace, or unknown.
 */
export function watchStep(state: AutoLoop, world: AutoWorld, pending: string[]): AutoStep | null {
  const at = new Date(world.now).toISOString()
  for (const key of pending) {
    if (!state.dispatched[key]) continue
    const seen = world.agents?.[key]
    if (!seen) continue
    const w = state.watch[key] ?? { stoppedSince: '', nudgedAt: '' }
    if (seen === 'working') {
      if (w.stoppedSince) return { kind: 'watch', key, stoppedSince: '' }
      continue
    }
    if (!w.stoppedSince) return { kind: 'watch', key, stoppedSince: at }
    const stoppedFor = world.now - Date.parse(w.stoppedSince)
    if (seen === 'gone') {
      if (stoppedFor >= AGENT_GONE_MS) return { kind: 'forceClose', key, reason: 'its herdr session is gone (pane closed or claude exited)' }
      continue
    }
    if (!w.nudgedAt) {
      if (stoppedFor >= STALL_NUDGE_MS) return { kind: 'nudge', key }
      continue
    }
    if (stoppedFor >= STALL_FORCE_MS && world.now - Date.parse(w.nudgedAt) >= STALL_FORCE_MS) {
      return { kind: 'forceClose', key, reason: `its session stopped with the ticket still open and did not finish it after being prompted to` }
    }
  }
  return null
}

/**
 * Orchestrated mode's step while the phase has open tickets: start its
 * orchestrator, then watch that one session the way watchStep watches a
 * ticket's — stopped → noted → nudged → replaced; gone → replaced.
 */
export function orchestratorStep(state: AutoLoop, world: AutoWorld, pending: string[]): AutoStep {
  const o = state.orchestrator
  const wait: AutoStep = { kind: 'wait', pending }
  if (!o.dispatchedAt) {
    if (o.runs >= ORCHESTRATOR_MAX_RUNS) {
      return {
        kind: 'pause',
        reason: 'orchestrator-failed',
        detail: `${o.runs} orchestrators in a row stopped with ${pending.join(', ')} still open — Retry step starts a fresh one`,
      }
    }
    return { kind: 'dispatchOrchestrator' }
  }
  const seen = world.orchestrator
  if (!seen) return wait
  if (seen === 'working') return o.watch.stoppedSince ? { kind: 'watchOrchestrator', stoppedSince: '' } : wait
  if (!o.watch.stoppedSince) return { kind: 'watchOrchestrator', stoppedSince: new Date(world.now).toISOString() }
  const stoppedFor = world.now - Date.parse(o.watch.stoppedSince)
  if (seen === 'gone') {
    return stoppedFor >= AGENT_GONE_MS ? { kind: 'restartOrchestrator', reason: 'its herdr session is gone (pane closed or claude exited)' } : wait
  }
  if (!o.watch.nudgedAt) return stoppedFor >= STALL_NUDGE_MS ? { kind: 'nudgeOrchestrator' } : wait
  if (stoppedFor >= STALL_FORCE_MS && world.now - Date.parse(o.watch.nudgedAt) >= STALL_FORCE_MS) {
    return { kind: 'restartOrchestrator', reason: 'it stopped with tickets still open and did not carry on after being prompted to' }
  }
  return wait
}

/** The phase's ticket keys (implementing / fixing), else []. */
export function phaseTickets(state: AutoLoop): string[] {
  return state.phase === 'implementing' ? state.tickets : state.phase === 'fixing' ? state.fixTickets : []
}

/** Orchestrated mode: the phase's claimed, unfinished tickets — what counts against the budget. */
export function inFlight(state: AutoLoop, world: Pick<AutoWorld, 'tickets'>): string[] {
  return phaseTickets(state).filter((k) => state.dispatched[k] && !finished(world.tickets.find((t) => t.key === k)))
}

export type ClaimVerdict =
  | { ok: true; again: boolean }
  | { ok: false; status: 404 | 409; wait: boolean; message: string }

/**
 * May the orchestrator claim `key` now? Only a ticket of the running phase,
 * not finished, and only while fewer than `budget` are in flight — `wait`
 * marks the refusal that clears itself once a ticket in flight is done. A
 * ticket already claimed is handed back again (`again`), so a repeated claim
 * is harmless.
 */
export function claimVerdict(state: AutoLoop | null | undefined, world: Pick<AutoWorld, 'tickets'>, key: string): ClaimVerdict {
  const no = (status: 404 | 409, message: string, wait = false): ClaimVerdict => ({ ok: false, status, wait, message })
  if (!state?.enabled) return no(409, 'auto mode is off')
  if (state.orchestration.mode !== 'orchestrated') return no(409, 'the loop is not running orchestrated — it dispatches its own sessions')
  if (state.phase !== 'implementing' && state.phase !== 'fixing') return no(409, `the loop is ${state.phase} — there is nothing to claim`)
  const keys = phaseTickets(state)
  if (!keys.includes(key)) return no(404, `${key} is not one of this phase's tickets (${keys.join(', ')})`)
  const t = world.tickets.find((x) => x.key === key)
  if (finished(t)) return no(409, `${key} is already finished`)
  if (state.dispatched[key]) return { ok: true, again: true }
  if (t?.hitl) return no(409, `${key} is HITL — the human works it; the loop waits for them`)
  if (state.plan && t && !t.frontier) return no(409, `${key} is blocked or claimed by someone else — claim it once it's free`, true)
  const flying = inFlight(state, world)
  if (flying.length >= state.orchestration.budget) {
    return no(409, `${flying.length} of ${state.orchestration.budget} tickets already in flight (${flying.join(', ')}) — finish one first`, true)
  }
  return { ok: true, again: false }
}

/**
 * Retry step: clear a pause and let the current step run again. Tickets the
 * loop dispatched that nobody ever claimed (still todo, unassigned) are handed
 * to herdr again; a sweep or review that never got going is re-asked.
 */
export function retryStep(state: AutoLoop, world: Pick<AutoWorld, 'tickets'>): AutoLoop {
  const next: AutoLoop = { ...state, paused: null, dispatched: { ...state.dispatched }, agents: { ...state.agents }, watch: { ...state.watch } }
  const keys = phaseTickets(state)
  // Orchestrated: a phase with no orchestrator left gets a fresh one, and the
  // tickets the last one had in flight go back to be claimed again.
  const orphaned = state.orchestration.mode === 'orchestrated' && !state.orchestrator.dispatchedAt
  for (const k of keys) {
    const t = world.tickets.find((x) => x.key === k)
    if (t && ((t.status === 'todo' && !t.claimed) || (orphaned && !finished(t)))) {
      delete next.dispatched[k]
      delete next.agents[k]
    }
    delete next.watch[k]
  }
  if (keys.length) next.orchestrator = { ...state.orchestrator, runs: 0 }
  if (state.phase === 'merging' || state.phase === 'merging-fixes') {
    next.mergeDispatchedAt = ''
    next.mergeReportedAt = ''
    next.mergeReport = null
  }
  if (state.phase === 'reviewing') {
    next.reviewRequestedAt = ''
    next.reviewKey = null
  }
  if (state.phase === 'reporting') {
    next.reportDispatchedAt = ''
    next.reportedAt = ''
    next.reportDoc = ''
  }
  return next
}

/**
 * Close the loop in progress into history and set up the next one. A stop
 * request carries over into 'idle', which honours it — unless the loop just
 * finished the project, in which case the outcome report runs first.
 */
export function finishLoop(state: AutoLoop, at: string): AutoLoop {
  const record: AutoLoopRecord = {
    loop: state.loop,
    tickets: state.tickets,
    fixTickets: state.fixTickets,
    ...(state.forced.length ? { forced: state.forced } : {}),
    ...(state.orchestration.mode === 'orchestrated' ? { orchestrated: true } : {}),
    reviewKey: state.reviewKey,
    startedAt: state.loopStartedAt,
    endedAt: at,
  }
  const history = [...state.history, record].slice(-AUTO_HISTORY_CAP)
  return { ...newAutoLoop(at, { ...state, history }), enabled: true, stopRequested: state.stopRequested }
}

/** What's still outstanding in the current phase, for the page's chips. */
export function autoPending(state: AutoLoop): { tickets: string[]; prs: string[] } {
  if (state.phase === 'implementing') return { tickets: state.tickets, prs: [] }
  if (state.phase === 'fixing') return { tickets: state.fixTickets, prs: [] }
  if (state.phase === 'merging' || state.phase === 'merging-fixes') return { tickets: [], prs: state.prs }
  return { tickets: [], prs: [] }
}

// ── Herdr cleanup ───────────────────────────────────────────────────────────
// Each loop dispatches a pane per ticket, a merge tab per sweep, and jReview
// tabs per review — left alone they stack up in herdr loop after loop. So
// after every step that ends a phase, the loop closes the panes it no longer
// needs (closing a tab's last pane closes the tab; an emptied workspace goes
// too and is recreated on the next dispatch).

/** Steps after which the loop sweeps its finished herdr panes away. */
export const CLEANUP_STEPS: ReadonlySet<AutoStep['kind']> = new Set<AutoStep['kind']>([
  'startLoop',
  'enterMerge',
  'enterReview',
  'enterFix',
  'finishLoop',
  'enterReport',
  'complete',
  'turnOff',
  'nextPlanStep',
  'skipPlanStep',
  'finishPlan',
])

export interface HerdrPaneSeen {
  paneId: string
  tabLabel: string
  /** The pane's herdr label — jTicket names every pane it dispatches into; a pane the human split has none. */
  paneLabel: string
  agentStatus: string
}

/** The jobs the loop runs as 'KEY · <job>' panes of their own. */
const LOOP_JOBS = ['merge', 'outcome report', 'orchestrate']

/**
 * Which panes are finished loop work, safe to close. Never a pane whose agent
 * is working or blocked, and never one the loop can't vouch for (unlabelled,
 * a job it doesn't run, a ticket still open — HITL work waits in its pane).
 * Closed: in the project's tabs ('KEY', 'KEY · …'), a done ticket's pane and
 * the merge / outcome-report panes; in jReview's tabs ('review K', 'review K · n',
 * 'triage K', 'triage K n'), everything of a review the loop has moved past.
 * jReview closes those same tabs itself once the consensus lands (its
 * isReviewTab), so this is the backstop — a pane already gone just fails to
 * close and is skipped.
 */
export function panesToClean(
  panes: HerdrPaneSeen[],
  ctx: { projectKey: string; doneTickets: ReadonlySet<string>; finishedReviews: ReadonlySet<string> },
): string[] {
  const jobLabels = new Set(LOOP_JOBS.map((j) => `${ctx.projectKey} · ${j}`))
  const reviewTabs = [...ctx.finishedReviews].flatMap((k) => [`review ${k}`, `triage ${k}`])
  const isProjectTab = (label: string) => label === ctx.projectKey || label.startsWith(`${ctx.projectKey} · `)
  const isReviewTab = (label: string) =>
    reviewTabs.some((base) => label === base || label.startsWith(`${base} `))
  const ticketOf = (label: string) => label.split(' · ')[0]!

  return panes
    .filter((p) => p.agentStatus !== 'working' && p.agentStatus !== 'blocked')
    .filter((p) => {
      if (isReviewTab(p.tabLabel)) return true
      if (!isProjectTab(p.tabLabel) || !p.paneLabel) return false
      return jobLabels.has(p.paneLabel) || ctx.doneTickets.has(ticketOf(p.paneLabel))
    })
    .map((p) => p.paneId)
}

/** The reviews the loop is done with: every past loop's, and this loop's once it has left the review phase. */
export function finishedReviews(state: AutoLoop): Set<string> {
  const keys = [
    ...state.history.flatMap((h) => [h.reviewKey, ...(h.plan ?? []).map((r) => r.reviewKey)]),
    ...state.planLog.map((r) => r.reviewKey),
  ]
  if (state.phase !== 'reviewing') keys.push(state.reviewKey)
  return new Set(keys.filter((k): k is string => !!k))
}
