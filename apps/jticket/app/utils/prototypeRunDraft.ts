// PROTOTYPE — throwaway. The in-memory draft the Run setup UI variants
// (components/prototype/RunSetupVariant*.vue) edit; nothing here is saved.
// Three variants of the Run setup tab, switchable via ?variant= on the
// existing /projects/:id?tab=run route (components/prototype/PrototypeSwitcher).
import { computed, ref, toRaw } from 'vue'
import type { Project, Ticket } from '~/composables/useTracker'
import { isFinished, isHitl } from '~/composables/useTracker'
import {
  DEFAULT_DISPATCH,
  PLAN_MODELS,
  PLAN_ORCHESTRATORS_MAX,
  coerceRunPlan,
  dispatchSummary,
  newPlanStep,
  planProblems,
  stepGroups,
  type PlanDispatch,
  type PlanStep,
  type PlanStepKind,
  type PlanTicket,
  type RunPlan,
} from './runPlan'

export type SimState = 'done' | 'running' | 'next' | null

export function useRunDraft(props: { project: Project; tickets: Ticket[]; allTickets: Ticket[] }) {
  const draft = ref<RunPlan>(coerceRunPlan(structuredClone(toRaw(props.project.runPlan))) ?? { steps: [] })
  const runDefault = ref<PlanDispatch>({ ...(props.project.auto?.orchestration ?? DEFAULT_DISPATCH) })
  // "View it running": pretend the run is at this step (null = not running).
  const simAt = ref<number | null>(null)

  const byId = computed(() => new Map(props.allTickets.map((t) => [t.id, t])))
  const byKey = computed(() => new Map(props.allTickets.map((t) => [t.key, t])))
  const openTickets = computed(() =>
    props.tickets.filter((t) => !isFinished(t.status)).sort((a, b) => Number(a.key.split('-').pop()) - Number(b.key.split('-').pop())),
  )
  const placed = computed(() => new Map(draft.value.steps.flatMap((s, i) => s.tickets.map((k) => [k, i] as const))))
  const unplaced = computed(() => openTickets.value.filter((t) => !placed.value.has(t.key)))
  const openBlockers = (t: Ticket) => t.blockedBy.map((id) => byId.value.get(id)).filter((b): b is Ticket => !!b && !isFinished(b.status))
  const implementSteps = computed(() => draft.value.steps.map((s, i) => ({ step: s, index: i })).filter((x) => x.step.kind === 'implement'))

  const planTickets = computed<PlanTicket[]>(() => {
    const mine = new Set(props.tickets.map((t) => t.id))
    const outside = [...new Set(props.tickets.flatMap((t) => t.blockedBy))].filter((id) => !mine.has(id))
    return [...props.tickets, ...outside.map((id) => byId.value.get(id)).filter((t): t is Ticket => !!t)].map((t) => ({
      key: t.key,
      status: t.status,
      blockedBy: t.blockedBy.map((id) => byId.value.get(id)?.key).filter((k): k is string => !!k),
    }))
  })
  const problems = computed(() => planProblems(draft.value, planTickets.value))
  const problemsOf = (id: string) => problems.value.filter((p) => p.stepId === id)
  const problemsForTicket = (key: string) => problems.value.filter((p) => p.message.startsWith(`${key} `))

  const dispatchOf = (s: PlanStep): PlanDispatch => s.dispatch ?? runDefault.value
  const orchestrated = (s: PlanStep) => dispatchOf(s).mode === 'orchestrated'
  const groupsOf = (s: PlanStep) => stepGroups(s)
  const summaryOf = (s: PlanStep) => {
    const d = dispatchOf(s)
    const n = groupsOf(s).filter((g) => g.length).length || 1
    return dispatchSummary(d.mode === 'orchestrated' ? { ...d, orchestrators: n } : d, s.tickets.length)
  }
  const modelLabel = (s: PlanStep) => PLAN_MODELS[dispatchOf(s).model].label

  const simState = (i: number): SimState => {
    if (simAt.value === null) return null
    if (i < simAt.value) return 'done'
    if (i === simAt.value) return 'running'
    return null
  }
  const locked = (i: number) => simAt.value !== null && i <= simAt.value

  // ── Mutations (in memory) ──
  function addStep(kind: PlanStepKind, tickets: string[] = []) {
    const step = newPlanStep(draft.value, kind, { tickets })
    draft.value.steps.push(step)
    return step
  }
  function removeStep(i: number) {
    const gone = draft.value.steps.splice(i, 1)[0]
    for (const s of draft.value.steps) if (gone && s.base === gone.id) s.base = ''
  }
  function move(i: number, by: -1 | 1) {
    const j = i + by
    if (j < 0 || j >= draft.value.steps.length) return
    const steps = draft.value.steps
    ;[steps[i], steps[j]] = [steps[j]!, steps[i]!]
  }
  function takeOut(key: string) {
    for (const s of draft.value.steps) {
      s.tickets = s.tickets.filter((k) => k !== key)
      s.groups = s.groups.map((g) => g.filter((k) => k !== key))
    }
  }
  /** Put `key` in `step` (and, orchestrated, in its orchestrator box `group`). */
  function assign(key: string, step: PlanStep | null, group?: number) {
    takeOut(key)
    if (!step) return
    step.tickets = [...step.tickets, key]
    if (group !== undefined) {
      const groups = groupsOf(step).map((g) => g.filter((k) => k !== key))
      while (groups.length <= group) groups.push([])
      groups[group]!.push(key)
      step.groups = groups
    }
  }
  function addGroup(step: PlanStep) {
    const groups = groupsOf(step)
    if (groups.length < PLAN_ORCHESTRATORS_MAX) step.groups = [...groups, []]
  }
  function removeGroup(step: PlanStep, gi: number) {
    const groups = groupsOf(step)
    if (groups.length <= 1) return
    const [gone] = groups.splice(gi, 1)
    groups[0] = [...groups[0]!, ...(gone ?? [])]
    step.groups = groups
  }
  const groupOf = (step: PlanStep, key: string) => groupsOf(step).findIndex((g) => g.includes(key))

  return {
    draft, runDefault, simAt, byKey, openTickets, placed, unplaced, openBlockers, implementSteps, problems, problemsOf, problemsForTicket,
    dispatchOf, orchestrated, groupsOf, summaryOf, modelLabel, simState, locked,
    addStep, removeStep, move, takeOut, assign, addGroup, removeGroup, groupOf, isHitl,
  }
}

export const STEP_ICON: Record<PlanStepKind, string> = { implement: 'i-lucide-hammer', merge: 'i-lucide-git-merge', review: 'i-lucide-scan-eye', gate: 'i-lucide-hand' }
