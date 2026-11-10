<script setup lang="ts">
// Run setup — the project page's tab for building a run plan by hand
// (~/utils/runPlan.ts). The tab is a BOARD of the plan's steps, read top to
// bottom; every edit is behind a modal. Adding an implement step is a
// three-step wizard — pick the tickets, say who runs each (its own agent, or
// an orchestrator with others — model and effort per agent), confirm — and
// confirm puts it on the board. Merge / review / gate steps have a small
// modal each; clicking a step card reopens its modal to edit, move or remove
// it. Started, the plan is walked by auto mode's engine (the jButton turns
// on and <AutoLoopPanel> shows the step in progress); the steps it has
// started are locked and show what they did — the slice report their
// sessions read, their reviews, the fixes they filed.
// Every edit saves straight away (PUT …/run-plan); a half-built draft is
// fine, and the problems that would stop it running show on the cards.
// Started, the plan is locked whole — Unlock & stop ends the run. A run that
// ended early leaves where it got to (auto.resume): Continue plan picks the
// plan up at that step, its finished steps shown done, and only the steps
// from there on are checked — Start from the top is the other button. The Build
// button hands the whole job to one Fable 5.2 session (`/jrunplan`): while
// it works (project.runPlanBuild) the tab is read-only too.
import type { Project, Ticket } from '~/composables/useTracker'
import { resumePlanRun, type PlanStepRecord } from '~/utils/autoLoop'
import type { GraphTicketInfo } from '~/utils/runPlanGraph'
import {
  ARCH_DEFAULT,
  DEFAULT_DISPATCH,
  EFFORTS,
  PLAN_MODELS,
  PLAN_MODEL_KEYS,
  BUDGET_MIN,
  GROUP_MIN,
  STEP_BUDGET_MAX,
  STEP_ORCHESTRATORS_MAX,
  STEP_SESSIONS_MAX,
  stepShape,
  stepShapeLabel,
  PLAN_REVIEWERS_MAX,
  PLAN_REVIEWERS_MIN,
  REVIEW_DEFAULT,
  coerceRunPlan,
  implementSummary,
  newPlanStep,
  planProblems,
  reviewBaseOptions,
  reviewSummary,
  runnerLabel,
  runnerOf,
  soloTickets,
  stepGroupEntries,
  stepGroups,
  type Effort,
  type PlanModel,
  type PlanStep,
  type PlanStepKind,
  type PlanTicket,
  type RunPlan,
  type Runner,
} from '~/utils/runPlan'

const props = defineProps<{ project: Project; tickets: Ticket[]; allTickets: Ticket[] }>()
const { busy, startPlan, resumePlan, turnOff } = useAutoLoop()
const { refresh } = useTracker()
const { openEditTicket } = useTrackerModals()
const toast = useToast()

const STEP_ICONS: Record<PlanStepKind, string> = {
  implement: 'i-lucide-hammer',
  merge: 'i-lucide-git-merge',
  review: 'i-lucide-scan-eye',
  gate: 'i-lucide-hand',
}

// ── The draft ──────────────────────────────────────────────────────────────
// A local copy the modals edit; saved on every confirm. The server's copy
// (project.runPlan, over /api/stream) replaces it whenever no save is pending.
const empty = (): RunPlan => ({ steps: [] })
const draft = ref<RunPlan>(coerceRunPlan(structuredClone(toRaw(props.project.runPlan))) ?? empty())
let saving = 0
watch(
  () => props.project.runPlan,
  (plan) => {
    if (!saving) draft.value = coerceRunPlan(structuredClone(toRaw(plan))) ?? empty()
  },
  { deep: true },
)
async function save() {
  saving++
  try {
    await $fetch(`/api/projects/${props.project.id}/run-plan`, { method: 'PUT', body: draft.value })
  } catch (err: any) {
    toast.add({
      title: 'Run setup',
      description: String(err?.data?.statusMessage ?? err?.data?.message ?? err?.message ?? err),
      icon: 'i-lucide-triangle-alert',
      color: 'error',
    })
    draft.value = coerceRunPlan(structuredClone(toRaw(props.project.runPlan))) ?? empty()
  } finally {
    saving = 0
    await refresh()
  }
}

// ── Running state ──────────────────────────────────────────────────────────
const auto = computed(() => props.project.auto ?? null)
const planRunning = computed(() => !!auto.value?.enabled && !!auto.value.plan)
const loopRunning = computed(() => !!auto.value?.enabled && !auto.value.plan)
// A /jrunplan session is writing the plan — it owns the draft until it reports back.
const building = computed(() => !!props.project.runPlanBuild)
// The plan can be edited: not running (locked whole), not being built.
const editable = computed(() => !planRunning.value && !building.value)
// A stopped run, and where the draft would pick it up (matched by step id, so
// edits since the stop are allowed for — utils/autoLoop.ts resumePlanRun).
const resume = computed(() => (!auto.value?.enabled && auto.value?.resume) || null)
const resumeStart = computed(() => (resume.value ? resumePlanRun(resume.value, draft.value) : null))
// Continue has something to do: a stopped run, and a step left after where it got to.
const canResume = computed(() => !!resumeStart.value && resumeStart.value.cursor < draft.value.steps.length)
// Steps the running plan has started (finished, skipped, or in progress) are
// locked. Stopped, the steps the run finished aren't locked — but they're not
// re-checked either: Continue skips them, and their tickets have moved on.
const frozen = computed(() => {
  const a = auto.value
  if (planRunning.value && a) return a.cursor + (a.phase === 'idle' ? 0 : 1)
  if (canResume.value) return resumeStart.value!.cursor
  return 0
})
const locked = (i: number) => !editable.value || (planRunning.value && i < frozen.value)
const recordOf = (i: number): PlanStepRecord | undefined => (planRunning.value ? auto.value?.planLog[i] : canResume.value ? resumeStart.value!.planLog[i] : undefined)
function stepState(i: number): { label: string; color: 'success' | 'info' | 'neutral' | 'warning' } | null {
  const a = auto.value
  if (canResume.value) {
    const { cursor } = resumeStart.value!
    const record = recordOf(i)
    if (i < cursor) return record?.skipped ? { label: `skipped — ${record.skipped}`, color: 'neutral' } : { label: 'done', color: 'success' }
    if (i === cursor) return { label: 'continues here', color: 'warning' }
    return null
  }
  if (!planRunning.value || !a) return null
  const record = a.planLog[i]
  if (i < a.cursor) return record?.skipped ? { label: `skipped — ${record.skipped}`, color: 'neutral' } : { label: 'done', color: 'success' }
  if (i === a.cursor && a.phase !== 'idle') return { label: a.paused ? 'paused' : a.phase === 'slice-reporting' ? 'writing the slice report' : 'running', color: a.paused ? 'warning' : 'info' }
  if (i === a.cursor) return { label: 'next', color: 'info' }
  return null
}
// The slice report an implement step's sessions read: recorded once it ran; while it runs, the loop's latest.
const sliceDocOf = (i: number) => recordOf(i)?.sliceDoc || (planRunning.value && auto.value?.cursor === i ? auto.value.lastSliceDoc : '')
const readsSlice = (i: number) => draft.value.steps[i]?.kind === 'implement' && draft.value.steps.slice(0, i).some((s) => s.kind === 'implement')

