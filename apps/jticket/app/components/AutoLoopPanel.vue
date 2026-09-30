<script setup lang="ts">
// Auto mode's strip, above the project page's tabs while the jButton is on:
// which loop, which phase, what it's waiting on, why it paused — and the "Stop
// at the end of next loop" button. Finished loops live in the Loops tab
// (<AutoLoopHistory>). When auto mode is off it shows only how the last
// run ended (if there was one). Everything reads project.auto, which the
// server's loop keeps current; nothing here advances the loop.
import type { LocalPr, Project, Ticket } from '~/composables/useTracker'
import { AUTO_PHASES, NO_PR_RETRIES, OUTCOME_WORD_LIMIT, REPORT_PHASE, STALL_FORCE_MS, autoPending, inFlight, type AutoLoop } from '~/utils/autoLoop'
import { outcomeDocOf } from '~/utils/projectGraphs'
import { PLAN_STEP_LABELS } from '~/utils/runPlan'

const props = defineProps<{ project: Project; tickets: Ticket[] }>()
const { prs, docs } = useTracker()
const { busy, requestStop, retry, turnOff, continueGate } = useAutoLoop()

const auto = computed<AutoLoop | null>(() => props.project.auto ?? null)
const on = computed(() => !!auto.value?.enabled)

// A clock for "running for 12m" — minute resolution is plenty.
const clock = ref(Date.now())
let timer: ReturnType<typeof setInterval> | undefined
onMounted(() => {
  timer = setInterval(() => (clock.value = Date.now()), 30_000)
})
onBeforeUnmount(() => clearInterval(timer))
function since(iso: string) {
  const ms = clock.value - new Date(iso).getTime()
  if (!Number.isFinite(ms) || ms < 60_000) return 'just now'
  const m = Math.floor(ms / 60_000)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  return `${h}h ${m % 60}m`
}

// The loop's stepper — or a run plan's steps — or, once the project is
// finished, its one last phase.
const plan = computed(() => (auto.value?.phase === 'reporting' ? null : auto.value?.plan ?? null))
const phases = computed(() => {
  if (auto.value?.phase === 'reporting') return [REPORT_PHASE]
  if (plan.value) return plan.value.steps.map((s) => ({ phase: s.id, label: PLAN_STEP_LABELS[s.kind] }))
  return AUTO_PHASES
})
const phaseIndex = computed(() =>
  plan.value ? auto.value!.cursor : phases.value.findIndex((p) => p.phase === auto.value?.phase),
)
const planStepNo = computed(() => (plan.value ? `Step ${auto.value!.cursor + 1}` : ''))
const reviewers = computed(() => {
  const s = plan.value?.steps[auto.value!.cursor]
  return s?.kind === 'review' ? s.reviewers : 2
})

const outcomeDoc = computed(() => outcomeDocOf(docs.value, props.project.id))

const byKey = computed(() => new Map(props.tickets.map((t) => [t.key, t])))
const prByKey = computed(() => new Map(prs.value.map((p: LocalPr) => [p.key, p])))

const pending = computed(() => {
  const a = auto.value
  if (!a) return { tickets: [] as Ticket[], prs: [] as LocalPr[] }
  const p = autoPending(a)
  return {
    tickets: p.tickets.map((k) => byKey.value.get(k)).filter((t): t is Ticket => !!t),
    prs: p.prs.map((k) => prByKey.value.get(k)).filter((x): x is LocalPr => !!x),
  }
})

