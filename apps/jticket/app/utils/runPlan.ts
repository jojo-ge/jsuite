// Run plans — auto mode with a script. Where the plain loop decides its own
// steps (the AFK frontier → merge → review → fix → merge, over and over), a
// run plan is the human's: an ordered list of steps built in the project's
// Run setup tab, run top to bottom by the same engine (app/utils/autoLoop.ts),
// so the watchdog, orchestration, merge reports and pane cleanup all apply.
//
//   implement   the tickets picked for it. Each runs as its own agent (one
//               session, on the step's model and effort or the ticket's own —
//               `runners`) unless the human put it in an orchestrator group
//               (`groups`): then a Fable orchestrator works that group through
//               subagents on the step's model and effort — or the group's own
//               (`groupRunners`, one per group: a box of small fixes on Sonnet
//               low beside a box of core work on Opus high). Solo agents and
//               orchestrators run side by side in one step, under the
//               concurrency rule (STEP_SESSIONS_MAX below): the ticket list
//               is a queue, and own-agent tickets past the free sessions
//               start as earlier ones finish. A HITL ticket is never
//               dispatched — the step waits for the human to finish it
//   merge       the merge sweep over every open PR the plan's tickets have so
//               far; skipped when there's none
//   review      a consensus review in jReview over base…integration tip, where
//               base is a checkpoint (the tip when an earlier step finished,
//               or when the plan started); only the findings every reviewer
//               (2–4) raises are fixed and merged inside the step. With
//               `review.arch` set, an architectural & technical reviewer runs
//               FIRST, its architectural findings are fixed and merged, and
//               only then do the regular reviewers read the result
//
//   Before every implement step after the plan's first, when the integration
//   tip has moved since the last one, a slice report is written (one Opus
//   session, facts only) and that step's sessions read it first.
//   gate        waits for the human to press Continue
//
// A plan is built by hand in the tab, or by one Fable 5.2 session the tab's
// Build button dispatches (`/jrunplan`; `project.runPlanBuild` marks it in
// progress — the tab is read-only until it reports back). Started, the plan
// is locked whole: unlocking it stops the run.
//
// Pure: no Nuxt, no I/O — tests/runPlan.test.ts.

export type PlanStepKind = 'implement' | 'merge' | 'review' | 'gate'

// ── How tickets are dispatched ──────────────────────────────────────────────
// The claude models a session can run on, by the alias the Agent tool takes
// (an orchestrator passes it straight to its subagents) with the CLI id each
// pins and the name the UI shows.
export type PlanModel = 'opus' | 'sonnet' | 'haiku' | 'fable'
export const PLAN_MODELS: Record<PlanModel, { label: string; id: string }> = {
  opus: { label: 'Opus 5.5', id: 'claude-opus-5-5' },
  sonnet: { label: 'Sonnet 5.5', id: 'claude-sonnet-5-5' },
  haiku: { label: 'Haiku 5.5', id: 'claude-haiku-5-5' },
  fable: { label: 'Fable 5.2', id: 'claude-fable-5-2' },
}
export const PLAN_MODEL_DEFAULT: PlanModel = 'opus'
export const PLAN_MODEL_KEYS = Object.keys(PLAN_MODELS) as PlanModel[]

/** claude's `--effort` levels. */
export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max'
export const EFFORTS: Effort[] = ['low', 'medium', 'high', 'xhigh', 'max']
export const EFFORT_DEFAULT: Effort = 'high'
export function coerceEffort(raw: unknown): Effort | null {
  return typeof raw === 'string' && (EFFORTS as string[]).includes(raw) ? (raw as Effort) : null
}

/** What one session runs as. */
export interface Runner {
  model: PlanModel
  effort: Effort
}
export function coerceRunner(raw: any, fallback: Runner): Runner | null {
  if (!raw || typeof raw !== 'object') return null
  return { model: coercePlanModel(raw.model) ?? fallback.model, effort: coerceEffort(raw.effort) ?? fallback.effort }
}
export const runnerLabel = (r: Runner) => `${PLAN_MODELS[r.model].label} ${r.effort}`

/** How a batch of tickets is handed to herdr. */
export type DispatchMode = 'sessions' | 'orchestrated'

/**
 * One batch's dispatch: 'sessions' runs every ticket at once, each in its own
 * session on `model`; 'orchestrated' runs `orchestrators` Fable 5.2
 * orchestrators side by side, the batch's tickets shared out between them,
 * each working its share through subagents on `model` with at most `budget`
 * in flight.
 */
