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
// case auto mode turns itself off. Every step with nothing to do is skipped
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
// Cleanup: after every step that ends a phase, the loop closes the herdr
// panes it's finished with (panesToClean) so they don't stack up.
//
// The state lives on the project (project.auto in jticket.json), so the loop
// survives a restart and every change reaches the page over /api/stream.

export type AutoPhase = 'idle' | 'implementing' | 'merging' | 'reviewing' | 'fixing' | 'merging-fixes' | 'reporting'

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

export interface AutoPause {
  reason: AutoPauseReason
  detail: string
  at: string
}

export interface AutoLoopRecord {
  loop: number
  tickets: string[]
  fixTickets: string[]
  /** Tickets the watchdog had to close itself. */
  forced?: string[]
  reviewKey: string | null
  startedAt: string
  endedAt: string
}

export interface AutoLoop {
  enabled: boolean
  /** "Stop at the end of next loop" — the loop in progress finishes, then auto turns off. */
  stopRequested: boolean
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
  history: AutoLoopRecord[]
  /** Why auto mode last turned itself off. */
  ended: null | { reason: 'stopped' | 'complete' | 'turned-off'; at: string }
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
    history: prev?.history ?? [],
    ended: prev?.ended ?? null,
  }
}

const PHASES: AutoPhase[] = ['idle', 'implementing', 'merging', 'reviewing', 'fixing', 'merging-fixes', 'reporting']
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

  switch (state.phase) {
    case 'idle': {
      // No open ticket left: the project is finished — write its outcome
      // report, whether or not a stop was asked for (an empty project has
      // nothing to report).
      const open = world.tickets.filter((t) => !finished(t))
      if (!open.length) return world.tickets.length ? { kind: 'enterReport' } : { kind: 'complete' }
      // Between loops: nothing is in flight, so a stop takes effect now.
      if (state.stopRequested) return { kind: 'turnOff' }
      if (!world.tip) return { kind: 'pause', reason: 'no-branch', detail: 'the integration branch does not resolve in the repo' }
      const afk = world.tickets.filter((t) => t.frontier && !t.hitl).map((t) => t.key).sort(byKey)
      if (afk.length) return { kind: 'startLoop', tickets: afk, baseSha: world.tip }
      if (state.paused?.reason === 'waiting-human') return { kind: 'wait', pending: open.map((t) => t.key), note: state.paused.detail }
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
      const toDispatch = keys.filter((k) => !state.dispatched[k] && !finished(ticket(k)))
      if (toDispatch.length) return { kind: 'dispatchTickets', keys: toDispatch }
      const pending = keys.filter((k) => !finished(ticket(k)))
      const watched = watchStep(state, world, pending)
      if (watched) return watched
      if (pending.length) return { kind: 'wait', pending }
      const prs = world.prs
        .filter((p) => keys.includes(p.ticketKey) && (p.status === 'open' || p.status === 'conflicted'))
        .map((p) => p.key)
        .sort(byKey)
      if (prs.length) return { kind: 'enterMerge', prs }
      // No PR yet. Look again NO_PR_RETRIES times, NO_PR_RECHECK_MS apart,
      // before deciding this phase had nothing to merge.
      // (first look at 0s, retries at 20s and 40s; the 40s one skips).
      const due = state.prCheckAt ? Date.parse(state.prCheckAt) + NO_PR_RECHECK_MS : 0
      if (world.now < due) return { kind: 'wait', pending: [], note: 'every ticket is finished but no PR has shown up yet' }
      if (state.prChecks < NO_PR_RETRIES) return { kind: 'recheckPrs' }
      return state.phase === 'implementing' ? { kind: 'enterReview' } : { kind: 'finishLoop' }
    }

    case 'merging':
    case 'merging-fixes': {
      const next: AutoStep = state.phase === 'merging' ? { kind: 'enterReview' } : { kind: 'finishLoop' }
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
        if (world.tip && world.tip === state.baseSha) return { kind: 'finishLoop' }
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
      return fixes.length ? { kind: 'enterFix', tickets: fixes } : { kind: 'finishLoop' }
    }

    case 'reporting': {
      if (!state.reportDispatchedAt) return { kind: 'dispatchReport' }
      if (!state.reportedAt) return { kind: 'wait', pending: [], note: 'waiting for the outcome report session to report back' }
      return { kind: 'complete' }
    }
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
 * Retry step: clear a pause and let the current step run again. Tickets the
 * loop dispatched that nobody ever claimed (still todo, unassigned) are handed
 * to herdr again; a sweep or review that never got going is re-asked.
 */
export function retryStep(state: AutoLoop, world: Pick<AutoWorld, 'tickets'>): AutoLoop {
  const next: AutoLoop = { ...state, paused: null, dispatched: { ...state.dispatched }, agents: { ...state.agents }, watch: { ...state.watch } }
  const keys = state.phase === 'implementing' ? state.tickets : state.phase === 'fixing' ? state.fixTickets : []
  for (const k of keys) {
    const t = world.tickets.find((x) => x.key === k)
    if (t && t.status === 'todo' && !t.claimed) {
      delete next.dispatched[k]
      delete next.agents[k]
    }
    delete next.watch[k]
  }
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
])

export interface HerdrPaneSeen {
  paneId: string
  tabLabel: string
  /** The pane's herdr label — jTicket names every pane it dispatches into; a pane the human split has none. */
  paneLabel: string
  agentStatus: string
}

/** The jobs the loop runs as 'KEY · <job>' panes of their own. */
const LOOP_JOBS = ['merge', 'outcome report']

/**
 * Which panes are finished loop work, safe to close. Never a pane whose agent
 * is working or blocked, and never one the loop can't vouch for (unlabelled,
 * a job it doesn't run, a ticket still open — HITL work waits in its pane).
 * Closed: in the project's tabs ('KEY', 'KEY · …'), a done ticket's pane and
 * the merge / outcome-report panes; in jReview's tabs ('review K', 'review K · n',
 * 'triage K', 'triage K n'), everything of a review the loop has moved past.
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
  const keys = state.history.map((h) => h.reviewKey)
  if (state.phase !== 'reviewing') keys.push(state.reviewKey)
  return new Set(keys.filter((k): k is string => !!k))
}