const phaseText = computed(() => {
  const a = auto.value
  if (!a) return ''
  if ((a.phase === 'implementing' || a.phase === 'fixing') && a.prChecks > 0) {
    return `Every ticket is finished but no PR has shown up — looking again (${a.prChecks} of ${NO_PR_RETRIES + 1} looks) before skipping the merge.`
  }
  if ((a.phase === 'merging' || a.phase === 'merging-fixes') && a.mergeDispatchedAt && !a.mergeReportedAt) {
    const n = a.prs.length
    return `Merge sweep on Sonnet 5 — landing ${n} ${a.phase === 'merging-fixes' ? 'fix ' : ''}PR${n === 1 ? '' : 's'}; moves on when the sweep reports back.`
  }
  if ((a.phase === 'implementing' || a.phase === 'fixing') && a.orchestration.mode === 'orchestrated') {
    const n = (a.phase === 'implementing' ? a.tickets : a.fixTickets).length
    const what = a.phase === 'implementing' ? `${n} frontier ticket${n === 1 ? '' : 's'}` : `${n} agreed finding${n === 1 ? '' : 's'}`
    if (!a.orchestrator.dispatchedAt) return `Starting a Fable 5.1 orchestrator for ${what}.`
    return `A Fable 5.1 orchestrator is working ${what} through Opus 5.5 subagents — ${flying.value.length} of ${a.orchestration.budget} in flight, each spec-checked before it's done.`
  }
  if (plan.value) {
    const n = a.tickets.length
    switch (a.phase) {
      case 'idle':
        return 'Between steps — starting the next one.'
      case 'implementing':
        return `${planStepNo.value}: implementing ${n} ticket${n === 1 ? '' : 's'} on Opus 5.5.`
      case 'reviewing':
        return a.reviewKey
          ? `${planStepNo.value}: ${reviewers.value === 1 ? 'an Opus 5.5 reviewer is' : `${reviewers.value} Opus 5.5 reviewers are`} reading the changes since this step's checkpoint; ${reviewers.value === 1 ? 'its findings come' : 'findings they all raise come'} back as tickets, then get fixed and merged.`
          : `${planStepNo.value}: asking jReview for a review of the changes since this step's checkpoint.`
      case 'gate': {
        const note = plan.value.steps[a.cursor]?.note
        return `${planStepNo.value}: gate — press Continue when you're ready.${note ? ` ${note}` : ''}`
      }
    }
  }
  switch (a.phase) {
    case 'idle':
      return 'Between loops — picking up the next frontier.'
    case 'implementing':
      return `Implementing ${a.tickets.length} frontier ticket${a.tickets.length === 1 ? '' : 's'} on Opus 5.5.`
    case 'merging':
      return `Merge sweep on Sonnet 5 — landing ${a.prs.length} PR${a.prs.length === 1 ? '' : 's'}.`
    case 'reviewing':
      return a.reviewKey
        ? 'Two Opus 5.5 reviewers are reading this loop\'s changes; agreed findings come back as tickets.'
        : 'Asking jReview for a review of this loop\'s changes.'
    case 'fixing':
      return `Fixing ${a.fixTickets.length} finding${a.fixTickets.length === 1 ? '' : 's'} both reviewers agreed on.`
    case 'merging-fixes':
      return `Merge sweep on Sonnet 5 — landing ${a.prs.length} fix PR${a.prs.length === 1 ? '' : 's'}.`
    case 'reporting':
      return a.reportedAt
        ? `Outcome report ${a.reportDoc} is in — finishing up.`
        : `Every ticket is finished. An Opus 5.5 session is writing the project's outcome report (≤${OUTCOME_WORD_LIMIT} words: what was built and how it works).`
  }
  return ''
})

const ticketDone = (t: Ticket) => t.status === 'done' || t.status === 'merged'

// Orchestrated mode: the tickets its orchestrator has claimed and not finished.
const flying = computed(() => {
  const a = auto.value
  if (!a) return []
  return inFlight(a, { tickets: props.tickets.map((t) => ({ key: t.key, status: t.status, frontier: false, hitl: false, claimed: !!t.assignee })) })
})

// The watchdog's view of the orchestrator — as stallOf, for the one session.
const orchestratorStall = computed(() => {
  const a = auto.value
  if (!a || a.orchestration.mode !== 'orchestrated' || (a.phase !== 'implementing' && a.phase !== 'fixing')) return null
  const w = a.orchestrator.watch
  if (!w.stoppedSince) return null
  return w.nudgedAt
    ? `The orchestrator stopped with tickets open and was prompted to carry on ${since(w.nudgedAt)} ago — the loop replaces it if it stays stopped ${STALL_FORCE_MS / 60_000}m.`
    : `The orchestrator stopped ${since(w.stoppedSince)} ago with tickets still open — the loop prompts it to carry on soon.`
})