export interface PlanDispatch {
  /** On a plan step this follows from its groups (any orchestrated ticket → 'orchestrated'); the jButton's loop picks it. */
  mode: DispatchMode
  model: PlanModel
  /** The sessions' (or subagents') `--effort`. */
  effort: Effort
  /** Orchestrated: tickets in flight at once, per orchestrator. */
  budget: number
  /** Orchestrated: how many orchestrators run side by side (1…PLAN_ORCHESTRATORS_MAX). */
  orchestrators: number
}

/** The jButton's plain loop: what its confirm modal offers. */
export const PLAN_BUDGET_MAX = 4
export const PLAN_ORCHESTRATORS_MAX = 4
export const DEFAULT_DISPATCH: PlanDispatch = { mode: 'sessions', model: PLAN_MODEL_DEFAULT, effort: EFFORT_DEFAULT, budget: 2, orchestrators: 1 }

// ── A run plan step's concurrency rule ──────────────────────────────────────
// Too many sessions at once slow every one of them down, so an implement step
// takes one of three shapes, and never more than STEP_SESSIONS_MAX sessions
// run at once (an orchestrator counts as one, whatever its budget):
//
//   own agents only      up to 4 own-agent sessions at once
//   mixed                1 orchestrator + up to 3 own-agent sessions at once
//   orchestrators only   2 orchestrators, no own-agent ticket beside them
//
// Each orchestrator works at most STEP_BUDGET_MAX tickets at once. A step may
// hold more tickets than it can run at once: its ticket list is a QUEUE in the
// builder's order, and the engine starts the next own-agent ticket as a
// session frees (stepSoloSlots). Groups and budget are clamped on the way in;
// the mixed shape with two orchestrators is a planProblems problem.
//
// An orchestrator only pays for itself when it has parallel work: PROJ-4's
// analytics showed every orchestrator that ran one subagent at a time (budget
// 1, or a group of two or three) costing more than the work it supervised and
// sitting idle most of its wall clock. So the budget is never 1 (BUDGET_MIN —
// coerceDispatch lifts it), and a group needs GROUP_MIN tickets: fewer is a
// planProblems problem, and the engine runs a group that has shrunk below it
// by step time (tickets already finished) as own agents (liveGroups).
export const STEP_ORCHESTRATORS_MAX = 2
export const STEP_BUDGET_MAX = 2
export const STEP_SESSIONS_MAX = 4
export const BUDGET_MIN = 2
export const GROUP_MIN = 4

/**
 * The step's orchestrator groups as they stand once `open` is what's left to
 * run: each cut down to the open tickets, and a group with fewer than
 * GROUP_MIN of them emptied — its tickets run as their own agents instead.
 * Positions are kept (a group's runner is found by index).
 */
export function liveGroups(groups: string[][], open: readonly string[]): string[][] {
  return groups.map((g) => {
    const left = g.filter((k) => open.includes(k))
    return left.length >= GROUP_MIN ? left : []
  })
}

/** How many own-agent sessions a step with `orchestrators` groups may run at once. */
export function stepSoloSlots(orchestrators: number): number {
  return orchestrators >= STEP_ORCHESTRATORS_MAX ? 0 : Math.max(0, STEP_SESSIONS_MAX - Math.max(0, orchestrators))
}

/** A review step's reviewers — and the optional architectural pass that runs before them. */
export interface ReviewSetting {
  model: PlanModel
  effort: Effort
  /** The architectural & technical reviewer, run first; null = none. */
  arch: Runner | null
}
export const REVIEW_DEFAULT: ReviewSetting = { model: 'opus', effort: 'medium', arch: null }
export const ARCH_DEFAULT: Runner = { model: 'opus', effort: 'high' }
export function coerceReview(raw: any): ReviewSetting {
  if (!raw || typeof raw !== 'object') return { ...REVIEW_DEFAULT }
  return {
    model: coercePlanModel(raw.model) ?? REVIEW_DEFAULT.model,
    effort: coerceEffort(raw.effort) ?? REVIEW_DEFAULT.effort,
    arch: coerceRunner(raw.arch, ARCH_DEFAULT),
  }
}

export function coercePlanModel(raw: unknown): PlanModel | null {
  return typeof raw === 'string' && raw in PLAN_MODELS ? (raw as PlanModel) : null
}