// ── Board or graph ─────────────────────────────────────────────────────────
// The same plan two ways: the board (cards, top to bottom) or the graph
// (RunPlanGraph: ticket cards, orchestrator boxes, review brackets, blocker
// arrows). Remembered per browser.
const view = ref<'board' | 'graph'>('board')
const VIEW_KEY = 'jticket:run-setup:view'
onMounted(() => {
  try {
    if (localStorage.getItem(VIEW_KEY) === 'graph') view.value = 'graph'
  } catch {}
})
watch(view, (v) => {
  try {
    localStorage.setItem(VIEW_KEY, v)
  } catch {}
})
const graphInfo = computed<Record<string, GraphTicketInfo>>(() => {
  const mine = new Set(props.tickets.map((t) => t.id))
  const outside = [...new Set(props.tickets.flatMap((t) => t.blockedBy))].filter((id) => !mine.has(id))
  const rows = [...props.tickets, ...outside.map((id) => byId.value.get(id)).filter((t): t is Ticket => !!t)]
  return Object.fromEntries(
    rows.map((t) => [
      t.key,
      { key: t.key, title: t.title, hitl: isHitl(t), paused: isPaused(t), finished: isFinished(t.status), blockedBy: t.blockedBy.map((id) => byId.value.get(id)?.key).filter((k): k is string => !!k) },
    ]),
  )
})
const graphStates = computed(() => draft.value.steps.map((_, i) => stepState(i)))
const graphRecords = computed(() => draft.value.steps.map((_, i) => recordOf(i)))
const graphSliceDocs = computed(() => draft.value.steps.map((_, i) => sliceDocOf(i)))
function editAt(i: number) {
  const step = draft.value.steps[i]
  if (step) startEdit(step, i)
}
function openKey(key: string) {
  const t = byKey.value.get(key)
  if (t) openEditTicket(t)
}

// ── Tickets ────────────────────────────────────────────────────────────────
const byKey = computed(() => new Map(props.allTickets.map((t) => [t.key, t])))
const byId = computed(() => new Map(props.allTickets.map((t) => [t.id, t])))
const placed = computed(() => new Map(draft.value.steps.flatMap((s, i) => s.tickets.map((k) => [k, i] as const))))
const openTickets = computed(() =>
  props.tickets
    .filter((t) => !isFinished(t.status))
    .sort((a, b) => Number(a.key.split('-').pop()) - Number(b.key.split('-').pop())),
)
const unplaced = computed(() => openTickets.value.filter((t) => !placed.value.has(t.key)))
const openBlockers = (t: Ticket) => openBlockersOf(t, props.allTickets)
const planTickets = computed<PlanTicket[]>(() => {
  const mine = new Set(props.tickets.map((t) => t.id))
  const outside = [...new Set(props.tickets.flatMap((t) => t.blockedBy))].filter((id) => !mine.has(id))
  return [...props.tickets, ...outside.map((id) => byId.value.get(id)).filter((t): t is Ticket => !!t)].map((t) => ({
    key: t.key,
    status: t.status,
    blockedBy: t.blockedBy.map((id) => byId.value.get(id)?.key).filter((k): k is string => !!k),
  }))
})
const problems = computed(() => planProblems(draft.value, planTickets.value, { frozen: frozen.value }))
const problemsOf = (id: string) => problems.value.filter((p) => p.stepId === id)
const problemsForTicket = (key: string) => problems.value.filter((p) => p.message.startsWith(`${key} `))
const planWide = computed(() => problems.value.filter((p) => !p.stepId))

// What a step's agents run as. A step always carries its own dispatch once
// the wizard has touched it; an older one falls back to the run's setting.
const runDefault = computed(() => auto.value?.orchestration ?? DEFAULT_DISPATCH)
const stepSummary = (s: PlanStep) => {
  if (s.kind === 'implement') return implementSummary(s, runDefault.value)
  if (s.kind === 'review') return reviewSummary(s)
  if (s.kind === 'gate') return `waits for Continue${s.note ? ` — ${s.note}` : ''}`
  return 'lands every open PR the plan has so far on the integration branch'
}
const soloRunner = (s: PlanStep, k: string) => runnerOf(s, k, runDefault.value)
const groupEntries = (s: PlanStep) => stepGroupEntries(s, runDefault.value)
// The step's shape under the concurrency rule — how many own agents run at once, which queue.
const shapeOf = (s: PlanStep) => stepShape(s)
const shapeLabel = (s: PlanStep) => stepShapeLabel(s, runDefault.value)
const stepBudget = (s: PlanStep) => (s.dispatch ?? runDefault.value).budget

// ── The modal ──────────────────────────────────────────────────────────────
const open = ref(false)
const editing = ref<PlanStep | null>(null) // null = adding
const kind = ref<PlanStepKind>('implement')
const wizard = ref(0) // implement: 0 tickets, 1 who runs each, 2 confirm
const picked = ref<string[]>([])
const search = ref('')
const model = ref<PlanModel>(DEFAULT_DISPATCH.model)
const effort = ref<Effort>(DEFAULT_DISPATCH.effort)
const budget = ref(DEFAULT_DISPATCH.budget)
const groups = ref<string[][]>([])
// One per group, aligned with `groups`: the orchestrator's own model/effort for its subagents (null = the step's).
const groupRunners = ref<Array<Runner | null>>([])
const runners = ref<Record<string, Runner>>({})
const reviewers = ref(PLAN_REVIEWERS_MIN)
const base = ref('')
const review = ref({ ...REVIEW_DEFAULT, arch: null as Runner | null })
const note = ref('')
const position = ref(0)

function reset() {
  wizard.value = 0
  picked.value = []
  search.value = ''
  model.value = DEFAULT_DISPATCH.model
  effort.value = DEFAULT_DISPATCH.effort
  budget.value = DEFAULT_DISPATCH.budget
  groups.value = []
  groupRunners.value = []
  runners.value = {}
  reviewers.value = PLAN_REVIEWERS_MIN
  base.value = ''
  review.value = { ...REVIEW_DEFAULT, arch: null }
  note.value = ''
}
function startAdd(k: PlanStepKind) {
  reset()
  editing.value = null
  kind.value = k
  position.value = draft.value.steps.length
  if (k === 'merge') {
    draft.value.steps.push(newPlanStep(draft.value, 'merge'))
    void save()
    return
  }
  open.value = true
}
function startEdit(step: PlanStep, i: number) {
  if (locked(i)) return
  reset()
  editing.value = step
  kind.value = step.kind
  position.value = i
  picked.value = [...step.tickets]
  const d = step.dispatch ?? runDefault.value
  model.value = d.model
  effort.value = d.effort
  budget.value = d.budget
  const entries = groupEntries(step)
  groups.value = entries.map((e) => [...e.tickets])
  groupRunners.value = entries.map((e) => (e.runner.model === d.model && e.runner.effort === d.effort ? null : { ...e.runner }))
  runners.value = { ...step.runners }
  reviewers.value = step.reviewers
  base.value = step.base
  review.value = { ...step.review, arch: step.review.arch ? { ...step.review.arch } : null }
  note.value = step.note
  wizard.value = step.kind === 'implement' ? 2 : 0
  open.value = true
}

// Wizard 1 · tickets: the open tickets not placed in another step.
const choices = computed(() => {
  const s = search.value.trim().toLowerCase()
  return openTickets.value
    .filter((t) => {
      const at = placed.value.get(t.key)
      return at === undefined || (editing.value && draft.value.steps[at]?.id === editing.value.id)
    })
    .filter((t) => !s || t.key.toLowerCase().includes(s) || t.title.toLowerCase().includes(s))
})
const togglePick = (k: string, on: boolean) => {
  picked.value = on ? [...new Set([...picked.value, k])] : picked.value.filter((x) => x !== k)
}
// Where a blocker sits, from the new step's point of view.
function blockerWhere(b: Ticket): { label: string; color: 'success' | 'info' | 'error' | 'warning' } {
  if (isFinished(b.status)) return { label: 'done', color: 'success' }
  const i = placed.value.get(b.key)
  if (i !== undefined && !(editing.value && draft.value.steps[i]?.id === editing.value.id)) return { label: `step ${i + 1}`, color: i < position.value ? 'info' : 'error' }
  if (picked.value.includes(b.key)) return { label: 'this step', color: 'error' }
  if (!props.tickets.some((t) => t.id === b.id)) return { label: 'other project', color: 'warning' }
  return { label: 'not in plan', color: 'error' }
}

