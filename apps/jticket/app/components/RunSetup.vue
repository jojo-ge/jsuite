<script setup lang="ts">
// Run setup — the project page's tab for building a run plan by hand
// (~/utils/runPlan.ts): pick tickets into implement steps, and put merge,
// review and gate steps exactly where they should happen. Started, the plan is
// walked by auto mode's engine (the jButton turns on and <AutoLoopPanel> shows
// the step in progress). Every edit saves straight away (PUT …/run-plan); a
// half-built draft is fine, and the problems that would stop it running are
// listed under it. While it runs, the steps it has started are locked and the
// rest stay editable — the loop picks them up as it gets there.
import type { Project, Ticket } from '~/composables/useTracker'
import { DEFAULT_ORCHESTRATION, ORCHESTRATION_BUDGET_MAX, type AutoMode, type PlanStepRecord } from '~/utils/autoLoop'
import {
  PLAN_REVIEWERS_MAX,
  PLAN_STEP_LABELS,
  coerceRunPlan,
  newPlanStep,
  planProblems,
  reviewBaseOptions,
  type PlanStep,
  type PlanStepKind,
  type PlanTicket,
  type RunPlan,
} from '~/utils/runPlan'

const props = defineProps<{ project: Project; tickets: Ticket[]; allTickets: Ticket[] }>()
const { busy, startPlan } = useAutoLoop()
const { refresh } = useTracker()
const toast = useToast()

const STEP_ICONS: Record<PlanStepKind, string> = {
  implement: 'i-lucide-hammer',
  merge: 'i-lucide-git-merge',
  review: 'i-lucide-scan-eye',
  gate: 'i-lucide-hand',
}

// ── The draft ──────────────────────────────────────────────────────────────
// A local copy the page edits; saved on every change. The server's copy
// (project.runPlan, over /api/stream) replaces it whenever no save is pending.
const empty = (): RunPlan => ({ steps: [] })
const draft = ref<RunPlan>(structuredClone(toRaw(props.project.runPlan) ?? empty()))
let saving = 0
watch(
  () => props.project.runPlan,
  (plan) => {
    if (!saving) draft.value = structuredClone(toRaw(plan) ?? empty())
  },
  { deep: true },
)

let timer: ReturnType<typeof setTimeout> | undefined
function commit() {
  clearTimeout(timer)
  saving++
  timer = setTimeout(save, 350)
}
async function save() {
  try {
    await $fetch(`/api/projects/${props.project.id}/run-plan`, { method: 'PUT', body: draft.value })
  } catch (err: any) {
    toast.add({
      title: 'Run setup',
      description: String(err?.data?.statusMessage ?? err?.data?.message ?? err?.message ?? err),
      icon: 'i-lucide-triangle-alert',
      color: 'error',
    })
    // Refused (a running plan's locked steps, or an unrunnable edit) — back to the server's.
    draft.value = structuredClone(toRaw(props.project.runPlan) ?? empty())
  } finally {
    saving = 0
    await refresh()
  }
}

// ── Running state ──────────────────────────────────────────────────────────
const auto = computed(() => props.project.auto ?? null)
const planRunning = computed(() => !!auto.value?.enabled && !!auto.value.plan)
const loopRunning = computed(() => !!auto.value?.enabled && !auto.value.plan)
// Steps the running plan has started (finished, skipped, or in progress) are locked.
const frozen = computed(() => {
  const a = auto.value
  if (!planRunning.value || !a) return 0
  return a.cursor + (a.phase === 'idle' ? 0 : 1)
})
function stepState(i: number): { label: string; color: 'success' | 'info' | 'neutral' | 'warning'; record?: PlanStepRecord } | null {
  const a = auto.value
  if (!planRunning.value || !a) return null
  const record = a.planLog[i]
  if (i < a.cursor) return record?.skipped ? { label: `skipped — ${record.skipped}`, color: 'neutral', record } : { label: 'done', color: 'success', record }
  if (i === a.cursor && a.phase !== 'idle') return { label: a.paused ? 'paused' : 'running', color: a.paused ? 'warning' : 'info' }
  if (i === a.cursor) return { label: 'next', color: 'info' }
  return null
}