/** A dispatch setting off the wire or the disk — null when there's nothing usable. */
export function coerceDispatch(raw: any): PlanDispatch | null {
  if (!raw || typeof raw !== 'object') return null
  const mode: DispatchMode = raw.mode === 'orchestrated' ? 'orchestrated' : raw.mode === 'sessions' ? 'sessions' : DEFAULT_DISPATCH.mode
  const n = Number(raw.budget)
  // Never 1: an orchestrator running one subagent at a time is pure overhead (BUDGET_MIN).
  const budget = Number.isInteger(n) ? Math.min(PLAN_BUDGET_MAX, Math.max(BUDGET_MIN, n)) : DEFAULT_DISPATCH.budget
  const c = Number(raw.orchestrators)
  const orchestrators = Number.isInteger(c) ? Math.min(PLAN_ORCHESTRATORS_MAX, Math.max(1, c)) : DEFAULT_DISPATCH.orchestrators
  return { mode, model: coercePlanModel(raw.model) ?? DEFAULT_DISPATCH.model, effort: coerceEffort(raw.effort) ?? DEFAULT_DISPATCH.effort, budget, orchestrators }
}

/** One line for a dispatch — the builder's step summary and the running strip. */
export function dispatchSummary(d: PlanDispatch, n?: number): string {
  const model = PLAN_MODELS[d.model].label
  const what = n === undefined ? 'the tickets' : `${n} ticket${n === 1 ? '' : 's'}`
  if (d.mode !== 'orchestrated') return `${what[0]!.toUpperCase()}${what.slice(1)} at once, each in its own ${model} session and worktree.`
  return d.orchestrators > 1
    ? `${d.orchestrators} Fable 5.2 orchestrators share ${what} out between them, each running its share through ${model} subagents, at most ${d.budget} in flight each, spec-checking every ticket before it's done.`
    : `One Fable 5.2 orchestrator runs ${what} through ${model} subagents, at most ${d.budget} in flight, spec-checking each before it's done.`
}

export interface PlanStep {
  /** Stable within the plan ('s1', 's2', …) — a review's base names one. */
  id: string
  kind: PlanStepKind
  /** implement: the ticket keys it runs. */
  tickets: string[]
  /** review: how many reviewers (1…PLAN_REVIEWERS_MAX). */
  reviewers: number
  /** review: '' = since the previous review step (or the plan start), else an earlier step's id. */
  base: string
  /** gate: what the human is being asked to check. */
  note: string
  /** implement: how its tickets are dispatched — null = the way the run was started. */
  dispatch: PlanDispatch | null
  /**
   * implement: the orchestrators' tickets — one list per orchestrator, in
   * order. A ticket of the step in no list runs as its own agent.
   */
  groups: string[][]
  /**
   * implement: an orchestrator group's own model/effort for its subagents,
   * aligned with `groups` (null = the step's). Lets one step run a box of
   * small tickets cheaply beside a box of heavy ones.
   */
  groupRunners: Array<Runner | null>
  /** implement: a solo ticket's own model/effort, when it differs from the step's. */
  runners: Record<string, Runner>
  /**
   * implement: what whoever built the plan expected of each ticket, by key —
   * see TicketPrediction. Written by `/jrunplan`; a plan built by hand has
   * none. The engine never reads it: it is there to be scored against what
   * the run actually took (the harness capture's run snapshot).
   */
  predictions: Record<string, TicketPrediction>
  /** review: the reviewers, and the optional architectural pass before them. */
  review: ReviewSetting
}

/** How heavy the plan's builder judged a ticket — the weights `/jrunplan` sorts tickets by. */
export type PlanWeight = 'light' | 'medium' | 'heavy'
export const PLAN_WEIGHTS: PlanWeight[] = ['light', 'medium', 'heavy']
export type PlanRisk = 'low' | 'medium' | 'high'
export const PLAN_RISKS: PlanRisk[] = ['low', 'medium', 'high']
export const PREDICTION_MINUTES_MAX = 24 * 60
export const PREDICTION_WHY_MAX = 300

/**
 * A plan builder's bet on one ticket, recorded before the run so it can be
 * checked after it: a prediction made up afterwards is worth nothing.
 */
