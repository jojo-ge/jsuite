<script setup lang="ts">
// Review setup — a PR review project's own run setup (~/utils/reviewPlan.ts).
// Not the Run setup tab: a review plan never implements or merges anything.
//
// Top to bottom: the PR this project reviews; the assessment (one Fable 5.2
// /jreview-assess session decides how many reviewers — 2 to 4 — what they
// all focus on, the brief they all read, and whether any checks are worth
// running); the plan it saved (checks → gate? → review), editable while no run
// is going; and the run — Start, Rerun (re-fetches the PR head and reopens
// the checks), Stop, Continue at a gate, Retry a pause. The findings land in
// the Review tab.
import type { Project, Ticket } from '~/composables/useTracker'
import {
  REVIEW_REVIEWERS_MAX,
  REVIEW_REVIEWERS_MIN,
  reviewPlanProblems,
  reviewStepSummary,
  type ReviewPlan,
  type ReviewPlanStep,
} from '~/utils/reviewPlan'
import { PLAN_MODELS, runnerLabel } from '~/utils/runPlan'

const props = defineProps<{ project: Project; tickets: Ticket[] }>()
const emit = defineEmits<{ openReview: [key: string] }>()

const toast = useToast()
const { refresh } = useTracker()
const { available: herdrUp } = useHerdr()
const errorText = branchErrorText

const pr = computed(() => props.project.prReview!.pr)
const assessment = computed(() => props.project.prReview?.assessment ?? null)
const assessing = computed(() => props.project.prReview?.assessing ?? null)
const plan = computed(() => props.project.prReview?.plan ?? null)
const run = computed(() => props.project.prReview?.run ?? null)
const runs = computed(() => [...(props.project.prReview?.runs ?? [])].reverse())
const live = computed(() => run.value?.status === 'running' || run.value?.status === 'paused')

const ticketByKey = computed(() => new Map(props.tickets.map((t) => [t.key, t])))
const problems = computed(() =>
  plan.value ? reviewPlanProblems(plan.value, props.tickets.map((t) => ({ key: t.key, status: t.status, labels: t.labels }))) : [],
)

const now = ref(new Date())
let clock: ReturnType<typeof setInterval> | undefined
onMounted(() => { clock = setInterval(() => { now.value = new Date() }, 30_000) })
onUnmounted(() => { if (clock) clearInterval(clock) })