// Wizard 2 · who runs each: `groups` = the orchestrators' tickets; a picked
// ticket in no group runs as its own agent, on `runners[k]` or the step's model/effort.
// Groups and their runners move together: dropping an emptied group drops its runner.
function setGroups(next: Array<{ tickets: string[]; runner: Runner | null }>) {
  const kept = next.filter((e) => e.tickets.length)
  groups.value = kept.map((e) => e.tickets)
  groupRunners.value = kept.map((e) => e.runner)
}
const groupPairs = () => groups.value.map((g, i) => ({ tickets: [...g], runner: groupRunners.value[i] ?? null }))
watch(picked, (keys) => {
  setGroups(groupPairs().map((e) => ({ ...e, tickets: e.tickets.filter((k) => keys.includes(k)) })))
  for (const k of Object.keys(runners.value)) if (!keys.includes(k)) delete runners.value[k]
})
const solos = computed(() => picked.value.filter((k) => !groups.value.some((g) => g.includes(k))))
// The queue: `picked` is the step's ticket order — own agents start in it, as sessions allow.
function moveTicket(k: string, by: -1 | 1) {
  const i = picked.value.indexOf(k)
  const j = i + by
  if (i < 0 || j < 0 || j >= picked.value.length) return
  const next = [...picked.value]
  next.splice(i, 1)
  next.splice(j, 0, k)
  picked.value = next
}
const liveGroups = computed(() => groups.value.filter((g) => g.length).length)
const builtShape = computed(() => stepShape({ tickets: picked.value, groups: groups.value }))
const soloPlace = (k: string) => solos.value.indexOf(k) + 1
const soloQueued = (k: string) => soloPlace(k) > builtShape.value.soloSlots
const runnerIdOf = (k: string): string => {
  const gi = groups.value.findIndex((g) => g.includes(k))
  return gi < 0 ? 'solo' : String(gi)
}
function setRunnerId(k: string, v: string) {
  const next = groupPairs().map((e) => ({ ...e, tickets: e.tickets.filter((x) => x !== k) }))
  if (v !== 'solo') {
    const gi = Number(v)
    while (next.length <= gi) next.push({ tickets: [], runner: null })
    next[gi]!.tickets.push(k)
    delete runners.value[k]
  }
  setGroups(next)
}
// An orchestrator group's own runner — shown as the step's until changed; set back to the step's = cleared.
const groupRunnerFor = (gi: number): Runner => groupRunners.value[gi] ?? { model: model.value, effort: effort.value }
function setGroupRunner(gi: number, patch: Partial<Runner>) {
  const next = { ...groupRunnerFor(gi), ...patch }
  const list = groups.value.map((_, i) => groupRunners.value[i] ?? null)
  list[gi] = next.model === model.value && next.effort === effort.value ? null : next
  groupRunners.value = list
}
// Two orchestrators run alone: with both boxes filled, "its own agent" is off the menu.
const runnerItems = computed(() => [
  { label: 'Its own agent', value: 'solo', disabled: liveGroups.value >= STEP_ORCHESTRATORS_MAX },
  ...groups.value.map((g, i) => ({ label: `Orchestrator ${i + 1} (${g.length})`, value: String(i) })),
  ...(groups.value.length < STEP_ORCHESTRATORS_MAX ? [{ label: `+ New orchestrator ${groups.value.length + 1}`, value: String(groups.value.length) }] : []),
])
const soloOf = (k: string): Runner => runners.value[k] ?? { model: model.value, effort: effort.value }
function setSolo(k: string, patch: Partial<Runner>) {
  const next = { ...soloOf(k), ...patch }
  if (next.model === model.value && next.effort === effort.value) delete runners.value[k]
  else runners.value[k] = next
}
const modelItems = PLAN_MODEL_KEYS.map((m) => ({ label: PLAN_MODELS[m].label, value: m }))
const effortItems = EFFORTS.map((e) => ({ label: e, value: e }))
// Never 1: an orchestrator running one subagent at a time costs more than the work (BUDGET_MIN).
const budgetItems = Array.from({ length: STEP_BUDGET_MAX - BUDGET_MIN + 1 }, (_, i) => ({ label: String(BUDGET_MIN + i), value: BUDGET_MIN + i }))
const reviewerItems = Array.from({ length: PLAN_REVIEWERS_MAX - PLAN_REVIEWERS_MIN + 1 }, (_, i) => ({ label: `${PLAN_REVIEWERS_MIN + i} reviewers`, value: PLAN_REVIEWERS_MIN + i }))

// What the step would be, as built so far — and the plan with it in, validated.
const built = computed<PlanStep>(() => {
  const stepBase = editing.value ?? newPlanStep(draft.value, kind.value)
  const orch = groups.value.filter((g) => g.length)
  const implement = kind.value === 'implement'
  return {
    ...stepBase,
    kind: kind.value,
    tickets: implement ? [...picked.value] : [],
    dispatch: implement ? { mode: orch.length ? 'orchestrated' : 'sessions', model: model.value, effort: effort.value, budget: budget.value, orchestrators: Math.max(1, orch.length) } : null,
    groups: implement ? orch.map((g) => [...g]) : [],
    groupRunners: implement ? orch.map((_, i) => groupRunners.value[i] ?? null) : [],
    runners: implement ? Object.fromEntries(Object.entries(runners.value).filter(([k]) => solos.value.includes(k))) : {},
    reviewers: kind.value === 'review' ? reviewers.value : stepBase.reviewers,
    base: kind.value === 'review' ? base.value : '',
    review: kind.value === 'review' ? { ...review.value, arch: review.value.arch ? { ...review.value.arch } : null } : stepBase.review,
    note: kind.value === 'gate' ? note.value.trim() : '',
  }
})
const previewPlan = computed<RunPlan>(() => {
  const steps = draft.value.steps.filter((s) => s.id !== editing.value?.id)
  steps.splice(Math.min(position.value, steps.length), 0, built.value)
  return { steps }
})
const previewProblems = computed(() => planProblems(previewPlan.value, planTickets.value, { frozen: frozen.value }).filter((p) => p.stepId === built.value.id))
const summary = computed(() => (kind.value === 'implement' ? implementSummary(built.value, runDefault.value) : reviewSummary(built.value)))
const builtShapeLabel = computed(() => stepShapeLabel(built.value, runDefault.value))
const positionItems = computed(() => {
  const n = draft.value.steps.filter((s) => s.id !== editing.value?.id).length
  return Array.from({ length: n - frozen.value + 1 }, (_, i) => frozen.value + i).map((i) => ({ label: i === 0 ? 'first' : i === n ? 'last' : `after step ${i}`, value: i }))
})
const readsSliceAt = (pos: number) => previewPlan.value.steps.slice(0, pos).some((s) => s.kind === 'implement')

async function confirm() {
  draft.value = previewPlan.value
  open.value = false
  await save()
}
async function removeEditing() {
  if (!editing.value) return
  const gone = editing.value
  draft.value.steps = draft.value.steps.filter((s) => s.id !== gone.id)
  for (const s of draft.value.steps) if (s.base === gone.id) s.base = ''
  open.value = false
  await save()
}
async function clearPlan() {
  if (!window.confirm('Clear the whole plan?')) return
  draft.value = empty()
  await save()
}