export interface TicketPrediction {
  weight: PlanWeight
  /** Expected minutes from the ticket being picked up to it being closed. */
  minutes: number
  /** How likely a review is to find something wrong in its work. */
  risk: PlanRisk
  /** One line: why this weight, and why this runner. */
  why: string
}

/** A prediction off the wire — null unless it names a weight, a risk and a positive number of minutes. */
export function coercePrediction(raw: any): TicketPrediction | null {
  if (!raw || typeof raw !== 'object') return null
  const minutes = Math.round(Number(raw.minutes))
  if (!PLAN_WEIGHTS.includes(raw.weight) || !PLAN_RISKS.includes(raw.risk) || !Number.isFinite(minutes) || minutes < 1) return null
  return { weight: raw.weight, minutes: Math.min(PREDICTION_MINUTES_MAX, minutes), risk: raw.risk, why: str(raw.why).trim().slice(0, PREDICTION_WHY_MAX) }
}

/**
 * The tickets in the plan's implement steps that carry no prediction — of
 * `open` when given (a finished ticket is skipped by the run, so it needs
 * none). What `/jrunplan` must fill before it may report the plan built.
 */
export function unpredictedTickets(plan: RunPlan, open?: ReadonlySet<string>): string[] {
  const out: string[] = []
  for (const s of plan.steps) {
    if (s.kind !== 'implement') continue
    for (const k of s.tickets) if (!s.predictions[k] && (!open || open.has(k)) && !out.includes(k)) out.push(k)
  }
  return out
}

export interface RunPlan {
  steps: PlanStep[]
}

export const PLAN_REVIEWERS_MAX = 4
export const PLAN_REVIEWERS_MIN = 2
export const PLAN_REVIEWERS_DEFAULT = 2

/** The checkpoint every plan has: the integration tip when it started. */
export const PLAN_START = 'start'

export const PLAN_STEP_LABELS: Record<PlanStepKind, string> = {
  implement: 'Implement',
  merge: 'Merge',
  review: 'Review',
  gate: 'Gate',
}

/** A fresh step of `kind`, with an id no step of `plan` uses. */
export function newPlanStep(plan: RunPlan, kind: PlanStepKind, patch: Partial<PlanStep> = {}): PlanStep {
  const used = new Set(plan.steps.map((s) => s.id))
  let n = plan.steps.length + 1
  while (used.has(`s${n}`)) n++
  return { id: `s${n}`, kind, tickets: [], reviewers: PLAN_REVIEWERS_DEFAULT, base: '', note: '', dispatch: null, groups: [], groupRunners: [], runners: {}, predictions: {}, review: { ...REVIEW_DEFAULT }, ...patch }
}

const KINDS: PlanStepKind[] = ['implement', 'merge', 'review', 'gate']
const str = (v: unknown) => (typeof v === 'string' ? v : '')

