<script setup lang="ts">
// PROTOTYPE — throwaway. Variant D: "View board + modal wizard". The tab is a
// read-only board of the plan's steps. Every edit is behind a modal: adding
// an implement step is a three-step wizard (pick tickets → who runs each:
// its own agent, or an orchestrator with others → confirm); merge / review /
// gate have a small modal each; clicking a step card reopens its modal to
// edit, move or remove it. A step mixes solo agents and orchestrators freely:
// `groups` holds the orchestrated tickets, every other ticket of the step
// runs in its own session (the shipped model can't say that yet — see the
// note at the bottom of the file).
import type { Project, Ticket } from '~/composables/useTracker'
import { PLAN_MODELS, PLAN_MODEL_KEYS, PLAN_ORCHESTRATORS_MAX, newPlanStep, planProblems, type PlanDispatch, type PlanModel, type PlanStep, type PlanStepKind } from '~/utils/runPlan'
import { STEP_ICON, useRunDraft } from '~/utils/prototypeRunDraft'

const props = defineProps<{ project: Project; tickets: Ticket[]; allTickets: Ticket[] }>()
const d = useRunDraft(props)
const { openEditTicket } = useTrackerModals()

type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max'
const EFFORTS: Effort[] = ['low', 'medium', 'high', 'xhigh', 'max']
// Prototype-only state (the plan has no such fields yet): stepId → the
// step's effort, and stepId → ticket → the model/effort a solo agent runs at
// when it differs from the step's.
type Runner = { model: PlanModel; effort: Effort }
const effortOf = ref<Record<string, Effort>>({})
const soloCfgOf = ref<Record<string, Record<string, Runner>>>({})
// Review steps: the regular reviewers' model/effort and, optionally, an
// architectural & technical reviewer that runs FIRST — its architectural
// findings are fixed and merged before the regular reviewers read the diff.
type ReviewCfg = { reviewer: Runner; arch: Runner | null }
const REVIEW_DEFAULT: ReviewCfg = { reviewer: { model: 'opus', effort: 'medium' }, arch: null }
const ARCH_DEFAULT: Runner = { model: 'opus', effort: 'high' }
const reviewCfgOf = ref<Record<string, ReviewCfg>>({})
const reviewCfg = ref<ReviewCfg>(structuredClone(REVIEW_DEFAULT))

// ── The modal ──────────────────────────────────────────────────────────────
const open = ref(false)
const editing = ref<PlanStep | null>(null) // null = adding
const kind = ref<PlanStepKind>('implement')
const wizard = ref(0) // implement: 0 tickets, 1 run mode, 2 confirm
const picked = ref<string[]>([])
const search = ref('')
const model = ref<PlanModel>('opus')
const effort = ref<Effort>('high')
const budget = ref(2)
const groups = ref<string[][]>([[]])
// ticket → its own agent's model/effort, when set apart from the step's.
const soloCfg = ref<Record<string, Runner>>({})
const reviewers = ref(2)
const note = ref('')
const position = ref(0) // index the step will sit at

function reset() {
  wizard.value = 0
  picked.value = []
  search.value = ''
  model.value = 'opus'
  effort.value = 'high'
  budget.value = 2
  groups.value = [[]]
  soloCfg.value = {}
  reviewCfg.value = structuredClone(REVIEW_DEFAULT)
  reviewers.value = 2
  note.value = ''
}
function startAdd(k: PlanStepKind) {
  reset()
  editing.value = null
  kind.value = k
  position.value = d.draft.value.steps.length
  if (k === 'merge') {
    d.addStep('merge')
    return
  }
  open.value = true
}
function startEdit(step: PlanStep, i: number) {
  if (d.locked(i)) return
  reset()
  editing.value = step
  kind.value = step.kind
  position.value = i
  picked.value = [...step.tickets]
  const dsp = step.dispatch ?? d.runDefault.value
  model.value = dsp.model
  budget.value = dsp.budget
  effort.value = effortOf.value[step.id] ?? 'high'
  groups.value = orchGroupsOf(step)
  soloCfg.value = { ...(soloCfgOf.value[step.id] ?? {}) }
  reviewCfg.value = structuredClone(reviewCfgOf.value[step.id] ?? REVIEW_DEFAULT)
  reviewers.value = Math.min(4, Math.max(2, step.reviewers))
  note.value = step.note
  wizard.value = step.kind === 'implement' ? 2 : 0
  open.value = true
}

