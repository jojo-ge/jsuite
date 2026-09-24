// Auto mode — the loop the jButton turns on. Shared by the server (which
// drives it: server/utils/autoLoop.ts + plugins/autoLoop.ts) and the project
// page (which shows it). Pure: no Nuxt, no I/O — tests/autoLoop.test.ts.
//
// One loop:
//
//   implementing   the AFK frontier, snapshotted at loop start, each ticket
//                  dispatched into herdr (Opus); waits until all are finished
//   merging        the merge sweep over those tickets' local PRs (Sonnet);
//                  waits until every PR is merged
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
// The state lives on the project (project.auto in jticket.json), so the loop
// survives a restart and every change reaches the page over /api/stream.

export type AutoPhase = 'idle' | 'implementing' | 'merging' | 'reviewing' | 'fixing' | 'merging-fixes'

export const AUTO_PHASES: ReadonlyArray<{ phase: Exclude<AutoPhase, 'idle'>; label: string }> = [
  { phase: 'implementing', label: 'Implement' },
  { phase: 'merging', label: 'Merge' },
  { phase: 'reviewing', label: 'Review' },
  { phase: 'fixing', label: 'Fix' },
  { phase: 'merging-fixes', label: 'Merge fixes' },
]

export type AutoPauseReason =
  /** Nothing AFK on the frontier, but open work remains (HITL or blocked) — clears itself. */
  | 'waiting-human'
  /** A herdr dispatch failed — Retry step. */
  | 'dispatch-failed'
  /** jReview couldn't start the review, or lost it — Retry step. */
  | 'review-failed'
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
  /** The PRs the current merge sweep is landing. */
  prs: string[]
  /** When the current sweep was handed to herdr ('' = not yet). */
  mergeDispatchedAt: string
  /** When jReview was asked for this loop's review ('' = not yet). */
  reviewRequestedAt: string
  reviewKey: string | null
  history: AutoLoopRecord[]
  /** Why auto mode last turned itself off. */
  ended: null | { reason: 'stopped' | 'complete' | 'turned-off'; at: string }
}

export const AUTO_HISTORY_CAP = 20

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
    prs: [],
    mergeDispatchedAt: '',
    reviewRequestedAt: '',
    reviewKey: null,
    history: prev?.history ?? [],
    ended: prev?.ended ?? null,
  }
}

const PHASES: AutoPhase[] = ['idle', 'implementing', 'merging', 'reviewing', 'fixing', 'merging-fixes']
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
    prs: strs(raw.prs),
    mergeDispatchedAt: str(raw.mergeDispatchedAt),
    reviewRequestedAt: str(raw.reviewRequestedAt),
    reviewKey: str(raw.reviewKey) || null,
    history: Array.isArray(raw.history) ? raw.history.slice(-AUTO_HISTORY_CAP) : [],
    ended: raw.ended && typeof raw.ended === 'object' ? raw.ended : null,
  }
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
}

export type AutoStep =
  | { kind: 'wait'; pending: string[]; note?: string }
  | { kind: 'pause'; reason: AutoPauseReason; detail: string }
  | { kind: 'complete' }
  | { kind: 'turnOff' }
  | { kind: 'startLoop'; tickets: string[]; baseSha: string }
  | { kind: 'dispatchTickets'; keys: string[] }
  | { kind: 'enterMerge'; prs: string[] }
  | { kind: 'dispatchMerge'; prs: string[] }
  | { kind: 'enterReview' }
  | { kind: 'startReview' }
  | { kind: 'enterFix'; tickets: string[] }
  | { kind: 'finishLoop' }

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
      // Between loops: nothing is in flight, so a stop takes effect now.
      if (state.stopRequested) return { kind: 'turnOff' }
      if (!world.tip) return { kind: 'pause', reason: 'no-branch', detail: 'the integration branch does not resolve in the repo' }
      const afk = world.tickets.filter((t) => t.frontier && !t.hitl).map((t) => t.key).sort(byKey)
      if (afk.length) return { kind: 'startLoop', tickets: afk, baseSha: world.tip }
      const open = world.tickets.filter((t) => !finished(t))
      if (!open.length) return { kind: 'complete' }
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
      if (pending.length) return { kind: 'wait', pending }
      const prs = world.prs
        .filter((p) => keys.includes(p.ticketKey) && (p.status === 'open' || p.status === 'conflicted'))
        .map((p) => p.key)
        .sort(byKey)
      if (prs.length) return { kind: 'enterMerge', prs }
      return state.phase === 'implementing' ? { kind: 'enterReview' } : { kind: 'finishLoop' }
    }

    case 'merging':
    case 'merging-fixes': {
      if (!state.mergeDispatchedAt) return { kind: 'dispatchMerge', prs: state.prs }
      const pending = state.prs.filter((k) => !landed(world.prs.find((p) => p.key === k)))
      if (pending.length) return { kind: 'wait', pending }
      return state.phase === 'merging' ? { kind: 'enterReview' } : { kind: 'finishLoop' }
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
  }
}

/**
 * Retry step: clear a pause and let the current step run again. Tickets the
 * loop dispatched that nobody ever claimed (still todo, unassigned) are handed
 * to herdr again; a sweep or review that never got going is re-asked.
 */
export function retryStep(state: AutoLoop, world: Pick<AutoWorld, 'tickets'>): AutoLoop {
  const next: AutoLoop = { ...state, paused: null, dispatched: { ...state.dispatched } }
  const keys = state.phase === 'implementing' ? state.tickets : state.phase === 'fixing' ? state.fixTickets : []
  for (const k of keys) {
    const t = world.tickets.find((x) => x.key === k)
    if (t && t.status === 'todo' && !t.claimed) delete next.dispatched[k]
  }
  if (state.phase === 'merging' || state.phase === 'merging-fixes') next.mergeDispatchedAt = ''
  if (state.phase === 'reviewing') {
    next.reviewRequestedAt = ''
    next.reviewKey = null
  }
  return next
}

/** Close the loop in progress into history and set up the next one (or stop). */
export function finishLoop(state: AutoLoop, at: string): AutoLoop {
  const record: AutoLoopRecord = {
    loop: state.loop,
    tickets: state.tickets,
    fixTickets: state.fixTickets,
    reviewKey: state.reviewKey,
    startedAt: state.loopStartedAt,
    endedAt: at,
  }
  const history = [...state.history, record].slice(-AUTO_HISTORY_CAP)
  const next = newAutoLoop(at, { ...state, history })
  if (state.stopRequested) return { ...next, enabled: false, ended: { reason: 'stopped', at } }
  return { ...next, enabled: true }
}

/** What's still outstanding in the current phase, for the page's chips. */
export function autoPending(state: AutoLoop): { tickets: string[]; prs: string[] } {
  if (state.phase === 'implementing') return { tickets: state.tickets, prs: [] }
  if (state.phase === 'fixing') return { tickets: state.fixTickets, prs: [] }
  if (state.phase === 'merging' || state.phase === 'merging-fixes') return { tickets: [], prs: state.prs }
  return { tickets: [], prs: [] }
}