// ── Tickets ────────────────────────────────────────────────────────────────
const byKey = computed(() => new Map(props.allTickets.map((t) => [t.key, t])))
const byId = computed(() => new Map(props.allTickets.map((t) => [t.id, t])))
const placed = computed(() => new Set(draft.value.steps.flatMap((s) => s.tickets)))
const openTickets = computed(() =>
  props.tickets
    .filter((t) => !isFinished(t.status))
    .sort((a, b) => Number(a.key.split('-').pop()) - Number(b.key.split('-').pop())),
)
const unplaced = computed(() => openTickets.value.filter((t) => !placed.value.has(t.key)))
const openBlockers = (t: Ticket) =>
  t.blockedBy.map((id) => byId.value.get(id)).filter((b): b is Ticket => !!b && !isFinished(b.status))

// Every ticket a blocker can name: the project's, plus what outside it they wait on.
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
const planWide = computed(() => problems.value.filter((p) => !p.stepId))

// ── Picking ────────────────────────────────────────────────────────────────
const picked = ref<Set<string>>(new Set())
watch(unplaced, (list) => {
  const live = new Set(list.map((t) => t.key))
  const kept = [...picked.value].filter((k) => live.has(k))
  if (kept.length !== picked.value.size) picked.value = new Set(kept)
})
function togglePick(key: string, on: boolean) {
  const next = new Set(picked.value)
  if (on) next.add(key)
  else next.delete(key)
  picked.value = next
}

// ── Editing ────────────────────────────────────────────────────────────────
const locked = (i: number) => i < frozen.value

function addStep(kind: PlanStepKind, tickets: string[] = []) {
  draft.value.steps.push(newPlanStep(draft.value, kind, { tickets }))
  commit()
}
function addPickedAsStep() {
  addStep('implement', [...picked.value])
  picked.value = new Set()
}
function addPickedTo(step: PlanStep) {
  step.tickets = [...step.tickets, ...[...picked.value].filter((k) => !step.tickets.includes(k))]
  picked.value = new Set()
  commit()
}
function removeTicket(step: PlanStep, key: string) {
  step.tickets = step.tickets.filter((k) => k !== key)
  commit()
}
function move(i: number, by: -1 | 1) {
  const j = i + by
  if (j < frozen.value || j >= draft.value.steps.length) return
  const steps = draft.value.steps
  ;[steps[i], steps[j]] = [steps[j]!, steps[i]!]
  commit()
}
function removeStep(i: number) {
  const gone = draft.value.steps[i]!
  draft.value.steps.splice(i, 1)
  // A review based on it falls back to "since the previous review".
  for (const s of draft.value.steps) if (s.base === gone.id) s.base = ''
  commit()
}
function clearPlan() {
  if (!window.confirm('Clear the whole plan?')) return
  draft.value = empty()
  commit()
}

// Drag a ticket chip onto an implement step — from the list, or from another step.
const dragging = ref<{ key: string; from: string } | null>(null)
const dropTarget = ref('')
function onDrop(step: PlanStep) {
  const d = dragging.value
  dragging.value = null
  dropTarget.value = ''
  if (!d || d.from === step.id) return
  const src = draft.value.steps.find((s) => s.id === d.from)
  if (src) src.tickets = src.tickets.filter((k) => k !== d.key)
  if (!step.tickets.includes(d.key)) step.tickets = [...step.tickets, d.key]
  commit()
}

// ── Drafting from the blocker graph ────────────────────────────────────────
// One implement → merge → review per layer — the loop's own rhythm, as a
// starting point to reshape.
const forecast = computed(() => autoForecastFor(props.project, props.tickets, props.allTickets))
function draftFromLayers() {
  const layers = forecast.value.loops.map((ids) => ids.map((id) => byId.value.get(id)?.key).filter((k): k is string => !!k))
  if (!layers.length) return
  if (draft.value.steps.length && !window.confirm('Replace the current plan with one drafted from the blocker graph?')) return
  const plan = empty()
  for (const keys of layers) {
    plan.steps.push(newPlanStep(plan, 'implement', { tickets: keys }))
    plan.steps.push(newPlanStep(plan, 'merge'))
    plan.steps.push(newPlanStep(plan, 'review'))
  }
  draft.value = coerceRunPlan(plan) ?? empty()
  commit()
}

// ── Starting ───────────────────────────────────────────────────────────────
const mode = ref<AutoMode>(props.project.auto?.orchestration.mode ?? DEFAULT_ORCHESTRATION.mode)
const budget = ref(props.project.auto?.orchestration.budget ?? DEFAULT_ORCHESTRATION.budget)
const modeItems = [
  { label: 'One session per ticket', value: 'sessions' },
  { label: 'Orchestrated (Fable 5.1 + Opus 5.5 subagents)', value: 'orchestrated' },
]
const budgetItems = Array.from({ length: ORCHESTRATION_BUDGET_MAX }, (_, i) => ({ label: `${i + 1} at a time`, value: i + 1 }))
const reviewerItems = Array.from({ length: PLAN_REVIEWERS_MAX }, (_, i) => ({ label: `${i + 1} reviewer${i ? 's' : ''}`, value: i + 1 }))