// Wizard step 1: tickets to choose from — the open tickets not placed elsewhere.
const choices = computed(() => {
  const s = search.value.trim().toLowerCase()
  return d.openTickets.value
    .filter((t) => {
      const at = d.placed.value.get(t.key)
      return at === undefined || (editing.value && d.draft.value.steps[at]?.id === editing.value.id)
    })
    .filter((t) => !s || t.key.toLowerCase().includes(s) || t.title.toLowerCase().includes(s))
})
const togglePick = (k: string, on: boolean) => {
  picked.value = on ? [...new Set([...picked.value, k])] : picked.value.filter((x) => x !== k)
}
// Where a blocker sits, from this new step's point of view.
function blockerWhere(b: Ticket): { label: string; color: 'success' | 'info' | 'error' | 'warning' } {
  if (b.status === 'done' || b.status === 'merged') return { label: 'done', color: 'success' }
  const i = d.placed.value.get(b.key)
  if (i !== undefined) return { label: `step ${i + 1}`, color: i < position.value ? 'info' : 'error' }
  if (picked.value.includes(b.key)) return { label: 'this step', color: 'error' }
  return { label: 'not in plan', color: 'error' }
}

// Wizard step 2: who runs each ticket. `groups` = the orchestrators' tickets;
// a picked ticket in no group runs as its own agent (the default).
watch(picked, (keys) => {
  groups.value = groups.value.map((g) => g.filter((k) => keys.includes(k))).filter((g) => g.length)
})
const solos = computed(() => picked.value.filter((k) => !groups.value.some((g) => g.includes(k))))
const runnerOf = (k: string): string => {
  const gi = groups.value.findIndex((g) => g.includes(k))
  return gi < 0 ? 'solo' : String(gi)
}
function setRunner(k: string, v: string) {
  const next = groups.value.map((g) => g.filter((x) => x !== k))
  if (v !== 'solo') {
    const gi = Number(v)
    while (next.length <= gi) next.push([])
    next[gi]!.push(k)
  }
  groups.value = next.filter((g) => g.length)
}
const runnerItems = computed(() => [
  { label: 'Its own agent', value: 'solo' },
  ...groups.value.map((g, i) => ({ label: `Orchestrator ${i + 1} (${g.length})`, value: String(i) })),
  ...(groups.value.length < PLAN_ORCHESTRATORS_MAX ? [{ label: `+ New orchestrator ${groups.value.length + 1}`, value: String(groups.value.length) }] : []),
])
const everyoneSolo = () => (groups.value = [])
// A solo agent's runner: its own setting, else the step's.
const soloRunner = (k: string): Runner => soloCfg.value[k] ?? { model: model.value, effort: effort.value }
function setSolo(k: string, patch: Partial<Runner>) {
  const next = { ...soloRunner(k), ...patch }
  const same = next.model === model.value && next.effort === effort.value
  const cfg = { ...soloCfg.value }
  if (same) delete cfg[k]
  else cfg[k] = next
  soloCfg.value = cfg
}
const runnerOfStep = (step: PlanStep, k: string): Runner => soloCfgOf.value[step.id]?.[k] ?? { model: d.dispatchOf(step).model, effort: effortOf.value[step.id] ?? 'high' }
const everyoneOrchestrated = () => (groups.value = [[...picked.value]])
// Helpers for existing steps, same reading.
const orchGroupsOf = (step: PlanStep) => step.groups.map((g) => g.filter((k) => step.tickets.includes(k))).filter((g) => g.length)
const solosOf = (step: PlanStep) => step.tickets.filter((k) => !step.groups.some((g) => g.includes(k)))
const modelItems = PLAN_MODEL_KEYS.map((m) => ({ label: PLAN_MODELS[m].label, value: m }))
const effortItems = EFFORTS.map((e) => ({ label: e, value: e }))