// ── Building with an agent ─────────────────────────────────────────────────
// One Fable 5.2 session reads the project and writes the plan (POST
// …/run-plan/build → /jrunplan in herdr). It replaces whatever is drafted.
const buildBusy = ref<'' | 'build' | 'cancel'>('')
const buildBlocker = computed(() => {
  if (!props.project.repo) return 'This project has no repo — set one first; the builder reads its code.'
  if (loopRunning.value) return 'The jButton loop is running — turn it off first.'
  return ''
})
async function buildWithAgent() {
  if (buildBlocker.value || !editable.value) return
  const n = draft.value.steps.length
  if (n && !window.confirm(`Replace the current plan (${n} step${n === 1 ? '' : 's'}) with one Fable 5.2 builds? It reads the project, its docs, every open ticket and the code, then writes the plan here.`)) return
  buildBusy.value = 'build'
  try {
    await $fetch(`/api/projects/${props.project.id}/run-plan/build`, { method: 'POST', body: {} })
    toast.add({ title: 'Run setup', description: 'Fable 5.2 is building the plan in herdr — this tab is read-only until it reports back.', icon: 'i-lucide-wand-sparkles' })
  } catch (err: any) {
    toast.add({ title: 'Run setup', description: String(err?.data?.statusMessage ?? err?.data?.message ?? err?.message ?? err), icon: 'i-lucide-triangle-alert', color: 'error' })
  } finally {
    buildBusy.value = ''
    await refresh()
  }
}
async function cancelBuild() {
  if (!window.confirm('Cancel the build? Its herdr pane is closed; whatever it saved so far stays as the draft.')) return
  buildBusy.value = 'cancel'
  try {
    await $fetch(`/api/projects/${props.project.id}/run-plan/build`, { method: 'DELETE' })
  } catch (err: any) {
    toast.add({ title: 'Run setup', description: String(err?.data?.statusMessage ?? err?.data?.message ?? err?.message ?? err), icon: 'i-lucide-triangle-alert', color: 'error' })
  } finally {
    buildBusy.value = ''
    await refresh()
  }
}

// ── Unlocking ──────────────────────────────────────────────────────────────
// A running plan is locked whole. Unlocking it IS stopping the run (auto
// turns off now; sessions already in herdr carry on) — the strip's "Stop
// after this step" is the gentler way out.
async function unlockAndStop() {
  const n = (auto.value?.cursor ?? 0) + 1
  if (!window.confirm(`Unlock ${props.project.key}'s plan? That stops the run now — step ${n} is abandoned (sessions already running in herdr carry on), and Continue plan picks it up again from step ${n}. To finish the step first, use "Stop after this step" on the strip above.`)) return
  await turnOff(props.project).catch(() => {})
}
const canNext = computed(() => (wizard.value === 0 ? picked.value.length > 0 : true))
const title = computed(() => {
  const what = editing.value ? `Edit step ${position.value + 1}` : 'Add a step'
  if (kind.value !== 'implement') return `${what} · ${kind.value}`
  return `${what} · implement · ${['1 of 3 — pick the tickets', '2 of 3 — who runs each', '3 of 3 — confirm'][wizard.value]}`
})

// ── Starting ───────────────────────────────────────────────────────────────
// With a stopped run to continue, Continue plan is the main button and
// `problems` covers only the steps from there on; Start from the top is
// checked whole by the server (its 409 comes back as a toast).
const startBlocker = computed(() => {
  const p = props.project
  if (!p.repo) return 'This project has no repo — set one first.'
  if (!p.integrationBranch) return 'Cut an integration branch first (the Branch button) — merges land on it.'
  if (loopRunning.value) return 'The jButton loop is running — turn it off to run a plan instead.'
  if (!canResume.value && !draft.value.steps.some((s) => s.kind === 'implement')) return 'Add an implement step — nothing would run.'
  if (problems.value.length) return 'Fix the problems on the cards first.'
  return ''
})
const resumeLabel = computed(() => (canResume.value ? `Continue plan · step ${resumeStart.value!.cursor + 1}` : 'Continue plan'))
const stoppedAgo = computed(() => (resume.value?.stoppedAt ? new Date(resume.value.stoppedAt).toLocaleString() : ''))
async function start() {
  if (startBlocker.value) return
  const n = draft.value.steps.length
  const again = canResume.value ? ` The stopped run is forgotten: steps it already finished run again (finished tickets are skipped, reviews are not).` : ''
  if (!window.confirm(`Run ${props.project.key}'s plan — ${n} step${n === 1 ? '' : 's'}, top to bottom? Hand dispatch of AFK tickets is off while it runs.${again}`)) return
  await startPlan(props.project).catch(() => {})
}
async function resumeRun() {
  if (startBlocker.value || !canResume.value) return
  const { cursor } = resumeStart.value!
  const left = draft.value.steps.length - cursor
  if (!window.confirm(`Continue ${props.project.key}'s plan from step ${cursor + 1} — ${left} step${left === 1 ? '' : 's'} left? The steps before it stay done; its checkpoints carry over. Hand dispatch of AFK tickets is off while it runs.`)) return
  await resumePlan(props.project).catch(() => {})
}
</script>