/** Whatever came off the wire or the disk, made safe — null when there's nothing usable. */
export function coerceRunPlan(raw: any): RunPlan | null {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.steps)) return null
  const seen = new Set<string>()
  const steps: PlanStep[] = []
  for (const s of raw.steps) {
    if (!s || typeof s !== 'object' || !KINDS.includes(s.kind)) continue
    const id = str(s.id).trim().slice(0, 40)
    if (!id || seen.has(id) || id === PLAN_START) continue
    seen.add(id)
    const n = Number(s.reviewers)
    const tickets = s.kind === 'implement' && Array.isArray(s.tickets) ? [...new Set<string>(s.tickets.filter((k: unknown): k is string => typeof k === 'string'))] : []
    let groups = s.kind === 'implement' ? coerceGroups(s.groups, tickets) : []
    const dispatch = s.kind === 'implement' ? coerceDispatch(s.dispatch) : null
    if (dispatch) {
      // A step's orchestrators work at most STEP_BUDGET_MAX tickets at once.
      dispatch.budget = Math.min(STEP_BUDGET_MAX, dispatch.budget)
      // From before groups meant "orchestrated": an orchestrated step with no
      // group was one orchestrator with every ticket — keep it that.
      if (dispatch.mode === 'orchestrated' && !groups.some((g) => g.length) && tickets.length) groups = [[...tickets]]
      // On a step the mode follows the groups; the count is the groups with a ticket.
      const live = groups.filter((g) => g.length).length
      dispatch.mode = live ? 'orchestrated' : 'sessions'
      dispatch.orchestrators = Math.max(1, live)
    }
    const grouped = new Set(groups.flat())
    const base = dispatch ?? DEFAULT_DISPATCH
    // One runner per group, by position; a group without one (or an empty
    // group) runs on the step's model and effort.
    const groupRunners: Array<Runner | null> = groups.map((g, i) => (g.length && Array.isArray(s.groupRunners) ? coerceRunner(s.groupRunners[i], base) : null))
    const runners: Record<string, Runner> = {}
    if (s.kind === 'implement' && s.runners && typeof s.runners === 'object') {
      for (const [k, r] of Object.entries(s.runners)) {
        if (!tickets.includes(k) || grouped.has(k)) continue
        const runner = coerceRunner(r, base)
        if (runner) runners[k] = runner
      }
    }
    // A prediction belongs to a ticket of the step, grouped or not.
    const predictions: Record<string, TicketPrediction> = {}
    if (s.kind === 'implement' && s.predictions && typeof s.predictions === 'object') {
      for (const [k, p] of Object.entries(s.predictions)) {
        const prediction = tickets.includes(k) ? coercePrediction(p) : null
        if (prediction) predictions[k] = prediction
      }
    }
    steps.push({
      id,
      kind: s.kind,
      tickets,
      reviewers: s.kind === 'review' ? (Number.isInteger(n) ? Math.min(PLAN_REVIEWERS_MAX, Math.max(PLAN_REVIEWERS_MIN, n)) : PLAN_REVIEWERS_DEFAULT) : PLAN_REVIEWERS_DEFAULT,
      base: s.kind === 'review' ? str(s.base).trim() : '',
      note: s.kind === 'gate' ? str(s.note).trim().slice(0, 300) : '',
      dispatch,
      groups,
      groupRunners,
      runners,
      predictions,
      review: s.kind === 'review' ? coerceReview(s.review) : { ...REVIEW_DEFAULT },
    })
  }
  return { steps }
}

/**
 * A step's orchestrator groups off the wire: only the step's tickets, each in
 * one group at most, at most STEP_ORCHESTRATORS_MAX groups (the rest fold into
 * the last). Empty groups are kept — a box the human just added, waiting for
 * a ticket to be dragged in.
 */
export function coerceGroups(raw: unknown, tickets: string[]): string[][] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const groups: string[][] = []
  for (const g of raw) {
    if (!Array.isArray(g)) continue
    const keys = g.filter((k): k is string => typeof k === 'string' && tickets.includes(k) && !seen.has(k))
    keys.forEach((k) => seen.add(k))
    if (groups.length < STEP_ORCHESTRATORS_MAX) groups.push(keys)
    else groups[groups.length - 1]!.push(...keys)
  }
  return groups
}

/**
 * The step's shape under the concurrency rule: its own-agent tickets in queue
 * order, how many of them run at once (`soloSlots`), its orchestrator count,
 * and the sessions it runs at once in all. `queued` are the own-agent tickets
 * past the slots — they start as sessions free.
 */
export function stepShape(step: Pick<PlanStep, 'tickets' | 'groups'>): { solo: string[]; orchestrators: number; soloSlots: number; sessions: number; queued: string[] } {
  const solo = soloTickets(step)
  const orchestrators = stepGroups(step).length
  const soloSlots = stepSoloSlots(orchestrators)
  return { solo, orchestrators, soloSlots, sessions: orchestrators + Math.min(solo.length, soloSlots), queued: solo.slice(soloSlots) }
}

/** The shape in words — the wizard's confirm line, the board's step card, the graph's own-agent box. */
export function stepShapeLabel(step: Pick<PlanStep, 'tickets' | 'groups' | 'dispatch'>, fallback: PlanDispatch): string {
  const { solo, orchestrators, soloSlots, queued } = stepShape(step)
  const budget = (step.dispatch ?? fallback).budget
  const parts: string[] = []
  if (solo.length) {
    const running = Math.min(solo.length, soloSlots)
    parts.push(`${running} own agent${running === 1 ? '' : 's'} at once${queued.length ? ` (${queued.length} queued)` : ''}`)
  }
  if (orchestrators) parts.push(`${orchestrators} orchestrator${orchestrators > 1 ? 's' : ''}, ${budget} in flight${orchestrators > 1 ? ' each' : ''}`)
  return parts.join(' + ') || 'no tickets'
}