// What the step would be, as built so far.
const built = computed<PlanStep>(() => {
  const base = editing.value ?? newPlanStep(d.draft.value, kind.value)
  const orch = groups.value.filter((g) => g.length)
  const dispatch: PlanDispatch | null = kind.value === 'implement' ? { mode: orch.length ? 'orchestrated' : 'sessions', model: model.value, effort: effort.value, budget: budget.value, orchestrators: Math.max(1, orch.length) } : null
  return {
    ...base,
    kind: kind.value,
    tickets: kind.value === 'implement' ? [...picked.value] : [],
    dispatch,
    groups: kind.value === 'implement' ? orch.map((g) => [...g]) : [],
    reviewers: reviewers.value,
    note: note.value,
  }
})
// The plan as it would be with this step in, validated.
const preview = computed(() => {
  const steps = d.draft.value.steps.filter((s) => s.id !== editing.value?.id)
  steps.splice(Math.min(position.value, steps.length), 0, built.value)
  const planTickets = props.allTickets.map((t) => ({
    key: t.key,
    status: t.status,
    blockedBy: t.blockedBy.map((id) => props.allTickets.find((x) => x.id === id)?.key).filter((k): k is string => !!k),
  }))
  return { steps, problems: planProblems({ steps }, planTickets).filter((p) => p.stepId === built.value.id) }
})
function describe(solo: string[], orch: string[][], m: PlanModel, eff: string, b: number, runner: (k: string) => Runner) {
  const parts: string[] = []
  if (solo.length) {
    const tally = new Map<string, number>()
    for (const k of solo) {
      const r = runner(k)
      const label = `${PLAN_MODELS[r.model].label} ${r.effort}`
      tally.set(label, (tally.get(label) ?? 0) + 1)
    }
    const mix = [...tally].map(([label, n]) => `${n} on ${label}`).join(', ')
    parts.push(`${solo.length} ticket${solo.length === 1 ? '' : 's'} each with its own agent (${mix})`)
  }
  if (orch.length) {
    const n = orch.reduce((a, g) => a + g.length, 0)
    parts.push(`${orch.length} Fable 5.2 orchestrator${orch.length > 1 ? 's' : ''} working ${n} ticket${n === 1 ? '' : 's'} through ${PLAN_MODELS[m].label} subagents, ${b} in flight each`)
  }
  return `${parts.join(', beside ') || 'no tickets'}${orch.length ? ` · subagents at ${eff} effort` : ''}.`
}
const summary = computed(() => describe(solos.value, groups.value.filter((g) => g.length), model.value, effort.value, budget.value, soloRunner))
const positionItems = computed(() => {
  const n = d.draft.value.steps.filter((s) => s.id !== editing.value?.id).length
  return Array.from({ length: n + 1 }, (_, i) => ({ label: i === 0 ? 'first' : i === n ? 'last' : `after step ${i}`, value: i }))
})

function confirm() {
  const step = built.value
  const steps = d.draft.value.steps.filter((s) => s.id !== editing.value?.id)
  steps.splice(Math.min(position.value, steps.length), 0, step)
  d.draft.value.steps = steps
  if (kind.value === 'implement') {
    effortOf.value = { ...effortOf.value, [step.id]: effort.value }
    const cfg: Record<string, Runner> = {}
    for (const k of solos.value) if (soloCfg.value[k]) cfg[k] = soloCfg.value[k]!
    soloCfgOf.value = { ...soloCfgOf.value, [step.id]: cfg }
  }
  if (kind.value === 'review') reviewCfgOf.value = { ...reviewCfgOf.value, [step.id]: structuredClone(reviewCfg.value) }
  open.value = false
}
function removeEditing() {
  if (!editing.value) return
  const i = d.draft.value.steps.findIndex((s) => s.id === editing.value!.id)
  if (i >= 0) d.removeStep(i)
  open.value = false
}
const canNext = computed(() => (wizard.value === 0 ? picked.value.length > 0 : true))
const title = computed(() => {
  const what = editing.value ? `Edit step ${position.value + 1}` : 'Add a step'
  if (kind.value !== 'implement') return `${what} · ${kind.value}`
  return `${what} · implement · ${['1 of 3 — pick the tickets', '2 of 3 — how they run', '3 of 3 — confirm'][wizard.value]}`
})

// Board card text.
// ── Slice reports ──────────────────────────────────────────────────────────
// Before an implement step that is not the plan's first, one session writes
// a slice report — facts only — from the diff since the last report, the
// tickets' resolutions and the review reports; the step's sessions read it
// first. Written at the transition, never a step on the board.
const hasPriorImplement = (i: number) => d.draft.value.steps.slice(0, i).some((x) => x.kind === 'implement')
const readsReport = (step: PlanStep, i: number) => step.kind === 'implement' && hasPriorImplement(i)
// Simulated: once the run has reached step i, the report before it exists.
const sliceDocOf = (i: number) => (d.simAt.value !== null && d.simAt.value >= i && hasPriorImplement(i) ? `DOC-${100 + i}` : '')
const reportOpen = ref(false)
const reportFor = ref(0)
// Who writes it — fixed, not a per-step control.
const REPORT_WRITER: Runner = { model: 'opus', effort: 'medium' }
const REPORT_RULES = [
  'Facts only. No introduction, no closing, no adjectives, no hedging, no restating the tickets.',
  'Bullet points. One fact per bullet. Name files, functions, endpoints and tickets by path or key.',
  'Record decisions as: what — because why. Rejected: alternative.',
  'Record outcomes as what exists now, not what was done.',
  'At most 300 words. A section with nothing in it is left out.',
  'Written after the slice has merged and its review fixes have landed; covers the diff since the previous report.',
]
const REPORT_SKELETON = `# Slice report · after step N (abc123 → def456)

## Built
- TICK-12: <what exists now, one line>

## Where
- path/to/module.ts — <what it holds now>

## Decisions
- <decision> — because <reason>. Rejected: <alternative>.

## Deviations and gaps
- TICK-13: <what differs from the ticket>. Carryover: TICK-20.

## For the next slice
- Use <seam/hook/convention>.
- Do not touch <thing> — <reason>.

Previous: DOC-n`