// The watchdog's view of a pending ticket: its session stopped with the
// ticket open, or already prompted to finish (then closed for it if it doesn't).
function stallOf(t: Ticket): { icon: string; hint: string } | null {
  const w = auto.value?.watch[t.key]
  if (ticketDone(t) || !w?.stoppedSince) return null
  if (w.nudgedAt) {
    return {
      icon: 'i-lucide-alarm-clock',
      hint: `Its session stopped with ${t.key} open and was prompted to finish ${since(w.nudgedAt)} ago — the loop closes it if it stays stopped ${STALL_FORCE_MS / 60_000}m.`,
    }
  }
  return { icon: 'i-lucide-hourglass', hint: `Its session stopped ${since(w.stoppedSince)} ago with ${t.key} still open — the loop prompts it to finish soon.` }
}
const prDone = (p: LocalPr) => p.status === 'merged' || p.status === 'closed'

const endedText = computed(() => {
  const e = auto.value?.ended
  if (!e) return ''
  const when = new Date(e.at).toLocaleString()
  if (e.reason === 'complete') return `Auto mode finished — no open work left (${when}).${outcomeDoc.value ? '' : ' No outcome report was recorded.'}`
  if (e.reason === 'stopped') return `Auto mode stopped at the end of a ${auto.value?.history.at(-1)?.plan ? 'plan step' : 'loop'}, as asked (${when}).`
  if (e.reason === 'plan-finished') return `The run plan finished (${when}) — open tickets remain; plan the next run in the Run setup tab.`
  return `Auto mode was turned off (${when}).`
})

async function turnOffNow() {
  if (!window.confirm('Turn auto mode off now, mid-loop? Sessions already running in herdr carry on; the loop stops driving them.')) return
  await turnOff(props.project).catch(() => {})
}
</script>