/** The step's orchestrators' tickets — its groups cut down to its tickets, empties dropped. */
export function stepGroups(step: Pick<PlanStep, 'tickets' | 'groups'>): string[][] {
  return step.groups.map((g) => g.filter((k) => step.tickets.includes(k))).filter((g) => g.length)
}

/** The step's tickets that run as their own agent — every one in no group. */
export function soloTickets(step: Pick<PlanStep, 'tickets' | 'groups'>): string[] {
  return step.tickets.filter((k) => !step.groups.some((g) => g.includes(k)))
}

/** What a solo ticket of the step runs as: its own runner, else the step's dispatch (or `fallback`, the run's). */
export function runnerOf(step: Pick<PlanStep, 'dispatch' | 'runners'>, key: string, fallback: Runner): Runner {
  const d = step.dispatch ?? fallback
  return step.runners[key] ?? { model: d.model, effort: d.effort }
}

/**
 * What the orchestrator holding `key` runs its subagents as: its group's own
 * runner, else the step's dispatch (or `fallback`, the run's). A key in no
 * group — or a step with no group runners — gets the step's.
 */
export function groupRunnerOf(step: Pick<PlanStep, 'dispatch' | 'groups' | 'groupRunners'>, key: string, fallback: Runner): Runner {
  const d = step.dispatch ?? fallback
  const gi = step.groups.findIndex((g) => g.includes(key))
  return (gi >= 0 ? step.groupRunners[gi] : null) ?? { model: d.model, effort: d.effort }
}

/** The step's orchestrator groups with their runners, empties dropped — what the board and the wizard draw. */
export function stepGroupEntries(step: Pick<PlanStep, 'tickets' | 'dispatch' | 'groups' | 'groupRunners'>, fallback: Runner): Array<{ tickets: string[]; runner: Runner }> {
  const d = step.dispatch ?? fallback
  return step.groups
    .map((g, i) => ({ tickets: g.filter((k) => step.tickets.includes(k)), runner: step.groupRunners[i] ?? { model: d.model, effort: d.effort } }))
    .filter((e) => e.tickets.length)
}

/**
 * One line for an implement step — who runs what. `fallback` is the run's
 * setting, for a step without its own dispatch.
 */
export function implementSummary(step: PlanStep, fallback: PlanDispatch): string {
  const d = step.dispatch ?? fallback
  const solo = soloTickets(step)
  const orch = stepGroups(step)
  const parts: string[] = []
  if (solo.length) {
    const tally = new Map<string, number>()
    for (const k of solo) {
      const label = runnerLabel(runnerOf(step, k, d))
      tally.set(label, (tally.get(label) ?? 0) + 1)
    }
    const slots = stepSoloSlots(orch.length)
    const pace = !slots ? ` — none can run beside ${orch.length} orchestrators` : solo.length > slots ? `, ${slots} at once in queue order` : ''
    parts.push(`${solo.length} ticket${solo.length === 1 ? '' : 's'} each with its own agent (${[...tally].map(([l, n]) => `${n} on ${l}`).join(', ')})${pace}`)
  }
  if (orch.length) {
    const n = orch.reduce((a, g) => a + g.length, 0)
    const tally = new Map<string, number>()
    for (const e of stepGroupEntries(step, d)) {
      const label = runnerLabel(e.runner)
      tally.set(label, (tally.get(label) ?? 0) + e.tickets.length)
    }
    const through = tally.size === 1 ? `${[...tally.keys()][0]} subagents` : `subagents (${[...tally].map(([l, c]) => `${c} on ${l}`).join(', ')})`
    parts.push(`${orch.length} Fable 5.2 orchestrator${orch.length > 1 ? 's' : ''} working ${n} ticket${n === 1 ? '' : 's'} through ${through}, ${d.budget} in flight each`)
  }
  return `${parts.join(', beside ') || 'No tickets yet'}.`
}

/** One line for a review step. */
export function reviewSummary(step: PlanStep): string {
  const c = step.review
  const regular = `${step.reviewers} reviewers (${runnerLabel({ model: c.model, effort: c.effort })}) — findings they all raise are fixed and merged here`
  return c.arch ? `architectural & technical reviewer first (${runnerLabel(c.arch)}; its architectural findings must be fixed), then ${regular}` : regular
}

/**
 * The shares the groups give `keys` (a phase's open AFK tickets): each group
 * cut down to them, keys in no group riding with the first, empty groups
 * dropped — so an orchestrator is only ever started with something to do.
 */