const runnerLabel = (r: Runner) => `${PLAN_MODELS[r.model].label} ${r.effort}`
const reviewMeta = (s: PlanStep) => {
  const c = reviewCfgOf.value[s.id] ?? REVIEW_DEFAULT
  const regular = `${s.reviewers} reviewers (${runnerLabel(c.reviewer)}) — findings they all raise are fixed and merged here`
  return c.arch ? `architectural & technical reviewer first (${runnerLabel(c.arch)}; its architectural findings must be fixed), then ${regular}` : regular
}
const cardMeta = (s: PlanStep) => {
  if (s.kind !== 'implement') return ''
  const dsp = d.dispatchOf(s)
  return describe(solosOf(s), orchGroupsOf(s), dsp.model, effortOf.value[s.id] ?? 'high', dsp.budget, (k) => runnerOfStep(s, k))
}
</script>

<template>
  <section class="flex flex-col gap-3">
    <!-- Header: the view's controls only -->
    <div class="flex flex-wrap items-center gap-2 rounded-lg border border-default bg-elevated/30 px-4 py-2 text-sm">
      <UIcon name="i-lucide-layout-list" class="size-4 text-primary" />
      <span class="font-semibold">Run setup</span>
      <UBadge color="neutral" variant="subtle" size="sm">{{ d.draft.value.steps.length }} step{{ d.draft.value.steps.length === 1 ? '' : 's' }}</UBadge>
      <UBadge v-if="d.unplaced.value.length" color="warning" variant="subtle" size="sm">{{ d.unplaced.value.length }} ticket{{ d.unplaced.value.length === 1 ? '' : 's' }} not in the plan</UBadge>
      <div class="ml-auto flex items-center gap-2">
        <span class="text-xs text-muted">View it running at</span>
        <USelect
          :model-value="d.simAt.value === null ? 'off' : String(d.simAt.value)"
          :items="[{ label: 'not running', value: 'off' }, ...d.draft.value.steps.map((s, i) => ({ label: `step ${i + 1}`, value: String(i) }))]"
          size="xs"
          class="w-36"
          @update:model-value="(v: string) => (d.simAt.value = v === 'off' ? null : Number(v))"
        />
        <UButton size="xs" color="success" icon="i-lucide-play" :disabled="d.problems.value.length > 0 || !d.draft.value.steps.length">Start plan</UButton>
      </div>
    </div>

    <!-- The board -->
    <div class="mx-auto flex w-full max-w-3xl flex-col gap-2">
      <div
        v-for="(step, i) in d.draft.value.steps"
        :key="step.id"
        class="rounded-lg border bg-default px-4 py-3 transition"
        :class="[
          d.simState(i) === 'running' ? 'border-info ring-2 ring-info/30' : d.simState(i) === 'done' ? 'border-success/50 bg-success/5' : 'border-default',
          d.problemsOf(step.id).length && !d.locked(i) && 'border-error/60',
          !d.locked(i) && 'cursor-pointer hover:ring-2 hover:ring-primary/40',
        ]"
        role="button"
        @click="startEdit(step, i)"
      >
        <div class="flex items-center gap-2">
          <span class="flex size-6 items-center justify-center rounded-full bg-elevated text-xs font-medium tabular-nums">{{ i + 1 }}</span>
          <UIcon :name="STEP_ICON[step.kind]" class="size-4 text-muted" />
          <span class="font-medium capitalize">{{ step.kind }}</span>
          <span v-if="cardMeta(step)" class="text-xs text-muted">· {{ cardMeta(step) }}</span>
          <span v-else-if="step.kind === 'review'" class="text-xs text-muted">· {{ reviewMeta(step) }}</span>
          <span v-else-if="step.kind === 'gate'" class="text-xs text-muted">· waits for Continue{{ step.note ? ` — ${step.note}` : '' }}</span>
          <span v-else class="text-xs text-muted">· lands every open PR so far</span>
          <UBadge v-if="d.simState(i)" :color="d.simState(i) === 'done' ? 'success' : 'info'" variant="subtle" size="xs" class="ml-auto">{{ d.simState(i) }}</UBadge>
          <UIcon v-else-if="d.locked(i)" name="i-lucide-lock" class="ml-auto size-3.5 text-dimmed" />
          <UIcon v-else name="i-lucide-pencil" class="ml-auto size-3.5 text-dimmed" />
        </div>

        <!-- implement after the first: reads the slice report written before it -->
        <div v-if="readsReport(step, i)" class="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs">
          <UIcon name="i-lucide-file-text" class="size-3.5 text-primary" />
          <span class="text-muted">Starts by reading the slice report written after step {{ i }} ({{ runnerLabel(REPORT_WRITER) }})</span>
          <UBadge v-if="sliceDocOf(i)" color="primary" variant="subtle" size="xs" class="cursor-pointer font-mono" @click.stop="(reportFor = i), (reportOpen = true)">{{ sliceDocOf(i) }} ↗</UBadge>
          <button v-else class="text-primary hover:underline" @click.stop="(reportFor = i), (reportOpen = true)">what it records</button>
        </div>
        <!-- implement: solo agents beside orchestrators -->
        <div v-if="step.kind === 'implement'" class="mt-2 grid gap-2" :class="orchGroupsOf(step).length ? 'sm:grid-cols-2' : ''">
          <div v-if="solosOf(step).length" class="rounded-md bg-elevated/40 px-2.5 py-2">
            <div class="mb-1 flex items-center gap-1 text-xs text-muted"><UIcon name="i-lucide-user-round" class="size-3.5 text-primary" /> Own agent each</div>
            <div v-for="k in solosOf(step)" :key="k" class="flex items-center gap-1.5 py-0.5 text-sm">
              <span class="font-mono text-xs text-muted">{{ k }}</span>
              <span class="min-w-0 flex-1 truncate">{{ d.byKey.value.get(k)?.title }}</span>
              <UBadge v-if="d.byKey.value.get(k) && d.isHitl(d.byKey.value.get(k)!)" color="warning" variant="subtle" size="xs">HITL</UBadge>
              <UIcon v-if="d.problemsForTicket(k).length" name="i-lucide-triangle-alert" class="size-3.5 shrink-0 text-error" />
              <span class="shrink-0 text-xs text-muted">{{ PLAN_MODELS[runnerOfStep(step, k).model].label }} · {{ runnerOfStep(step, k).effort }}</span>
            </div>
          </div>
          <div v-for="(g, gi) in orchGroupsOf(step)" :key="gi" class="rounded-md bg-elevated/40 px-2.5 py-2">
            <div class="mb-1 flex items-center gap-1 text-xs text-muted"><UIcon name="i-lucide-bot" class="size-3.5 text-primary" /> Orchestrator {{ gi + 1 }}</div>
            <div v-for="k in g" :key="k" class="flex items-center gap-1.5 py-0.5 text-sm">
              <span class="font-mono text-xs text-muted">{{ k }}</span>
              <span class="truncate">{{ d.byKey.value.get(k)?.title }}</span>
              <UIcon v-if="d.problemsForTicket(k).length" name="i-lucide-triangle-alert" class="size-3.5 shrink-0 text-error" />
            </div>
          </div>
          <span v-if="!step.tickets.length" class="text-xs text-dimmed">no tickets</span>
        </div>
        <ul v-if="d.problemsOf(step.id).length && !d.locked(i)" class="mt-1.5 text-xs text-error">
          <li v-for="(p, n) in d.problemsOf(step.id)" :key="n">⚠ {{ p.message }}</li>
        </ul>
      </div>

      <p v-if="!d.draft.value.steps.length" class="rounded-lg border border-dashed border-default px-4 py-8 text-center text-sm text-muted">No steps yet. Add the first one below.</p>

      <!-- Add — the only affordance on the board -->
      <div class="flex flex-wrap items-center justify-center gap-1.5 pt-1">
        <UButton size="sm" :icon="STEP_ICON.implement" @click="startAdd('implement')">Add implement step</UButton>
        <UButton size="sm" variant="soft" color="neutral" :icon="STEP_ICON.merge" @click="startAdd('merge')">Merge</UButton>
        <UButton size="sm" variant="soft" color="neutral" :icon="STEP_ICON.review" @click="startAdd('review')">Review</UButton>
        <UButton size="sm" variant="soft" color="neutral" :icon="STEP_ICON.gate" @click="startAdd('gate')">Gate</UButton>
      </div>
    </div>

    <details class="rounded-md border border-default px-3 py-2 text-xs">
      <summary class="cursor-pointer text-muted">State (in memory — nothing is saved)</summary>
      <pre class="mt-2 max-h-72 overflow-auto">{{ JSON.stringify({ runDefault: d.runDefault.value, effortOf, simAt: d.simAt.value, plan: d.draft.value }, null, 2) }}</pre>
    </details>

    <!-- The modal -->
    <UModal v-model:open="open" :title="title" :ui="{ content: 'sm:max-w-3xl' }">
      <template #body>
        <!-- implement wizard -->
        <template v-if="kind === 'implement'">
          <div class="mb-3 flex items-center gap-2 text-xs">
            <template v-for="(label, n) in ['Tickets', 'Run mode', 'Confirm']" :key="n">
              <button
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
                    <button class="font-mono text-xs text-muted hover:underline" @click.stop="openEditTicket(t)">{{ t.key }}</button>
                    <TicketTags :ticket="t" size="xs" hide-afk />
                    <UBadge v-if="t.status === 'in_progress'" color="info" variant="subtle" size="xs">in progress</UBadge>
                    <UBadge v-if="t.acceptanceCriteria.length" color="neutral" variant="outline" size="xs">{{ t.acceptanceCriteria.length }} AC</UBadge>
                  </div>
                  <p class="font-medium">{{ t.title }}</p>
                  <div v-if="d.openBlockers(t).length" class="mt-0.5 flex flex-wrap items-center gap-1 text-xs">
                    <span class="text-muted">blocked by</span>
                    <UBadge v-for="b in d.openBlockers(t)" :key="b.id" :color="blockerWhere(b).color" variant="subtle" size="xs">
                      <span class="font-mono">{{ b.key }}</span>&nbsp;· {{ blockerWhere(b).label }}
                    </UBadge>
                  </div>
                </div>
              </li>
              <li v-if="!choices.length" class="px-3 py-6 text-center text-xs text-muted">No open ticket left to add.</li>
            </ul>
          </div>

          <!-- 2 · run mode -->
          <div v-else-if="wizard === 1" class="flex flex-col gap-4">
            <div>
              <div class="mb-1.5 flex flex-wrap items-center gap-2">
                <p class="text-xs font-medium uppercase tracking-wide text-muted">Who runs each ticket</p>
                <span class="text-xs text-muted">— its own agent (the default), or an orchestrator that works several through subagents</span>
                <div class="ml-auto flex gap-1">
                  <UButton size="xs" variant="ghost" color="neutral" icon="i-lucide-user-round" @click="everyoneSolo">All own agents</UButton>
                  <UButton size="xs" variant="ghost" color="neutral" icon="i-lucide-bot" @click="everyoneOrchestrated">All in one orchestrator</UButton>
                </div>
              </div>
              <ul class="flex max-h-72 flex-col divide-y divide-default overflow-y-auto rounded-md border border-default">
                <li v-for="k in picked" :key="k" class="flex items-center gap-2 px-3 py-1.5 text-sm">
                  <UIcon :name="runnerOf(k) === 'solo' ? 'i-lucide-user-round' : 'i-lucide-bot'" class="size-4 shrink-0" :class="runnerOf(k) === 'solo' ? 'text-muted' : 'text-primary'" />
                  <span class="font-mono text-xs text-muted">{{ k }}</span>
                  <span class="min-w-0 flex-1 truncate">{{ d.byKey.value.get(k)?.title }}</span>
                  <template v-if="runnerOf(k) === 'solo'">
                    <USelect :model-value="soloRunner(k).model" :items="modelItems" size="xs" class="w-28" :aria-label="`${k} model`" @update:model-value="(v: PlanModel) => setSolo(k, { model: v })" />
                    <USelect :model-value="soloRunner(k).effort" :items="effortItems" size="xs" class="w-24" :aria-label="`${k} effort`" @update:model-value="(v: Effort) => setSolo(k, { effort: v })" />
                  </template>
                  <USelect :model-value="runnerOf(k)" :items="runnerItems" size="xs" class="w-44" @update:model-value="(v: string) => setRunner(k, v)" />
                </li>
              </ul>
            </div>
            <div class="grid gap-3 sm:grid-cols-3">
              <UFormField label="Default model" :help="groups.length ? 'For the orchestrators’ subagents, and any own agent not set above' : 'For any own agent not set above'">
                <USelect v-model="model" :items="modelItems" size="sm" class="w-full" />
              </UFormField>
              <UFormField label="Default effort">
                <USelect v-model="effort" :items="effortItems" size="sm" class="w-full" />
              </UFormField>
              <UFormField v-if="groups.length" label="In flight, per orchestrator">
                <USelect v-model="budget" :items="[1, 2, 3, 4].map((n) => ({ label: String(n), value: n }))" size="sm" class="w-full" />
              </UFormField>
            </div>
            <p class="text-xs text-muted">{{ summary }}</p>
          </div>

          <!-- 3 · confirm -->
          <div v-else class="flex flex-col gap-3">
            <div class="rounded-md border border-default px-3 py-2 text-sm">
              <p class="font-medium">{{ summary }}</p>
              <div class="mt-2 grid gap-2" :class="groups.length ? 'sm:grid-cols-2' : ''">
                <div v-if="solos.length" class="rounded bg-elevated/40 px-2 py-1.5">
                  <div class="mb-0.5 flex items-center gap-1 text-xs text-muted"><UIcon name="i-lucide-user-round" class="size-3.5" /> Own agent each</div>
                  <div v-for="k in solos" :key="k" class="flex gap-1 text-xs"><span class="font-mono text-muted">{{ k }}</span> <span class="min-w-0 flex-1 truncate">{{ d.byKey.value.get(k)?.title }}</span> <span class="shrink-0 text-muted">{{ PLAN_MODELS[soloRunner(k).model].label }} · {{ soloRunner(k).effort }}</span></div>
                </div>
                <div v-for="(g, gi) in groups" :key="gi" class="rounded bg-elevated/40 px-2 py-1.5">
                  <div class="mb-0.5 flex items-center gap-1 text-xs text-muted"><UIcon name="i-lucide-bot" class="size-3.5 text-primary" /> Orchestrator {{ gi + 1 }}</div>
                  <div v-for="k in g" :key="k" class="text-xs"><span class="font-mono text-muted">{{ k }}</span> {{ d.byKey.value.get(k)?.title }}</div>
                </div>
              </div>
            </div>
            <UFormField label="Position in the plan">
              <USelect v-model="position" :items="positionItems" size="sm" class="w-48" />
            </UFormField>
            <p v-if="hasPriorImplement(position)" class="flex items-center gap-1.5 text-xs text-muted">
              <UIcon name="i-lucide-file-text" class="size-3.5 text-primary" />
              Every session in this step starts by reading the slice report written just before it by {{ runnerLabel(REPORT_WRITER) }} — decisions and outcomes of the slice so far, facts only.
            </p>
            <UAlert v-if="preview.problems.length" color="error" variant="subtle" icon="i-lucide-triangle-alert" :description="preview.problems.map((p) => p.message).join(' ')" />
            <UAlert v-else color="success" variant="subtle" icon="i-lucide-check" description="This step fits the plan as it stands." />
          </div>
        </template>

        <!-- review / gate -->
        <div v-else-if="kind === 'review'" class="flex flex-col gap-4">
          <!-- 1 · the architectural pass (optional, first) -->
          <div class="rounded-md border px-3 py-2.5" :class="reviewCfg.arch ? 'border-primary/50 bg-primary/5' : 'border-default'">
            <div class="flex items-center gap-2">
              <USwitch :model-value="!!reviewCfg.arch" @update:model-value="(v: boolean) => (reviewCfg.arch = v ? { ...ARCH_DEFAULT } : null)" />
              <div class="min-w-0 flex-1">
                <p class="text-sm font-medium">Architectural &amp; technical reviewer first</p>
                <p class="text-xs text-muted">
                  One reviewer reads the diff for structure — boundaries, abstractions, data flow, technical debt. Its <strong>architectural</strong> findings are not up for a vote:
                  they become tickets, are fixed and merged, and only then do the regular reviewers read the result (with its report in hand, so nothing is raised twice).
                </p>
              </div>
            </div>
            <div v-if="reviewCfg.arch" class="mt-2 grid gap-3 pl-11 sm:grid-cols-2">
              <UFormField label="Model"><USelect v-model="reviewCfg.arch.model" :items="modelItems" size="sm" class="w-full" /></UFormField>
              <UFormField label="Effort" help="Structure is worth the deeper read — high by default"><USelect v-model="reviewCfg.arch.effort" :items="effortItems" size="sm" class="w-full" /></UFormField>
            </div>
          </div>

          <!-- 2 · the regular consensus pass -->
          <div class="rounded-md border border-default px-3 py-2.5">
            <p class="text-sm font-medium">{{ reviewCfg.arch ? 'Then the' : 'The' }} regular reviewers</p>
            <p class="text-xs text-muted">Read the changes since the last checkpoint{{ reviewCfg.arch ? ', architectural fixes included' : '' }}. Only findings <em>every</em> reviewer raises become tickets, fixed and merged inside this step.</p>
            <div class="mt-2 grid gap-3 sm:grid-cols-3">
              <UFormField label="Reviewers" help="2 to 4"><USelect v-model="reviewers" :items="[2, 3, 4].map((n) => ({ label: `${n} reviewers`, value: n }))" size="sm" class="w-full" /></UFormField>
              <UFormField label="Model"><USelect v-model="reviewCfg.reviewer.model" :items="modelItems" size="sm" class="w-full" /></UFormField>
              <UFormField label="Effort"><USelect v-model="reviewCfg.reviewer.effort" :items="effortItems" size="sm" class="w-full" /></UFormField>
            </div>
          </div>

          <!-- what will happen, in order -->
          <ol class="flex list-decimal flex-col gap-0.5 pl-5 text-xs text-muted">
            <template v-if="reviewCfg.arch">
              <li>Architectural &amp; technical review on {{ runnerLabel(reviewCfg.arch) }}.</li>
              <li>Its architectural findings → tickets → implemented → merged. (Nothing found: straight on.)</li>
            </template>
            <li>{{ reviewers }} reviewers on {{ runnerLabel(reviewCfg.reviewer) }} read the diff{{ reviewCfg.arch ? ' with the fixes in' : '' }}; findings they all raise → tickets → implemented → merged.</li>
            <li>The step ends; the next one starts from the merged result.</li>
          </ol>
          <UFormField label="Position in the plan"><USelect v-model="position" :items="positionItems" size="sm" class="w-48" /></UFormField>
        </div>
        <div v-else-if="kind === 'gate'" class="flex flex-col gap-3">
          <UFormField label="What to check before continuing"><UInput v-model="note" size="sm" placeholder="optional" class="w-full" /></UFormField>
          <UFormField label="Position in the plan"><USelect v-model="position" :items="positionItems" size="sm" class="w-48" /></UFormField>
        </div>
        <div v-else class="flex flex-col gap-3">
          <p class="text-sm text-muted">Lands every open PR the plan's tickets have so far on the integration branch.</p>
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

    <!-- The slice report: what the writer is held to, and the shape it fills -->
    <UModal v-model:open="reportOpen" :title="sliceDocOf(reportFor) ? `${sliceDocOf(reportFor)} · slice report after step ${reportFor}` : `Slice report after step ${reportFor} — the contract`" :ui="{ content: 'sm:max-w-2xl' }">
      <template #body>
        <div class="flex flex-col gap-3 text-sm">
          <p class="text-muted">
            Written by one {{ PLAN_MODELS[REPORT_WRITER.model].label }} session at {{ REPORT_WRITER.effort }} effort once the slice has merged and its review fixes have landed. Read first by every session of step {{ reportFor + 1 }}, and by that step's reviewers.
          </p>
          <div>
            <p class="mb-1 text-xs font-medium uppercase tracking-wide text-muted">Rules the writer is held to</p>
            <ul class="flex flex-col gap-0.5 text-xs">
              <li v-for="r in REPORT_RULES" :key="r" class="flex gap-1.5"><UIcon name="i-lucide-check" class="mt-0.5 size-3.5 shrink-0 text-success" />{{ r }}</li>
            </ul>
          </div>
          <div>
            <p class="mb-1 text-xs font-medium uppercase tracking-wide text-muted">The shape it fills</p>
            <pre class="overflow-auto rounded-md border border-default bg-elevated/40 px-3 py-2 text-xs leading-relaxed">{{ REPORT_SKELETON }}</pre>
          </div>
        </div>
      </template>
      <template #footer>
        <div class="flex w-full justify-end"><UButton color="neutral" variant="ghost" @click="reportOpen = false">Close</UButton></div>
      </template>
    </UModal>
  </section>
