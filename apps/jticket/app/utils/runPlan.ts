// Run plans — auto mode with a script. Where the plain loop decides its own
// steps (the AFK frontier → merge → review → fix → merge, over and over), a
// run plan is the human's: an ordered list of steps built in the project's
// Run setup tab, run top to bottom by the same engine (app/utils/autoLoop.ts),
// so the watchdog, orchestration, merge reports and pane cleanup all apply.
//
//   implement   the tickets picked for it, dispatched together (sessions or
//               orchestrated, as the run was started). A HITL ticket is never
//               dispatched — the step waits for the human to finish it
//   merge       the merge sweep over every open PR the plan's tickets have so
//               far; skipped when there's none
//   review      a consensus review in jReview over base…integration tip, where
//               base is a checkpoint (the tip when an earlier step finished,
//               or when the plan started); its findings are always fixed and
//               merged inside the step. 1 reviewer = every finding is fixed;
//               2+ = only the findings every reviewer raised
//   gate        waits for the human to press Continue
//
// Pure: no Nuxt, no I/O — tests/runPlan.test.ts.

export type PlanStepKind = 'implement' | 'merge' | 'review' | 'gate'

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
}

export interface RunPlan {
  steps: PlanStep[]
}

export const PLAN_REVIEWERS_MAX = 4
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
  return { id: `s${n}`, kind, tickets: [], reviewers: PLAN_REVIEWERS_DEFAULT, base: '', note: '', ...patch }
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
    steps.push({
      id,
      kind: s.kind,
      tickets: s.kind === 'implement' && Array.isArray(s.tickets) ? [...new Set<string>(s.tickets.filter((k: unknown): k is string => typeof k === 'string'))] : [],
      reviewers: s.kind === 'review' ? (Number.isInteger(n) ? Math.min(PLAN_REVIEWERS_MAX, Math.max(1, n)) : PLAN_REVIEWERS_DEFAULT) : PLAN_REVIEWERS_DEFAULT,
      base: s.kind === 'review' ? str(s.base).trim() : '',
      note: s.kind === 'gate' ? str(s.note).trim().slice(0, 300) : '',
    })
  }
  return { steps }
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
 * from it is treated as settled. `frozen` steps (already run, or running)
 * aren't re-checked — their tickets have moved on since.
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
      for (const k of s.tickets) {
        const t = byKey.get(k)
        if (!t) {
          problems.push({ stepId: s.id, message: `${k} is not one of this project's tickets.` })
          continue
        }
        if (finished(t.status)) problems.push({ stepId: s.id, message: `${k} is already ${t.status} — take it out.` })
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