/** A check's verdict, off the first `**Verdict:** …` line of its resolution. */
function checkVerdict(t: Ticket | undefined): string {
  return /verdict:?\**\s*`?(pass|fail|concern|inconclusive)/i.exec(t?.resolution ?? '')?.[1]?.toLowerCase() ?? ''
}
const VERDICT_COLOR: Record<string, 'success' | 'error' | 'warning' | 'neutral'> = { pass: 'success', fail: 'error', concern: 'warning', inconclusive: 'neutral' }
const RISK_COLOR = { low: 'success', medium: 'warning', high: 'error' } as const
const RUN_BADGE = {
  running: { label: 'running', color: 'primary' },
  paused: { label: 'paused', color: 'warning' },
  done: { label: 'done', color: 'success' },
  stopped: { label: 'stopped', color: 'neutral' },
} as const
const APPROVAL_LABEL: Record<string, string> = {
  approve: 'recommends approval',
  'approve-with-nits': 'approvable with nits',
  'request-changes': 'changes needed',
  'needs-discussion': 'needs discussion',
}

// ── Actions ──
const busy = ref('')
async function call(what: string, fn: () => Promise<unknown>, done?: string) {
  busy.value = what
  try {
    await fn()
    if (done) toast.add({ title: done, color: 'success', icon: 'i-lucide-check' })
    await refresh()
  } catch (err: any) {
    toast.add({ title: 'jTicket refused', description: errorText(err), color: 'error', icon: 'i-lucide-triangle-alert' })
  } finally {
    busy.value = ''
  }
}
const autoStart = ref(true)
const assess = () =>
  call('assess', () => $fetch(`/api/projects/${props.project.id}/pr-review/assess`, { method: 'POST', body: { autoStart: autoStart.value } }), 'Fable 5.2 is assessing the PR')
const cancelAssess = () => call('cancel', () => $fetch(`/api/projects/${props.project.id}/pr-review/assess`, { method: 'DELETE' }))
const control = (action: 'start' | 'rerun' | 'stop' | 'continue' | 'retry') => {
  if (action === 'stop' && !window.confirm('Stop the review run? Sessions already in herdr carry on.')) return
  const done = { start: 'Review started', rerun: 'Rerunning against the latest PR head', stop: 'Stopped', continue: 'Gate passed', retry: 'Retrying the step' }[action]
  return call(action, () => $fetch(`/api/projects/${props.project.id}/review-run`, { method: 'POST', body: { action } }), done)
}

// ── Plan edits — straight to PUT …/review-plan ──
async function savePlan(next: ReviewPlan) {
  await call('plan', () => $fetch(`/api/projects/${props.project.id}/review-plan`, { method: 'PUT', body: next }))
}
function patchStep(step: ReviewPlanStep, patch: Partial<ReviewPlanStep>) {
  if (!plan.value) return
  savePlan({ steps: plan.value.steps.map((s) => (s.id === step.id ? { ...s, ...patch } : s)) })
}
function dropCheck(step: ReviewPlanStep, key: string) {
  if (!plan.value) return
  const tickets = step.tickets.filter((k) => k !== key)
  savePlan({ steps: plan.value.steps.flatMap((s) => (s.id !== step.id ? [s] : tickets.length ? [{ ...s, tickets }] : [])) })
}
function removeStep(step: ReviewPlanStep) {
  if (!plan.value) return
  savePlan({ steps: plan.value.steps.filter((s) => s.id !== step.id) })
}
function addGate() {
  if (!plan.value) return
  const note = window.prompt('What should you look at before the reviewers start?', 'Read the check results')
  if (note === null) return
  const steps = [...plan.value.steps]
  const at = Math.max(0, steps.findIndex((s) => s.kind === 'review'))
  steps.splice(at, 0, { id: `g${Date.now().toString(36)}`, kind: 'gate', tickets: [], runners: {}, reviewers: 2, model: 'opus', effort: 'high', verify: true, note })
  savePlan({ steps })
}
const REVIEWER_ITEMS = Array.from({ length: REVIEW_REVIEWERS_MAX - REVIEW_REVIEWERS_MIN + 1 }, (_, i) => {
  const n = REVIEW_REVIEWERS_MIN + i
  return { label: `${n} reviewers`, value: n }
})

const stepState = (i: number) => {
  if (!run.value || run.value.status === 'stopped') return 'idle'
  if (run.value.status === 'done' || i < run.value.cursor) return 'done'
  return i === run.value.cursor ? 'current' : 'next'
}
const runStepCount = computed(() => run.value?.plan.steps.length ?? 0)
</script>

<template>
  <section class="space-y-4">
    <!-- The PR -->
    <div class="rounded-lg border border-default px-4 py-3">
      <div class="flex flex-wrap items-start gap-3">
        <UIcon name="i-lucide-git-pull-request" class="mt-0.5 size-5 shrink-0 text-muted" />
        <div class="min-w-0 flex-1">
          <p class="flex flex-wrap items-center gap-2">
            <a :href="pr.url" target="_blank" class="font-medium hover:underline">#{{ pr.number }} {{ pr.title }}</a>
            <UBadge v-if="pr.isDraft" color="neutral" variant="outline" size="sm">draft</UBadge>
            <UBadge v-if="pr.state !== 'OPEN'" :color="pr.state === 'MERGED' ? 'success' : 'neutral'" variant="subtle" size="sm">{{ pr.state.toLowerCase() }}</UBadge>
          </p>
          <p class="mt-0.5 truncate text-xs text-muted">
            <template v-if="pr.author">@{{ pr.author }} · </template>
            <span class="font-mono">{{ pr.headRefName }}</span> → <span class="font-mono">{{ pr.baseRefName }}</span>
            · head <span class="font-mono">{{ pr.headSha.slice(0, 10) }}</span>
            <template v-if="pr.fetchedAt"> · fetched {{ agoLabel(pr.fetchedAt, now) }}</template>
          </p>
        </div>
        <UButton :to="pr.url" target="_blank" external icon="i-lucide-external-link" size="xs" color="neutral" variant="ghost">GitHub</UButton>
      </div>
      <p class="mt-2 text-xs text-muted">
        Read-only: the head lives on the local branch <span class="font-mono">{{ project.integrationBranch }}</span>, never pushed.
        Nothing here approves the PR or comments on it without your press in the Review tab.
      </p>
    </div>

    <!-- The assessment -->
    <div class="rounded-lg border border-default px-4 py-3">
      <div class="flex flex-wrap items-center gap-2">
        <span class="text-sm font-semibold">Assessment</span>
        <UBadge v-if="assessment" :color="RISK_COLOR[assessment.risk]" variant="subtle" size="sm">{{ assessment.risk }} risk</UBadge>
        <span v-if="assessment" class="text-xs text-muted">· {{ assessment.reviewers }} reviewers · {{ agoLabel(assessment.assessedAt, now) }}</span>
        <div class="ml-auto flex items-center gap-2">
          <template v-if="assessing">
            <span class="flex items-center gap-1.5 text-xs text-muted">
              <UIcon name="i-lucide-loader-circle" class="size-3.5 animate-spin text-primary" />
              Fable 5.2 is reading the PR · herdr · <span class="font-mono">{{ assessing.agent }}</span>
              <template v-if="assessing.autoStart"> · starts the review when done</template>
            </span>
            <UButton size="xs" color="neutral" variant="ghost" :loading="busy === 'cancel'" @click="cancelAssess">Cancel</UButton>
          </template>
          <template v-else>
            <UCheckbox v-model="autoStart" label="Start the review when it's ready" :disabled="live" />
            <UButton
              icon="i-lucide-sparkles"
              size="sm"
              :variant="assessment ? 'soft' : 'solid'"
              :loading="busy === 'assess'"
              :disabled="live || !herdrUp"
              @click="assess"
            >
              {{ assessment ? 'Reassess' : 'Assess with Fable' }}
            </UButton>
          </template>
        </div>
      </div>
      <p v-if="!herdrUp" class="mt-1 text-xs text-warning">herdr isn't running — start it first, or the assessor can't be dispatched.</p>

      <div v-if="assessment" class="mt-2 space-y-2 text-sm">
        <div v-if="assessment.focus.length" class="flex flex-wrap gap-1.5">
          <UBadge v-for="f in assessment.focus" :key="f" color="neutral" variant="outline" size="sm">{{ f }}</UBadge>
        </div>
        <p class="whitespace-pre-line text-muted">{{ assessment.rationale }}</p>
        <NuxtLink v-if="assessment.briefDoc" :to="`/docs/${assessment.briefDoc}`" class="inline-flex items-center gap-1 text-xs text-primary hover:underline">
          <UIcon name="i-lucide-file-text" class="size-3.5" /> The reviewers' brief · {{ assessment.briefDoc }}
        </NuxtLink>
      </div>
      <p v-else-if="!assessing" class="mt-2 text-sm text-muted">
        One Fable 5.2 session reads the PR and the code around it, then decides how many reviewers it needs (2–4), what they
        all focus on, and whether anything is worth running before they read it — tests, a build, a stress script.
      </p>
    </div>

    <!-- The plan -->
    <div v-if="plan" class="rounded-lg border border-default">
      <div class="flex flex-wrap items-center gap-2 border-b border-default px-4 py-2">
        <span class="text-sm font-semibold">Review plan</span>
        <UBadge v-if="run" :color="RUN_BADGE[run.status].color" variant="subtle" size="sm">run {{ run.n }} · {{ RUN_BADGE[run.status].label }}</UBadge>
        <div class="ml-auto flex items-center gap-1.5">
          <template v-if="live">
            <UButton v-if="run?.status === 'paused'" icon="i-lucide-rotate-ccw" size="sm" :loading="busy === 'retry'" @click="control('retry')">Retry step</UButton>
            <UButton icon="i-lucide-square" size="sm" color="neutral" variant="soft" :loading="busy === 'stop'" @click="control('stop')">Stop</UButton>
          </template>
          <template v-else>
            <UButton v-if="!live && !assessing" icon="i-lucide-milestone" size="sm" color="neutral" variant="ghost" :disabled="!!busy" @click="addGate">Add gate</UButton>
            <UButton
              v-if="runs.length"
              icon="i-lucide-refresh-cw"
              size="sm"
              :loading="busy === 'rerun'"
              :disabled="!!problems.length || !!assessing || !herdrUp"
              @click="control('rerun')"
            >
              Rerun review
            </UButton>
            <UButton
              v-else
              icon="i-lucide-play"
              size="sm"
              :loading="busy === 'start'"
              :disabled="!!problems.length || !!assessing || !herdrUp"
              @click="control('start')"
            >
              Start review
            </UButton>
          </template>
        </div>
      </div>

      <UAlert
        v-if="run?.status === 'paused'"
        color="warning"
        variant="subtle"
        icon="i-lucide-pause"
        :title="`Paused at step ${run.cursor + 1}`"
        :description="run.pausedFor"
        class="m-3"
      />
      <ul v-if="problems.length" class="m-3 space-y-0.5 text-xs text-error">
        <li v-for="p in problems" :key="p.stepId + p.message">· {{ p.message }}</li>
      </ul>

      <ol class="divide-y divide-default/60">
        <li v-for="(s, i) in (live ? run!.plan.steps : plan.steps)" :key="s.id" class="flex gap-3 px-4 py-2.5">
          <span
            class="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold"
            :class="{
              'bg-success/15 text-success': stepState(i) === 'done',
              'bg-primary/15 text-primary': stepState(i) === 'current',
              'bg-elevated text-muted': stepState(i) === 'next' || stepState(i) === 'idle',
            }"
          >
            <UIcon v-if="stepState(i) === 'done'" name="i-lucide-check" class="size-3" />
            <UIcon v-else-if="stepState(i) === 'current' && run?.status === 'running'" name="i-lucide-loader-circle" class="size-3 animate-spin" />
            <template v-else>{{ i + 1 }}</template>
          </span>
          <div class="min-w-0 flex-1 space-y-1.5">
            <p class="flex flex-wrap items-center gap-2 text-sm">
              <span class="font-medium">{{ s.kind === 'checks' ? 'Checks' : s.kind === 'gate' ? 'Gate' : 'Review' }}</span>
              <span class="text-xs text-muted">{{ reviewStepSummary(s) }}</span>
              <UButton
                v-if="!live && s.kind !== 'review'"
                icon="i-lucide-x"
                size="xs"
                color="neutral"
                variant="ghost"
                class="ml-auto"
                :aria-label="`Remove step ${i + 1}`"
                @click="removeStep(s)"
              />
            </p>

            <!-- checks -->
            <div v-if="s.kind === 'checks'" class="space-y-1">
              <div v-for="k in s.tickets" :key="k" class="flex items-center gap-2 text-sm">
                <NuxtLink :to="`/tickets/${k}`" class="font-mono text-xs hover:underline">{{ k }}</NuxtLink>
                <span class="min-w-0 flex-1 truncate">{{ ticketByKey.get(k)?.title ?? 'missing ticket' }}</span>
                <span class="shrink-0 text-xs text-dimmed">{{ runnerLabel(s.runners[k] ?? { model: 'opus', effort: 'medium' }) }}</span>
                <UBadge v-if="checkVerdict(ticketByKey.get(k))" :color="VERDICT_COLOR[checkVerdict(ticketByKey.get(k))]" variant="subtle" size="sm">
                  {{ checkVerdict(ticketByKey.get(k)) }}
                </UBadge>
                <UBadge v-else-if="ticketByKey.get(k)" :color="STATUS_META[ticketByKey.get(k)!.status].color" variant="subtle" size="sm">
                  {{ STATUS_META[ticketByKey.get(k)!.status].label }}
                </UBadge>
                <UButton v-if="!live" icon="i-lucide-minus" size="xs" color="neutral" variant="ghost" :aria-label="`Drop ${k}`" @click="dropCheck(s, k)" />
              </div>
            </div>

            <!-- gate -->
            <div v-else-if="s.kind === 'gate'" class="flex items-center gap-2 text-sm text-muted">
              <span>{{ s.note || 'Waits for you.' }}</span>
              <UButton
                v-if="live && run?.cursor === i && !run.gatePassed"
                icon="i-lucide-arrow-right"
                size="xs"
                class="ml-auto"
                :loading="busy === 'continue'"
                @click="control('continue')"
              >
                Continue
              </UButton>
            </div>

            <!-- review -->
            <div v-else class="flex flex-wrap items-center gap-3 text-sm">
              <USelect
                :model-value="s.reviewers"
                :items="REVIEWER_ITEMS"
                value-key="value"
                size="xs"
                class="w-32"
                :disabled="live"
                @update:model-value="patchStep(s, { reviewers: Number($event) })"
              />
              <span class="text-xs text-muted">{{ PLAN_MODELS[s.model].label }} {{ s.effort }} · the same brief for every reviewer · only what they all raise survives</span>
              <USwitch
                :model-value="s.verify"
                label="Adversarially verify findings"
                size="xs"
                :disabled="live"
                @update:model-value="patchStep(s, { verify: !!$event })"
              />
              <UButton
                v-if="run?.reviewKey && (stepState(i) === 'current' || stepState(i) === 'done')"
                icon="i-lucide-scan-search"
                size="xs"
                color="neutral"
                variant="ghost"
                class="ml-auto"
                @click="emit('openReview', run.reviewKey)"
              >
                Findings
              </UButton>
            </div>
          </div>
        </li>
      </ol>
      <p v-if="live && run" class="border-t border-default px-4 py-2 text-xs text-muted">
        Run {{ run.n }} · head <span class="font-mono">{{ run.headSha.slice(0, 10) }}</span> · step {{ Math.min(run.cursor + 1, runStepCount) }} of {{ runStepCount }}
        · started {{ agoLabel(run.startedAt, now) }}
      </p>
    </div>
    <p v-else-if="assessment" class="rounded-lg border border-dashed border-default py-6 text-center text-sm text-muted">
      The assessment saved no plan — Reassess.
    </p>

    <!-- Past runs -->
    <div v-if="runs.length" class="space-y-1">
      <h3 class="text-xs font-semibold uppercase tracking-wide text-muted">Runs</h3>
      <div v-for="r in runs" :key="r.n" class="flex flex-wrap items-center gap-2 rounded-md border border-default px-3 py-1.5 text-sm">
        <span class="font-medium">Run {{ r.n }}</span>
        <UBadge :color="RUN_BADGE[r.status].color" variant="subtle" size="sm">{{ RUN_BADGE[r.status].label }}</UBadge>
        <span class="font-mono text-xs text-muted">{{ r.headSha.slice(0, 10) }}</span>
        <span v-if="r.verdict" class="text-xs">{{ APPROVAL_LABEL[r.verdict] ?? r.verdict }}</span>
        <span class="ml-auto text-xs text-muted">{{ agoLabel(r.endedAt || r.startedAt, now) }}</span>
        <UButton v-if="r.reviewKey" size="xs" color="neutral" variant="ghost" icon="i-lucide-scan-search" @click="emit('openReview', r.reviewKey)">Findings</UButton>
      </div>
    </div>
  </section>
</template>