</template>

<!--
  Folding this in: the shipped plan model has no "runs alone" marker — a
  ticket of an orchestrated step that sits in no group is folded into the
  first orchestrator (stepGroups). This variant reads it the other way round
  (no group = its own agent), so a step can mix both. Shipping that means a
  step-level `solo: string[]` (or a per-ticket runner) in runPlan.ts, the
  engine dispatching those tickets like a sessions step beside the step's
  orchestrators, an `effort` on the dispatch setting passed to claude, and a
  per-ticket model/effort for solo agents (ticket → runner on the step).
  The review step's extras (reviewer model/effort, the optional architectural
  reviewer that runs first with mandatory findings) need a `review` setting
  on the step and a second review sub-phase in the engine — arch review →
  fix → merge → consensus review → fix → merge — with jReview told the pass
  and handed the arch report for the consensus reviewers.
  Slice reports: an engine transition before every implement step after the
  first (tip moved since the last report → one session writes a `slice`-
  labelled doc from the diff, resolutions and review reports, under the rules
  above, on Opus 5.5 at medium effort — a REPORT_MODEL/effort pin in
  server/utils/models.ts), the doc key prepended to that step's hand-offs and claim prompts and
  to the next review's reviewers; the outcome report then synthesises the
  slice reports.
-->