export function groupShares(groups: string[][], keys: string[]): string[][] {
  const shares = groups.map((g) => g.filter((k) => keys.includes(k)))
  const placed = new Set(shares.flat())
  const rest = keys.filter((k) => !placed.has(k))
  if (rest.length) {
    if (shares.length) shares[0]!.push(...rest)
    else shares.push(rest)
  }
  const full = shares.filter((g) => g.length)
  return full.length ? full : [[]]
}

// ── Validation ──────────────────────────────────────────────────────────────

export interface PlanTicket {
  key: string
  status: 'todo' | 'in_progress' | 'done' | 'merged'
  /** Blocker keys — every blocker, in this project or not. */
  blockedBy: string[]
}

export interface PlanProblem {
  /** The step it's about ('' = the plan as a whole). */
  stepId: string
  message: string
}

const finished = (s: PlanTicket['status'] | undefined) => s === 'done' || s === 'merged'

/**
 * Everything that stops the plan from running as built — [] when it can.
 * Strict about order: a ticket's open blockers must each sit in an earlier
 * implement step with a merge between them, so the ticket starts from code
 * that has its blockers in it. `tickets` is every ticket a blocker can name
 * (the project's and whatever outside it they wait on); a blocker missing
 * from it is treated as settled. A finished ticket (`done`, `merged`) may stay
 * in a step: the engine skips it, so a plan that already ran part-way (or a
 * stopped one) starts again as it is. `frozen` steps (already run, or
 * running — or, continuing a stopped plan, the steps it finished) aren't
 * re-checked at all.
 */
export function planProblems(plan: RunPlan, tickets: PlanTicket[], opts: { frozen?: number } = {}): PlanProblem[] {
  const problems: PlanProblem[] = []
  const byKey = new Map(tickets.map((t) => [t.key, t]))
  const frozen = opts.frozen ?? 0
  if (!plan.steps.length) problems.push({ stepId: '', message: 'The plan has no steps yet.' })

  // Where each ticket runs, and which step indexes are merges.
  const placedAt = new Map<string, number>()
  plan.steps.forEach((s, i) => {
    for (const k of s.tickets) {
      if (placedAt.has(k)) {
        const other = plan.steps[placedAt.get(k)!]!
        problems.push({ stepId: s.id, message: `${k} is already in step ${placedAt.get(k)! + 1} (${other.id}) — a ticket runs once.` })
      } else placedAt.set(k, i)
    }
  })
  const mergeBetween = (from: number, to: number) => plan.steps.slice(from + 1, to).some((s) => s.kind === 'merge')

  plan.steps.forEach((s, i) => {
    const at = `Step ${i + 1}`
    if (s.kind === 'implement' && i >= frozen) {
      if (!s.tickets.length) problems.push({ stepId: s.id, message: `${at} has no tickets.` })
      // The concurrency rule's one shape coercion can't settle: two
      // orchestrators leave no session for an own-agent ticket.
      const shape = stepShape(s)
      if (shape.orchestrators >= STEP_ORCHESTRATORS_MAX && shape.solo.length) {
        problems.push({ stepId: s.id, message: `${at} runs ${shape.orchestrators} orchestrators, so ${shape.solo.join(', ')} can't run as ${shape.solo.length === 1 ? 'its' : 'their'} own agent beside them — put ${shape.solo.length === 1 ? 'it' : 'them'} in a group, or in a step of ${shape.solo.length === 1 ? 'its' : 'their'} own.` })
      }
      // An orchestrator needs parallel work: a group of fewer than GROUP_MIN
      // tickets costs more in orchestration than the tickets do in work.
      stepGroups(s).forEach((g, gi) => {
        if (g.length >= GROUP_MIN) return
        problems.push({ stepId: s.id, message: `${at}'s orchestrator ${gi + 1} has only ${g.length === 1 ? 'one ticket' : `${g.length} tickets`} (${g.join(', ')}) — an orchestrator needs ${GROUP_MIN} or more to pay for itself; run ${g.length === 1 ? 'it' : 'them'} as ${g.length === 1 ? 'its' : 'their'} own agent${g.length === 1 ? '' : 's'} instead.` })
      })
      for (const k of s.tickets) {
        const t = byKey.get(k)
        if (!t) {
          problems.push({ stepId: s.id, message: `${k} is not one of this project's tickets.` })
          continue
        }
        // A finished ticket is no problem: it's skipped at implement time,
        // and a done one's PR is swept by the next merge step (a plan built
        // after a partial run, or a stopped one started from the top).
        if (finished(t.status)) continue
        for (const b of t.blockedBy) {
          const blocker = byKey.get(b)
          if (!blocker || finished(blocker.status)) continue
          const j = placedAt.get(b)
          if (j === undefined) {
            problems.push({ stepId: s.id, message: `${k} is blocked by ${b}, which is open and not in the plan — add ${b} to an earlier step, or take ${k} out.` })
          } else if (j >= i) {
            problems.push({ stepId: s.id, message: `${k} is blocked by ${b}, which runs ${j === i ? 'in the same step' : 'later'} — move ${b} to an earlier step.` })
          } else if (!mergeBetween(j, i)) {
            problems.push({ stepId: s.id, message: `${k} builds on ${b} (step ${j + 1}) — put a merge step between them so ${b}'s work is on the integration branch first.` })
          }
        }
      }
    }
    if (s.kind === 'review' && s.base && s.base !== PLAN_START && i >= frozen) {
      const j = plan.steps.findIndex((x) => x.id === s.base)
      if (j < 0 || j >= i) problems.push({ stepId: s.id, message: `${at} reviews from a checkpoint that isn't an earlier step — pick another.` })
    }
  })
  return problems
}