const startBlocker = computed(() => {
  const p = props.project
  if (!p.repo) return 'This project has no repo — set one first.'
  if (!p.integrationBranch) return 'Cut an integration branch first (the Branch button) — merges land on it.'
  if (loopRunning.value) return 'The jButton loop is running — turn it off to run a plan instead.'
  if (!draft.value.steps.some((s) => s.kind === 'implement')) return 'Add an implement step — nothing would run.'
  if (problems.value.length) return 'Fix the problems below first.'
  return ''
})
async function start() {
  if (startBlocker.value) return
  clearTimeout(timer)
  if (saving) await save()
  const n = draft.value.steps.length
  if (!window.confirm(`Run ${props.project.key}'s plan — ${n} step${n === 1 ? '' : 's'}, top to bottom? Hand dispatch of AFK tickets is off while it runs.`)) return
  await startPlan(props.project, { mode: mode.value, budget: budget.value }).catch(() => {})
}

const stepSummary = (s: PlanStep) => {
  if (s.kind === 'merge') return 'Lands every open PR the plan’s tickets have so far on the integration branch (Sonnet 5 sweep). Skipped when there is none.'
  if (s.kind === 'review') {
    const who = s.reviewers === 1 ? 'Every finding it raises' : `Findings all ${s.reviewers} reviewers raise`
    return `Opus 5.5 reviewers in jReview read base…tip. ${who} become tickets here, implemented and merged inside this step.`
  }
  if (s.kind === 'gate') return 'Waits until you press Continue on the auto strip.'
  return ''
}
</script>