<template>
  <section v-if="on && auto" class="mb-6 rounded-lg border border-success/40 bg-success/5 px-4 py-3">
    <!-- The strip: which loop, the phase stepper, and the stop controls -->
    <div class="flex flex-wrap items-center gap-x-3 gap-y-2">
      <div class="flex items-center gap-1.5">
        <UIcon name="i-lucide-infinity" class="size-4 text-success" />
        <h2 class="text-sm font-semibold">
          <template v-if="plan">Run plan · step {{ Math.min(auto.cursor + 1, plan.steps.length) }} of {{ plan.steps.length }}</template>
          <template v-else>Loop {{ auto.loop }}</template>
        </h2>
        <UBadge v-if="auto.paused" color="warning" variant="subtle" size="sm">
          {{ auto.paused.reason === 'waiting-human' ? 'waiting on you' : 'paused' }}
        </UBadge>
      </div>

      <ol class="flex flex-wrap items-center gap-1 text-xs">
        <template v-for="(p, i) in phases" :key="p.phase">
          <li
            class="rounded-full px-2 py-0.5"
            :title="plan ? `Step ${i + 1}` : undefined"
            :class="
              i === phaseIndex
                ? 'bg-success text-inverted font-medium'
                : i < phaseIndex
                  ? 'bg-success/15 text-success'
                  : 'bg-elevated text-muted'
            "
          >
            {{ p.label }}
          </li>
          <UIcon v-if="i < phases.length - 1" name="i-lucide-chevron-right" class="size-3 text-dimmed" />
        </template>
      </ol>
      <span v-if="auto.phase !== 'idle'" class="text-xs text-muted">{{ since(auto.phaseStartedAt) }}</span>

      <div class="ml-auto flex items-center gap-1">
        <!-- Stop is moot once the project is finished and only its report is left -->
        <UButton
          v-if="auto.phase === 'gate'"
          size="xs"
          color="success"
          icon="i-lucide-play"
          :loading="busy === 'continue'"
          @click="continueGate(project).catch(() => {})"
        >
          Continue
        </UButton>
        <UButton
          v-if="auto.phase !== 'reporting' && !auto.stopRequested"
          size="xs"
          color="warning"
          variant="soft"
          icon="i-lucide-octagon-pause"
          :loading="busy === 'stop'"
          @click="requestStop(project, true).catch(() => {})"
        >
          {{ plan ? 'Stop after this step' : 'Stop at the end of next loop' }}
        </UButton>
        <template v-else-if="auto.phase !== 'reporting'">
          <UTooltip
            :text="plan ? 'Auto mode turns off once the step in progress is finished; the rest of the plan stays in Run setup.' : 'Auto mode turns off once this loop\'s fixes are merged (or after the outcome report, if this loop finishes the project).'"
          >
            <UBadge color="warning" variant="subtle" icon="i-lucide-octagon-pause">
              {{ plan ? `Stopping after step ${auto.cursor + 1}` : `Stopping after loop ${auto.loop}` }}
            </UBadge>
          </UTooltip>
          <UButton size="xs" color="neutral" variant="soft" :loading="busy === 'stop'" @click="requestStop(project, false).catch(() => {})">
            Keep going
          </UButton>
        </template>
        <UButton
          size="xs"
          color="neutral"
          variant="ghost"
          icon="i-lucide-power"
          :loading="busy === 'off'"
          @click="turnOffNow"
        >
          Turn off now
        </UButton>
      </div>
    </div>

    <!-- What the phase is doing, and what it's waiting on -->
    <div class="mt-2 flex flex-wrap items-center gap-1.5">
      <p class="mr-1 text-sm text-muted">{{ phaseText }}</p>
      <UTooltip v-if="orchestratorStall" :text="orchestratorStall">
        <UIcon name="i-lucide-alarm-clock" class="size-4 text-warning" />
      </UTooltip>
      <NuxtLink
        v-for="t in pending.tickets"
        :key="t.key"
        :to="`/tickets/${t.key}`"
        class="inline-flex items-center gap-1 rounded-md border border-default px-2 py-0.5 text-xs hover:bg-elevated"
        :class="ticketDone(t) && 'opacity-60'"
      >
        <UIcon
          :name="ticketDone(t) ? 'i-lucide-circle-check' : t.status === 'in_progress' || flying.includes(t.key) ? 'i-lucide-loader-circle' : 'i-lucide-circle-dashed'"
          :class="[ticketDone(t) ? 'text-success' : 'text-muted', !ticketDone(t) && (t.status === 'in_progress' || flying.includes(t.key)) && 'animate-spin']"
          class="size-3.5"
        />
        <span class="font-mono">{{ t.key }}</span>
        <span class="max-w-48 truncate text-muted">{{ t.title }}</span>
        <UTooltip v-if="stallOf(t)" :text="stallOf(t)!.hint">
          <UIcon :name="stallOf(t)!.icon" class="size-3.5 text-warning" />
        </UTooltip>
      </NuxtLink>
      <span
        v-for="p in pending.prs"
        :key="p.key"
        class="inline-flex items-center gap-1 rounded-md border border-default px-2 py-0.5 text-xs"
        :class="prDone(p) && 'opacity-60'"
      >
        <UIcon
          :name="prDone(p) ? 'i-lucide-git-merge' : p.status === 'conflicted' ? 'i-lucide-git-pull-request-closed' : 'i-lucide-git-pull-request'"
          :class="prDone(p) ? 'text-success' : p.status === 'conflicted' ? 'text-error' : 'text-muted'"
          class="size-3.5"
        />
        <span class="font-mono">{{ p.key }}</span>
        <span class="text-muted">{{ p.status }}</span>
      </span>
      <a
        v-if="auto.reviewKey"
        :href="`https://jreview.local/r/${auto.reviewKey}`"
        target="_blank"
        class="text-xs text-primary hover:underline"
      >
        This {{ plan ? 'step' : 'loop' }}'s review in jReview ↗
      </a>
    </div>

    <!-- A pause, and the way out of it -->
    <UAlert
      v-if="auto.paused"
      class="mt-3"
      :color="auto.paused.reason === 'waiting-human' ? 'info' : 'warning'"
      variant="subtle"
      :icon="auto.paused.reason === 'waiting-human' ? 'i-lucide-hand' : 'i-lucide-circle-pause'"
      :title="auto.paused.reason === 'waiting-human' ? 'Waiting on you' : 'Paused'"
      :description="auto.paused.detail"
    >
      <template v-if="auto.paused.reason !== 'waiting-human'" #actions>
        <UButton size="xs" icon="i-lucide-rotate-ccw" :loading="busy === 'retry'" @click="retry(project).catch(() => {})">
          Retry step
        </UButton>
      </template>
    </UAlert>
  </section>

  <p v-else-if="endedText" class="mb-6 flex flex-wrap items-center gap-2 text-xs text-muted">
    <UIcon name="i-lucide-infinity" class="size-4" />
    {{ endedText }}
    <NuxtLink v-if="auto?.ended?.reason === 'complete' && outcomeDoc" :to="`/docs/${outcomeDoc.key}`" class="text-primary hover:underline">
      Outcome report {{ outcomeDoc.key }}
    </NuxtLink>
  </p>
</template>