/** Steps that may be a review's base: every step before it (their end is the checkpoint). */
export function reviewBaseOptions(plan: RunPlan, stepId: string): Array<{ value: string; label: string }> {
  const i = plan.steps.findIndex((s) => s.id === stepId)
  const before = plan.steps.slice(0, Math.max(0, i))
  return [
    { value: '', label: 'Since the previous review (or plan start)' },
    { value: PLAN_START, label: 'Since the plan started' },
    ...before.map((s, j) => ({ value: s.id, label: `After step ${j + 1} · ${planStepSummary(s)}` })),
  ]
}

/**
 * The sha a review step reviews from: its base checkpoint, or — base '' — the
 * checkpoint of the last review step before it, else the plan's start.
 * Checkpoints are recorded as steps finish (skipped ones too), so an earlier
 * step always has one by the time a later review runs.
 */
export function reviewBaseSha(plan: RunPlan, cursor: number, checkpoints: Record<string, string>): string {
  const step = plan.steps[cursor]
  const start = checkpoints[PLAN_START] ?? ''
  if (!step || step.kind !== 'review') return start
  if (step.base) return checkpoints[step.base] || start
  for (let j = cursor - 1; j >= 0; j--) {
    const s = plan.steps[j]!
    if (s.kind === 'review' && checkpoints[s.id]) return checkpoints[s.id]!
  }
  return start
}

/** One line for a step — the builder's headings and the running strip. */
export function planStepSummary(s: PlanStep): string {
  switch (s.kind) {
    case 'implement':
      return s.tickets.length ? `Implement ${s.tickets.join(', ')}` : 'Implement (no tickets)'
    case 'merge':
      return 'Merge'
    case 'review':
      return `Review · ${s.reviewers} reviewer${s.reviewers === 1 ? '' : 's'}`
    case 'gate':
      return s.note ? `Gate · ${s.note}` : 'Gate'
  }
}

/** Two plans' first `n` steps are the same — a running plan's frozen prefix must not change. */
export function samePrefix(a: RunPlan, b: RunPlan, n: number): boolean {
  if (a.steps.length < n || b.steps.length < n) return false
  return JSON.stringify(a.steps.slice(0, n)) === JSON.stringify(b.steps.slice(0, n))
}

// ── Building a plan with an agent ───────────────────────────────────────────

/**
 * A `/jrunplan` session building the project's plan — set when the tab's
 * Build button dispatches it, cleared when it reports back (POST
 * …/run-plan/built) or is cancelled. While set, the tab is read-only: the
 * agent owns the draft.
 */
export interface RunPlanBuild {
  /** Its herdr agent name. */
  agent: string
  paneId: string
  startedAt: string
}

export function coerceRunPlanBuild(raw: any): RunPlanBuild | null {
  if (!raw || typeof raw !== 'object') return null
  const agent = str(raw.agent).trim()
  const startedAt = str(raw.startedAt).trim()
  return agent && startedAt ? { agent, paneId: str(raw.paneId).trim(), startedAt } : null
}