<template>
  <section class="flex flex-col gap-4">
    <!-- Header: what this is, how it dispatches, Start -->
    <div class="flex flex-wrap items-start gap-3 rounded-lg border border-default bg-elevated/30 px-4 py-3">
      <div class="min-w-0 flex-1">
        <h2 class="flex items-center gap-2 text-sm font-semibold">
          <UIcon name="i-lucide-list-ordered" class="size-4 text-primary" />
          Run setup
          <UBadge v-if="planRunning" color="success" variant="subtle" size="sm" icon="i-lucide-play">
            running · step {{ (auto?.cursor ?? 0) + 1 }} of {{ draft.steps.length }}
          </UBadge>
        </h2>
        <p class="mt-1 text-sm text-muted">
          Build the run yourself: which tickets go together, and exactly where merges, reviews and gates happen. It runs top to bottom on
          the jButton's engine — the same watchdog, orchestration and merge reports.
          <template v-if="planRunning">Locked steps have started; the rest can still change.</template>
        </p>
      </div>
      <div v-if="!planRunning" class="flex flex-wrap items-center justify-end gap-2">
        <span v-if="startBlocker" class="basis-full text-right text-xs text-warning">{{ startBlocker }}</span>
        <USelect v-model="mode" :items="modeItems" size="sm" class="w-72" />
        <USelect v-if="mode === 'orchestrated'" v-model="budget" :items="budgetItems" size="sm" class="w-32" />
        <UTooltip :text="startBlocker || 'Start the plan — the jButton turns on and walks it'">
          <UButton icon="i-lucide-play" color="success" size="sm" :loading="busy === 'plan'" :disabled="!!startBlocker" @click="start">
            Start plan
          </UButton>
        </UTooltip>
      </div>
    </div>

    <div class="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <!-- The steps -->
      <div class="flex flex-col gap-2">
        <p v-if="!draft.steps.length" class="rounded-md border border-dashed border-default px-4 py-8 text-center text-sm text-muted">
          No steps yet. Tick tickets on the right and make them an implement step, add merge / review / gate steps below — or
          <button class="text-primary hover:underline" :disabled="!forecast.loops.length" @click="draftFromLayers">draft one from the blocker graph</button>.
        </p>

        <div
          v-for="(step, i) in draft.steps"
          :key="step.id"
          class="rounded-lg border px-3 py-2.5 transition-colors"
          :class="[
            locked(i) ? 'border-default bg-elevated/40 opacity-80' : 'border-default',
            problemsOf(step.id).length && !locked(i) && 'border-error/50',
            dropTarget === step.id && 'border-primary bg-primary/5',
          ]"
          @dragover.prevent="step.kind === 'implement' && !locked(i) && (dropTarget = step.id)"
          @dragleave="dropTarget === step.id && (dropTarget = '')"
          @drop.prevent="step.kind === 'implement' && !locked(i) && onDrop(step)"
        >
          <div class="flex flex-wrap items-center gap-2">
            <span class="flex size-5 items-center justify-center rounded-full bg-elevated text-xs font-medium tabular-nums">{{ i + 1 }}</span>
            <UIcon :name="STEP_ICONS[step.kind]" class="size-4 text-muted" />
            <span class="text-sm font-medium">{{ PLAN_STEP_LABELS[step.kind] }}</span>
            <UBadge v-if="stepState(i)" :color="stepState(i)!.color" variant="subtle" size="sm">{{ stepState(i)!.label }}</UBadge>
            <UIcon v-if="locked(i)" name="i-lucide-lock" class="size-3.5 text-dimmed" />
            <a
              v-if="stepState(i)?.record?.reviewKey"
              :href="`https://jreview.local/r/${stepState(i)!.record!.reviewKey}`"
              target="_blank"
              class="text-xs text-primary hover:underline"
            >
              review ↗
            </a>
            <div v-if="!locked(i)" class="ml-auto flex items-center">
              <UButton icon="i-lucide-arrow-up" size="xs" color="neutral" variant="ghost" :disabled="i <= frozen" aria-label="Move up" @click="move(i, -1)" />
              <UButton icon="i-lucide-arrow-down" size="xs" color="neutral" variant="ghost" :disabled="i === draft.steps.length - 1" aria-label="Move down" @click="move(i, 1)" />
              <UButton icon="i-lucide-trash-2" size="xs" color="neutral" variant="ghost" aria-label="Remove step" @click="removeStep(i)" />
            </div>
          </div>

          <!-- implement: its tickets -->
          <div v-if="step.kind === 'implement'" class="mt-2 flex flex-wrap items-center gap-1.5">
            <span
              v-for="k in step.tickets"
              :key="k"
              :draggable="!locked(i)"
              class="inline-flex items-center gap-1 rounded-md border border-default px-2 py-0.5 text-xs"
              :class="!locked(i) && 'cursor-grab'"
              @dragstart="dragging = { key: k, from: step.id }"
              @dragend="dragging = null"
            >
              <UIcon
                v-if="byKey.get(k)"
                :name="isFinished(byKey.get(k)!.status) ? 'i-lucide-circle-check' : 'i-lucide-circle-dashed'"
                :class="isFinished(byKey.get(k)!.status) ? 'text-success' : 'text-muted'"
                class="size-3.5"
              />
              <NuxtLink :to="`/tickets/${k}`" class="font-mono hover:underline">{{ k }}</NuxtLink>
              <span class="max-w-48 truncate text-muted">{{ byKey.get(k)?.title ?? '(unknown)' }}</span>
              <UBadge v-if="byKey.get(k) && isHitl(byKey.get(k)!)" color="warning" variant="subtle" size="xs">HITL · waits on you</UBadge>
              <button v-if="!locked(i)" class="text-dimmed hover:text-default" aria-label="Take out" @click="removeTicket(step, k)">
                <UIcon name="i-lucide-x" class="size-3" />
              </button>
            </span>
            <UButton v-if="!locked(i) && picked.size" size="xs" variant="soft" icon="i-lucide-plus" @click="addPickedTo(step)">
              Add {{ picked.size }} ticked
            </UButton>
            <span v-if="!step.tickets.length && !picked.size && !locked(i)" class="text-xs text-dimmed">Tick tickets on the right, or drag them here.</span>
          </div>

          <!-- review: reviewers + base -->
          <div v-else-if="step.kind === 'review'" class="mt-2 flex flex-wrap items-center gap-2">
            <USelect v-model="step.reviewers" :items="reviewerItems" size="xs" class="w-36" :disabled="locked(i)" @update:model-value="commit" />
            <USelect
              :items="reviewBaseOptions(draft, step.id).map((o) => ({ ...o, value: o.value || 'prev' }))"
              :model-value="step.base || 'prev'"
              size="xs"
              class="w-80"
              :disabled="locked(i)"
              @update:model-value="(v: string) => { step.base = v === 'prev' ? '' : v; commit() }"
            />
          </div>

          <!-- gate: what to check -->
          <div v-else-if="step.kind === 'gate'" class="mt-2">
            <UInput v-model="step.note" size="xs" placeholder="What to check before continuing (optional)" class="w-full max-w-md" :disabled="locked(i)" @change="commit" />
          </div>

          <p v-if="stepSummary(step)" class="mt-1.5 text-xs text-muted">{{ stepSummary(step) }}</p>
          <p v-if="stepState(i)?.record?.fixTickets.length" class="mt-1 text-xs text-muted">
            Fixed: {{ stepState(i)!.record!.fixTickets.join(', ') }}
          </p>
          <ul v-if="!locked(i) && problemsOf(step.id).length" class="mt-1.5 flex flex-col gap-0.5 text-xs text-error">
            <li v-for="(p, n) in problemsOf(step.id)" :key="n" class="flex gap-1">
              <UIcon name="i-lucide-triangle-alert" class="mt-0.5 size-3 shrink-0" />{{ p.message }}
            </li>
          </ul>
        </div>

        <!-- Add a step -->
        <div class="flex flex-wrap items-center gap-1.5 pt-1">
          <span class="text-xs text-muted">Add step:</span>
          <UButton size="xs" variant="soft" :icon="STEP_ICONS.implement" :disabled="!picked.size" @click="addPickedAsStep">
            Implement {{ picked.size ? `${picked.size} ticked` : '' }}
          </UButton>
          <UButton size="xs" variant="soft" color="neutral" :icon="STEP_ICONS.merge" @click="addStep('merge')">Merge</UButton>
          <UButton size="xs" variant="soft" color="neutral" :icon="STEP_ICONS.review" @click="addStep('review')">Review</UButton>
          <UButton size="xs" variant="soft" color="neutral" :icon="STEP_ICONS.gate" @click="addStep('gate')">Gate</UButton>
          <div class="ml-auto flex items-center gap-1">
            <UTooltip text="One implement → merge → review per layer of the blocker graph — the loop's rhythm, to reshape">
              <UButton size="xs" variant="ghost" color="neutral" icon="i-lucide-wand-sparkles" :disabled="planRunning || !forecast.loops.length" @click="draftFromLayers">
                Draft from blockers
              </UButton>
            </UTooltip>
            <UButton v-if="draft.steps.length && !planRunning" size="xs" variant="ghost" color="neutral" icon="i-lucide-eraser" @click="clearPlan">Clear</UButton>
          </div>
        </div>

        <UAlert v-if="planWide.length" color="warning" variant="subtle" icon="i-lucide-triangle-alert" :description="planWide.map((p) => p.message).join(' ')" />
      </div>

      <!-- Tickets not in the plan yet -->
      <aside class="flex flex-col gap-2 self-start rounded-lg border border-default px-3 py-2.5">
        <div class="flex items-center gap-2">
          <h3 class="text-sm font-medium">Not in the plan</h3>
          <UBadge color="neutral" variant="subtle" size="sm">{{ unplaced.length }}</UBadge>
          <UButton v-if="picked.size" class="ml-auto" size="xs" color="neutral" variant="ghost" @click="picked = new Set()">Untick</UButton>
        </div>
        <p v-if="!unplaced.length" class="text-xs text-muted">Every open ticket has a step.</p>
        <ul class="flex max-h-[32rem] flex-col gap-1 overflow-y-auto">
          <li
            v-for="t in unplaced"
            :key="t.id"
            draggable="true"
            class="flex cursor-grab items-start gap-2 rounded-md px-1.5 py-1 text-xs hover:bg-elevated"
            @dragstart="dragging = { key: t.key, from: '' }"
            @dragend="dragging = null"
          >
            <UCheckbox :model-value="picked.has(t.key)" class="mt-0.5" @update:model-value="(v) => togglePick(t.key, v === true)" />
            <div class="min-w-0 flex-1">
              <div class="flex items-center gap-1.5">
                <span class="font-mono">{{ t.key }}</span>
                <UBadge v-if="isHitl(t)" color="warning" variant="subtle" size="xs">HITL</UBadge>
                <UBadge v-if="t.status === 'in_progress'" color="info" variant="subtle" size="xs">in progress</UBadge>
              </div>
              <p class="truncate text-muted">{{ t.title }}</p>
              <p v-if="openBlockers(t).length" class="text-dimmed">after {{ openBlockers(t).map((b) => b.key).join(', ') }}</p>
            </div>
          </li>
        </ul>
      </aside>
    </div>
  </section>
</template>