<template>
  <section class="flex flex-col gap-3">
    <!-- Header: the view's controls only -->
    <div class="flex flex-wrap items-center gap-2 rounded-lg border border-default bg-elevated/30 px-4 py-2.5 text-sm">
      <UIcon name="i-lucide-list-ordered" class="size-4 text-primary" />
      <span class="font-semibold">Run setup</span>
      <UBadge color="neutral" variant="subtle" size="sm">{{ draft.steps.length }} step{{ draft.steps.length === 1 ? '' : 's' }}</UBadge>
      <UBadge v-if="unplaced.length" color="warning" variant="subtle" size="sm">{{ unplaced.length }} open ticket{{ unplaced.length === 1 ? '' : 's' }} not in the plan</UBadge>
      <div class="flex overflow-hidden rounded-md border border-default text-xs" role="tablist" aria-label="Board or graph">
        <button type="button" role="tab" class="flex items-center gap-1 px-2 py-1" :class="view === 'board' ? 'bg-primary text-inverted' : 'text-muted hover:bg-elevated'" :aria-selected="view === 'board'" @click="view = 'board'"><UIcon name="i-lucide-layout-list" class="size-3.5" /> Board</button>
        <button type="button" role="tab" class="flex items-center gap-1 px-2 py-1" :class="view === 'graph' ? 'bg-primary text-inverted' : 'text-muted hover:bg-elevated'" :aria-selected="view === 'graph'" @click="view = 'graph'"><UIcon name="i-lucide-git-fork" class="size-3.5" /> Graph</button>
      </div>
      <UBadge v-if="planRunning" color="success" variant="subtle" size="sm" icon="i-lucide-lock">running · step {{ (auto?.cursor ?? 0) + 1 }} of {{ draft.steps.length }} · locked</UBadge>
      <UBadge v-else-if="canResume" color="warning" variant="subtle" size="sm" icon="i-lucide-octagon-pause">stopped · continues at step {{ resumeStart!.cursor + 1 }} of {{ draft.steps.length }}</UBadge>
      <UBadge v-else-if="building" color="primary" variant="subtle" size="sm" icon="i-lucide-loader-circle" :ui="{ leadingIcon: 'animate-spin' }">Fable 5.2 is building the plan · read-only</UBadge>
      <div class="ml-auto flex flex-wrap items-center justify-end gap-2">
        <!-- running: the one way to edit is to stop -->
        <template v-if="planRunning">
          <UTooltip text="Stops the run now and unlocks the plan. To finish the step in progress first, use Stop after this step on the strip above.">
            <UButton icon="i-lucide-lock-open" color="warning" variant="soft" size="sm" :loading="busy === 'off'" @click="unlockAndStop">Unlock &amp; stop</UButton>
          </UTooltip>
        </template>
        <!-- building: the agent owns the draft -->
        <template v-else-if="building">
          <span class="text-xs text-muted">since {{ new Date(project.runPlanBuild!.startedAt).toLocaleTimeString() }} · pane {{ project.runPlanBuild!.agent }}</span>
          <UButton icon="i-lucide-x" color="neutral" variant="soft" size="sm" :loading="buildBusy === 'cancel'" @click="cancelBuild">Cancel build</UButton>
        </template>
        <template v-else>
          <span v-if="startBlocker" class="text-xs text-warning">{{ startBlocker }}</span>
          <UButton v-if="draft.steps.length" size="xs" variant="ghost" color="neutral" icon="i-lucide-eraser" @click="clearPlan">Clear</UButton>
          <UTooltip :text="buildBlocker || 'One Fable 5.2 session (high effort) reads the project, its docs, every open ticket and the code, and writes the plan — who runs what, on which model and effort, with merges, reviews and gates where they belong'">
            <UButton icon="i-lucide-wand-sparkles" color="primary" variant="soft" size="sm" :loading="buildBusy === 'build'" :disabled="!!buildBlocker || !!busy" @click="buildWithAgent">Build with Fable</UButton>
          </UTooltip>
          <template v-if="canResume">
            <UTooltip :text="startBlocker || `Start the plan again from step 1 — the run stopped ${stoppedAgo} is forgotten`">
              <UButton icon="i-lucide-rotate-ccw" color="neutral" variant="soft" size="sm" :loading="busy === 'plan'" :disabled="!!startBlocker || !!busy || !!buildBusy" @click="start">Start from the top</UButton>
            </UTooltip>
            <UTooltip :text="startBlocker || `Pick the plan up where the run stopped ${stoppedAgo}: steps ${resumeStart!.cursor} and before stay done, step ${resumeStart!.cursor + 1} runs next; the plan locks until the run ends`">
              <UButton icon="i-lucide-step-forward" color="success" size="sm" :loading="busy === 'resume'" :disabled="!!startBlocker || !!busy || !!buildBusy" @click="resumeRun">{{ resumeLabel }}</UButton>
            </UTooltip>
          </template>
          <UTooltip v-else :text="startBlocker || 'Start the plan — the jButton turns on and walks it; the plan locks until the run ends'">
            <UButton icon="i-lucide-play" color="success" size="sm" :loading="busy === 'plan'" :disabled="!!startBlocker || !!busy || !!buildBusy" @click="start">Start plan</UButton>
          </UTooltip>
        </template>
      </div>
    </div>

    <!-- The graph: every step, ticket, orchestrator box, review range and blocker arrow at once -->
    <div v-if="view === 'graph' && draft.steps.length" class="w-full">
      <RunPlanGraph
        :plan="draft"
        :info="graphInfo"
        :run-default="runDefault"
        :states="graphStates"
        :records="graphRecords"
        :slice-docs="graphSliceDocs"
        :editable="editable"
        @edit="editAt"
        @open="openKey"
      />
      <ul v-if="problems.length && editable" class="mt-2 text-xs text-error">
        <li v-for="(p, n) in problems" :key="n">⚠ {{ p.message }}</li>
      </ul>
    </div>

    <!-- The board -->
    <div class="mx-auto flex w-full max-w-3xl flex-col gap-2">
      <div
        v-for="(step, i) in draft.steps"
        v-show="view === 'board'"
        :key="step.id"
        class="rounded-lg border bg-default px-4 py-3 transition"
        :class="[
          stepState(i)?.color === 'info' ? 'border-info ring-2 ring-info/30' : stepState(i)?.color === 'success' ? 'border-success/50 bg-success/5' : stepState(i)?.color === 'warning' ? 'border-warning' : 'border-default',
          problemsOf(step.id).length && !locked(i) && 'border-error/60',
          !locked(i) && 'cursor-pointer hover:ring-2 hover:ring-primary/40',
        ]"
        :role="locked(i) ? undefined : 'button'"
        @click="startEdit(step, i)"
      >
        <div class="flex flex-wrap items-center gap-2">
          <span class="flex size-6 items-center justify-center rounded-full bg-elevated text-xs font-medium tabular-nums">{{ i + 1 }}</span>
          <UIcon :name="STEP_ICONS[step.kind]" class="size-4 text-muted" />
          <span class="font-medium capitalize">{{ step.kind }}</span>
          <span class="text-xs text-muted">· {{ stepSummary(step) }}</span>
          <UBadge v-if="stepState(i)" :color="stepState(i)!.color" variant="subtle" size="xs" class="ml-auto">{{ stepState(i)!.label }}</UBadge>
          <UIcon v-else-if="locked(i)" name="i-lucide-lock" class="ml-auto size-3.5 text-dimmed" />
          <UIcon v-else name="i-lucide-pencil" class="ml-auto size-3.5 text-dimmed" />
        </div>

        <!-- implement: the slice report it reads, then its agents -->
        <template v-if="step.kind === 'implement'">
          <div v-if="readsSlice(i)" class="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs">
            <UIcon name="i-lucide-file-text" class="size-3.5 text-primary" />
            <span class="text-muted">Starts by reading the slice report written after step {{ i }} (Opus 5.5 medium, facts only)</span>
            <NuxtLink v-if="sliceDocOf(i)" :to="`/docs/${sliceDocOf(i)}`" class="font-mono text-primary hover:underline" @click.stop>{{ sliceDocOf(i) }} ↗</NuxtLink>
          </div>
          <div class="mt-2 grid gap-2" :class="stepGroups(step).length ? 'sm:grid-cols-2' : ''">
            <div v-if="soloTickets(step).length" class="rounded-md bg-elevated/40 px-2.5 py-2">
              <div class="mb-1 flex items-center gap-1 text-xs text-muted">
                <UIcon name="i-lucide-user-round" class="size-3.5 text-primary" /> Own agent each
                <span v-if="shapeOf(step).soloSlots === 0" class="text-error">· none can run beside {{ shapeOf(step).orchestrators }} orchestrators</span>
                <span v-else-if="shapeOf(step).queued.length" :title="`At most ${STEP_SESSIONS_MAX} sessions run at once in a step (an orchestrator counts as one). The rest start, in this order, as sessions free.`">· {{ shapeOf(step).soloSlots }} at once, in this order</span>
              </div>
              <template v-for="(k, n) in soloTickets(step)" :key="k">
                <div v-if="n === shapeOf(step).soloSlots && n > 0" class="my-1 flex items-center gap-2 text-[10px] uppercase tracking-wide text-amber-600">
                  <span class="h-px flex-1 border-t border-dashed border-amber-500/60" />queued — start as sessions free<span class="h-px flex-1 border-t border-dashed border-amber-500/60" />
                </div>
                <div class="flex items-center gap-1.5 py-0.5 text-sm" :class="n >= shapeOf(step).soloSlots && 'opacity-75'">
                <span class="w-4 shrink-0 text-right text-[10px] tabular-nums" :class="n >= shapeOf(step).soloSlots ? 'text-amber-600' : 'text-dimmed'">{{ n + 1 }}</span>
                <NuxtLink :to="`/tickets/${k}`" class="font-mono text-xs text-muted hover:underline" @click.stop>{{ k }}</NuxtLink>
                <span class="min-w-0 flex-1 truncate">{{ byKey.get(k)?.title ?? '(unknown)' }}</span>
                <UBadge v-if="byKey.get(k) && isHitl(byKey.get(k)!)" color="warning" variant="subtle" size="xs">HITL · waits on you</UBadge>
                <UIcon v-if="byKey.get(k) && isFinished(byKey.get(k)!.status)" name="i-lucide-circle-check" class="size-3.5 shrink-0 text-success" />
                <UTooltip v-if="problemsForTicket(k).length" :text="problemsForTicket(k).map((p) => p.message).join(' ')"><UIcon name="i-lucide-triangle-alert" class="size-3.5 shrink-0 text-error" /></UTooltip>
                <span class="shrink-0 text-xs text-muted">{{ runnerLabel(soloRunner(step, k)) }}</span>
                </div>
              </template>
            </div>
            <div v-for="(e, gi) in groupEntries(step)" :key="gi" class="rounded-md bg-elevated/40 px-2.5 py-2">
              <div class="mb-1 flex items-center gap-1 text-xs text-muted"><UIcon name="i-lucide-bot" class="size-3.5 text-primary" /> Orchestrator {{ gi + 1 }} · {{ runnerLabel(e.runner) }} subagents · {{ stepBudget(step) }} in flight</div>
              <div v-for="k in e.tickets" :key="k" class="flex items-center gap-1.5 py-0.5 text-sm">
                <NuxtLink :to="`/tickets/${k}`" class="font-mono text-xs text-muted hover:underline" @click.stop>{{ k }}</NuxtLink>
                <span class="min-w-0 flex-1 truncate">{{ byKey.get(k)?.title ?? '(unknown)' }}</span>
                <UIcon v-if="byKey.get(k) && isFinished(byKey.get(k)!.status)" name="i-lucide-circle-check" class="size-3.5 shrink-0 text-success" />
                <UTooltip v-if="problemsForTicket(k).length" :text="problemsForTicket(k).map((p) => p.message).join(' ')"><UIcon name="i-lucide-triangle-alert" class="size-3.5 shrink-0 text-error" /></UTooltip>
              </div>
            </div>
            <span v-if="!step.tickets.length" class="text-xs text-dimmed">no tickets</span>
          </div>
        </template>

        <!-- what a started step did -->
        <div v-if="recordOf(i) && !recordOf(i)!.skipped" class="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
          <a v-if="recordOf(i)!.archReviewKey" :href="`https://jreview.local/r/${recordOf(i)!.archReviewKey}`" target="_blank" class="text-primary hover:underline" @click.stop>architectural review ↗</a>
          <a v-if="recordOf(i)!.reviewKey" :href="`https://jreview.local/r/${recordOf(i)!.reviewKey}`" target="_blank" class="text-primary hover:underline" @click.stop>review ↗</a>
          <span v-if="recordOf(i)!.fixTickets.length">fixed: {{ recordOf(i)!.fixTickets.join(', ') }}</span>
          <span v-if="recordOf(i)!.forced?.length">closed by the watchdog: {{ recordOf(i)!.forced!.join(', ') }}</span>
        </div>
        <ul v-if="problemsOf(step.id).length && !locked(i)" class="mt-1.5 text-xs text-error">
          <li v-for="(p, n) in problemsOf(step.id)" :key="n">⚠ {{ p.message }}</li>
        </ul>
      </div>

      <p v-if="!draft.steps.length && !building" class="rounded-lg border border-dashed border-default px-4 py-8 text-center text-sm text-muted">No steps yet. Add the first one below — or let Fable 5.2 build the plan.</p>
      <p v-if="building" class="flex items-center justify-center gap-2 rounded-lg border border-dashed border-primary/40 px-4 py-4 text-center text-sm text-muted">
        <UIcon name="i-lucide-loader-circle" class="size-4 animate-spin text-primary" /> Fable 5.2 is reading the project and writing the plan in herdr; the steps appear here as it saves them.
      </p>
      <UAlert v-if="planWide.length && editable && view === 'board'" color="warning" variant="subtle" icon="i-lucide-triangle-alert" :description="planWide.map((p) => p.message).join(' ')" />

      <!-- Add — the only affordance on the board -->
      <div v-if="editable" class="flex flex-wrap items-center justify-center gap-1.5 pt-1">
        <UButton size="sm" :icon="STEP_ICONS.implement" @click="startAdd('implement')">Add implement step</UButton>
        <UButton size="sm" variant="soft" color="neutral" :icon="STEP_ICONS.merge" @click="startAdd('merge')">Merge</UButton>
        <UButton size="sm" variant="soft" color="neutral" :icon="STEP_ICONS.review" @click="startAdd('review')">Review</UButton>
        <UButton size="sm" variant="soft" color="neutral" :icon="STEP_ICONS.gate" @click="startAdd('gate')">Gate</UButton>
      </div>
    </div>

    <!-- The modal -->
    <UModal v-model:open="open" :title="title" :ui="{ content: 'sm:max-w-3xl' }">
      <template #body>
        <!-- implement wizard -->
        <template v-if="kind === 'implement'">
          <div class="mb-3 flex items-center gap-2 text-xs">
            <template v-for="(label, n) in ['Tickets', 'Who runs each', 'Confirm']" :key="n">
              <button
                type="button"
                class="flex items-center gap-1.5 rounded-full px-2.5 py-1"
                :class="wizard === n ? 'bg-primary text-inverted' : n < wizard ? 'bg-primary/15 text-primary' : 'bg-elevated text-muted'"
                :disabled="n > wizard && !canNext"
                @click="n <= wizard || canNext ? (wizard = n) : null"
              >
                <span class="flex size-4 items-center justify-center rounded-full bg-white/20 text-[10px]">{{ n + 1 }}</span>{{ label }}
              </button>
              <div v-if="n < 2" class="h-px w-6 bg-default" />
            </template>
          </div>

          <!-- 1 · tickets -->
          <div v-if="wizard === 0" class="flex flex-col gap-2">
            <div class="flex items-center gap-2">
              <UInput v-model="search" icon="i-lucide-search" size="sm" placeholder="Search open tickets" class="flex-1" />
              <UBadge color="primary" variant="subtle" size="sm">{{ picked.length }} picked</UBadge>
              <UButton v-if="picked.length" size="xs" variant="ghost" color="neutral" @click="picked = []">Clear</UButton>
            </div>
            <ul class="flex max-h-[26rem] flex-col divide-y divide-default overflow-y-auto rounded-md border border-default">
              <li
                v-for="t in choices"
                :key="t.id"
                class="flex cursor-pointer items-start gap-3 px-3 py-2 text-sm hover:bg-elevated/50"
                :class="picked.includes(t.key) && 'bg-primary/5'"
                @click="togglePick(t.key, !picked.includes(t.key))"
              >
                <UCheckbox :model-value="picked.includes(t.key)" class="mt-0.5" @click.stop @update:model-value="(v) => togglePick(t.key, v === true)" />
                <div class="min-w-0 flex-1">
                  <div class="flex flex-wrap items-center gap-1.5">
                    <TicketTypeIcon :type="t.type" size="xs" />
                    <button type="button" class="font-mono text-xs text-muted hover:underline" @click.stop="openEditTicket(t)">{{ t.key }}</button>
                    <TicketTags :ticket="t" size="xs" hide-afk />
                    <UBadge v-if="t.status === 'in_progress'" color="info" variant="subtle" size="xs">in progress</UBadge>
                    <UBadge v-if="t.acceptanceCriteria.length" color="neutral" variant="outline" size="xs">{{ t.acceptanceCriteria.length }} AC</UBadge>
                  </div>
                  <p class="font-medium">{{ t.title }}</p>
                  <div v-if="openBlockers(t).length" class="mt-0.5 flex flex-wrap items-center gap-1 text-xs">
                    <span class="text-muted">blocked by</span>
                    <UBadge v-for="b in openBlockers(t)" :key="b.id" :color="blockerWhere(b).color" variant="subtle" size="xs">
                      <span class="font-mono">{{ b.key }}</span>&nbsp;· {{ blockerWhere(b).label }}
                    </UBadge>
                  </div>
                </div>
              </li>
              <li v-if="!choices.length" class="px-3 py-6 text-center text-xs text-muted">No open ticket left to add.</li>
            </ul>
          </div>

          <!-- 2 · who runs each -->
          <div v-else-if="wizard === 1" class="flex flex-col gap-4">
            <div>
              <div class="mb-1.5 flex flex-wrap items-center gap-2">
                <p class="text-xs font-medium uppercase tracking-wide text-muted">Who runs each ticket</p>
                <span class="text-xs text-muted">— its own agent (the default), or an orchestrator that works several through subagents</span>
                <div class="ml-auto flex gap-1">
                  <UButton size="xs" variant="ghost" color="neutral" icon="i-lucide-user-round" @click="setGroups([])">All own agents</UButton>
                  <UButton size="xs" variant="ghost" color="neutral" icon="i-lucide-bot" @click="setGroups([{ tickets: [...picked], runner: null }])">All in one orchestrator</UButton>
                </div>
              </div>
              <ul class="flex max-h-72 flex-col divide-y divide-default overflow-y-auto rounded-md border border-default">
                <li v-for="(k, n) in picked" :key="k" class="flex flex-wrap items-center gap-2 px-3 py-1.5 text-sm">
                  <span class="flex flex-col -space-y-1">
                    <button type="button" class="text-dimmed hover:text-default disabled:opacity-30" :disabled="n === 0" :aria-label="`Move ${k} up`" @click="moveTicket(k, -1)"><UIcon name="i-lucide-chevron-up" class="size-3.5" /></button>
                    <button type="button" class="text-dimmed hover:text-default disabled:opacity-30" :disabled="n === picked.length - 1" :aria-label="`Move ${k} down`" @click="moveTicket(k, 1)"><UIcon name="i-lucide-chevron-down" class="size-3.5" /></button>
                  </span>
                  <UIcon :name="runnerIdOf(k) === 'solo' ? 'i-lucide-user-round' : 'i-lucide-bot'" class="size-4 shrink-0" :class="runnerIdOf(k) === 'solo' ? 'text-muted' : 'text-primary'" />
                  <span v-if="runnerIdOf(k) === 'solo'" class="rounded px-1 text-[10px] tabular-nums" :class="soloQueued(k) ? 'bg-amber-500/15 text-amber-600' : 'bg-elevated text-dimmed'" :title="soloQueued(k) ? 'Queued — starts as a session frees' : 'Starts when the step does'">{{ soloPlace(k) }}{{ soloQueued(k) ? ' · queued' : '' }}</span>
                  <span class="font-mono text-xs text-muted">{{ k }}</span>
                  <span class="min-w-0 flex-1 truncate">{{ byKey.get(k)?.title }}</span>
                  <template v-if="runnerIdOf(k) === 'solo'">
                    <USelect :model-value="soloOf(k).model" :items="modelItems" size="xs" class="w-28" :aria-label="`${k} model`" @update:model-value="(v: PlanModel) => setSolo(k, { model: v })" />
                    <USelect :model-value="soloOf(k).effort" :items="effortItems" size="xs" class="w-24" :aria-label="`${k} effort`" @update:model-value="(v: Effort) => setSolo(k, { effort: v })" />
                  </template>
                  <USelect :model-value="runnerIdOf(k)" :items="runnerItems" size="xs" class="w-44" :aria-label="`${k} runs as`" @update:model-value="(v: string) => setRunnerId(k, v)" />
                </li>
              </ul>
            </div>
            <div v-if="groups.length" class="rounded-md border border-default px-3 py-2">
              <p class="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted">Each orchestrator's subagents</p>
              <div v-for="(g, gi) in groups" :key="gi" class="flex flex-wrap items-center gap-2 py-1 text-sm">
                <UIcon name="i-lucide-bot" class="size-4 text-primary" />
                <span class="min-w-0 flex-1">Orchestrator {{ gi + 1 }} <span class="text-xs text-muted">· {{ g.length }} ticket{{ g.length === 1 ? '' : 's' }}</span></span>
                <USelect :model-value="groupRunnerFor(gi).model" :items="modelItems" size="xs" class="w-28" :aria-label="`Orchestrator ${gi + 1} subagent model`" @update:model-value="(v: PlanModel) => setGroupRunner(gi, { model: v })" />
                <USelect :model-value="groupRunnerFor(gi).effort" :items="effortItems" size="xs" class="w-24" :aria-label="`Orchestrator ${gi + 1} subagent effort`" @update:model-value="(v: Effort) => setGroupRunner(gi, { effort: v })" />
              </div>
              <p class="mt-1 text-xs text-muted">A box of small tickets can run cheap beside a box of heavy ones — each orchestrator (always Fable 5.2) runs its group through subagents on the model and effort set here.</p>
            </div>
            <div class="grid gap-3 sm:grid-cols-3">
              <UFormField label="Default model" :help="groups.length ? 'For any orchestrator or own agent not set above' : 'For any own agent not set above'">
                <USelect v-model="model" :items="modelItems" size="sm" class="w-full" />
              </UFormField>
              <UFormField label="Default effort">
                <USelect v-model="effort" :items="effortItems" size="sm" class="w-full" />
              </UFormField>
              <UFormField v-if="groups.length" label="In flight, per orchestrator" :help="`At most ${STEP_BUDGET_MAX}`">
                <USelect v-model="budget" :items="budgetItems" size="sm" class="w-full" />
              </UFormField>
            </div>
            <div class="rounded-md border px-3 py-2 text-xs" :class="builtShape.orchestrators >= STEP_ORCHESTRATORS_MAX && builtShape.solo.length ? 'border-error/60 bg-error/5' : 'border-default bg-elevated/30'">
              <p class="font-medium">{{ builtShapeLabel }} · {{ builtShape.sessions }} session{{ builtShape.sessions === 1 ? '' : 's' }} at once</p>
              <p class="mt-0.5 text-muted">
                At most {{ STEP_SESSIONS_MAX }} sessions run at once in a step: up to 4 own agents, or 1 orchestrator beside up to 3, or 2 orchestrators alone (each orchestrator works {{ STEP_BUDGET_MAX }} tickets at once, and needs {{ GROUP_MIN }} or more in its group to pay for itself).
                The arrows set the order — own agents past the free sessions start, in that order, as earlier ones finish.
                <span v-if="builtShape.orchestrators >= STEP_ORCHESTRATORS_MAX && builtShape.solo.length" class="text-error">With two orchestrators nothing runs as its own agent: put {{ builtShape.solo.join(', ') }} in a group, or in a step of {{ builtShape.solo.length === 1 ? 'its' : 'their' }} own.</span>
              </p>
            </div>
            <p class="text-xs text-muted">{{ summary }}</p>
          </div>

          <!-- 3 · confirm -->
          <div v-else class="flex flex-col gap-3">
            <div class="rounded-md border border-default px-3 py-2 text-sm">
              <p class="font-medium">{{ summary }}</p>
              <p class="mt-0.5 text-xs text-muted">{{ builtShapeLabel }} · {{ builtShape.sessions }} session{{ builtShape.sessions === 1 ? '' : 's' }} at once</p>
              <div class="mt-2 grid gap-2" :class="groups.length ? 'sm:grid-cols-2' : ''">
                <div v-if="solos.length" class="rounded bg-elevated/40 px-2 py-1.5">
                  <div class="mb-0.5 flex items-center gap-1 text-xs text-muted"><UIcon name="i-lucide-user-round" class="size-3.5" /> Own agent each<span v-if="builtShape.queued.length"> · {{ builtShape.soloSlots }} at once, in this order</span></div>
                  <div v-for="(k, n) in solos" :key="k" class="flex gap-1 text-xs" :class="n >= builtShape.soloSlots && 'opacity-75'">
                    <span class="w-3 shrink-0 text-right tabular-nums" :class="n >= builtShape.soloSlots ? 'text-amber-600' : 'text-dimmed'">{{ n + 1 }}</span>
                    <span class="font-mono text-muted">{{ k }}</span>
                    <span class="min-w-0 flex-1 truncate">{{ byKey.get(k)?.title }}</span>
                    <span class="shrink-0 text-muted">{{ runnerLabel(soloOf(k)) }}</span>
                  </div>
                </div>
                <div v-for="(g, gi) in groups" :key="gi" class="rounded bg-elevated/40 px-2 py-1.5">
                  <div class="mb-0.5 flex items-center gap-1 text-xs text-muted"><UIcon name="i-lucide-bot" class="size-3.5 text-primary" /> Orchestrator {{ gi + 1 }} · {{ runnerLabel(groupRunnerFor(gi)) }} subagents · {{ budget }} in flight</div>
                  <div v-for="k in g" :key="k" class="text-xs"><span class="font-mono text-muted">{{ k }}</span> {{ byKey.get(k)?.title }}</div>
                </div>
              </div>
            </div>
            <UFormField label="Position in the plan">
              <USelect v-model="position" :items="positionItems" size="sm" class="w-48" />
            </UFormField>
            <p v-if="readsSliceAt(position)" class="flex items-center gap-1.5 text-xs text-muted">
              <UIcon name="i-lucide-file-text" class="size-3.5 text-primary" />
              Every agent in this step starts by reading the slice report written just before it (Opus 5.5 medium) — the previous slice's decisions and outcomes, facts only.
            </p>
            <UAlert v-if="previewProblems.length" color="error" variant="subtle" icon="i-lucide-triangle-alert" :description="previewProblems.map((p) => p.message).join(' ')" />
            <UAlert v-else color="success" variant="subtle" icon="i-lucide-check" description="This step fits the plan as it stands." />
          </div>
        </template>

        <!-- review -->
        <div v-else-if="kind === 'review'" class="flex flex-col gap-4">
          <div class="rounded-md border px-3 py-2.5" :class="review.arch ? 'border-primary/50 bg-primary/5' : 'border-default'">
            <div class="flex items-center gap-2">
              <USwitch :model-value="!!review.arch" @update:model-value="(v: boolean) => (review.arch = v ? { ...ARCH_DEFAULT } : null)" />
              <div class="min-w-0 flex-1">
                <p class="text-sm font-medium">Architectural &amp; technical reviewer first</p>
                <p class="text-xs text-muted">
                  One reviewer (the <span class="font-mono">jarch-review</span> skill) reads the diff for structure — boundaries, abstractions, data flow, debt. Its <strong>architectural</strong> findings are not up for a vote:
                  they become tickets, are fixed and merged, and only then do the regular reviewers read the result, with its report in hand. Its technical findings are filed as advisory HITL tickets.
                </p>
              </div>
            </div>
            <div v-if="review.arch" class="mt-2 grid gap-3 pl-11 sm:grid-cols-2">
              <UFormField label="Model"><USelect v-model="review.arch.model" :items="modelItems" size="sm" class="w-full" /></UFormField>
              <UFormField label="Effort" help="Structure is worth the deeper read — high by default"><USelect v-model="review.arch.effort" :items="effortItems" size="sm" class="w-full" /></UFormField>
            </div>
          </div>
          <div class="rounded-md border border-default px-3 py-2.5">
            <p class="text-sm font-medium">{{ review.arch ? 'Then the' : 'The' }} regular reviewers</p>
            <p class="text-xs text-muted">Read the changes since the checkpoint{{ review.arch ? ', architectural fixes included' : '' }}. Only findings <em>every</em> reviewer raises become tickets, fixed and merged inside this step.</p>
            <div class="mt-2 grid gap-3 sm:grid-cols-3">
              <UFormField label="Reviewers" help="2 to 4"><USelect v-model="reviewers" :items="reviewerItems" size="sm" class="w-full" /></UFormField>
              <UFormField label="Model"><USelect v-model="review.model" :items="modelItems" size="sm" class="w-full" /></UFormField>
              <UFormField label="Effort"><USelect v-model="review.effort" :items="effortItems" size="sm" class="w-full" /></UFormField>
            </div>
          </div>
          <UFormField label="Reviews the changes since">
            <USelect
              :items="reviewBaseOptions(previewPlan, built.id).map((o) => ({ ...o, value: o.value || 'prev' }))"
              :model-value="base || 'prev'"
              size="sm"
              class="w-full max-w-md"
              @update:model-value="(v: string) => (base = v === 'prev' ? '' : v)"
            />
          </UFormField>
          <ol class="flex list-decimal flex-col gap-0.5 pl-5 text-xs text-muted">
            <template v-if="review.arch">
              <li>Architectural &amp; technical review on {{ runnerLabel(review.arch) }}.</li>
              <li>Its architectural findings → tickets → implemented → merged. (Nothing found: straight on.)</li>
            </template>
            <li>{{ reviewers }} reviewers on {{ runnerLabel({ model: review.model, effort: review.effort }) }} read the diff{{ review.arch ? ' with the fixes in' : '' }}; findings they all raise → tickets → implemented → merged.</li>
            <li>The step ends; the next one starts from the merged result.</li>
          </ol>
          <UFormField label="Position in the plan"><USelect v-model="position" :items="positionItems" size="sm" class="w-48" /></UFormField>
          <UAlert v-if="previewProblems.length" color="error" variant="subtle" icon="i-lucide-triangle-alert" :description="previewProblems.map((p) => p.message).join(' ')" />
        </div>

        <!-- gate -->
        <div v-else-if="kind === 'gate'" class="flex flex-col gap-3">
          <UFormField label="What to check before continuing"><UInput v-model="note" size="sm" placeholder="optional" class="w-full" /></UFormField>
          <UFormField label="Position in the plan"><USelect v-model="position" :items="positionItems" size="sm" class="w-48" /></UFormField>
        </div>

        <!-- merge (edit only — adding one needs no modal) -->
        <div v-else class="flex flex-col gap-3">
          <p class="text-sm text-muted">Lands every open PR the plan's tickets have so far on the integration branch (Sonnet 5 sweep). Skipped when there is none.</p>
          <UFormField label="Position in the plan"><USelect v-model="position" :items="positionItems" size="sm" class="w-48" /></UFormField>
        </div>
      </template>

      <template #footer>
        <div class="flex w-full items-center gap-2">
          <UButton v-if="editing" color="error" variant="ghost" icon="i-lucide-trash-2" @click="removeEditing">Remove step</UButton>
          <div class="ml-auto flex gap-2">
            <UButton color="neutral" variant="ghost" @click="open = false">Cancel</UButton>
            <template v-if="kind === 'implement'">
              <UButton v-if="wizard > 0" color="neutral" variant="soft" icon="i-lucide-arrow-left" @click="wizard--">Back</UButton>
              <UButton v-if="wizard < 2" icon="i-lucide-arrow-right" trailing :disabled="!canNext" @click="wizard++">Next</UButton>
              <UButton v-else color="success" icon="i-lucide-check" :disabled="!picked.length" @click="confirm">{{ editing ? 'Save step' : 'Add to the plan' }}</UButton>
            </template>
            <UButton v-else color="success" icon="i-lucide-check" @click="confirm">{{ editing ? 'Save step' : 'Add to the plan' }}</UButton>
          </div>
        </div>
      </template>
    </UModal>
  </section>
</template>
