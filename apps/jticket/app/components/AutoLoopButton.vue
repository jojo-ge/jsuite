<script setup lang="ts">
// The jButton — auto mode's on/off switch in the project header. Turning it
// on goes through a confirmation modal (it will spend real sessions); turning
// it off is immediate and leaves any running herdr sessions alone. The
// "Stop at the end of next loop" button lives in <AutoLoopPanel>.
import type { Project, Ticket } from '~/composables/useTracker'
import { DEFAULT_ORCHESTRATION, ORCHESTRATION_BUDGET_MAX, type AutoMode } from '~/utils/autoLoop'
import { BUDGET_MIN, EFFORTS, PLAN_MODELS, PLAN_MODEL_KEYS, PLAN_ORCHESTRATORS_MAX, type Effort, type PlanModel } from '~/utils/runPlan'

const props = defineProps<{ project: Project; tickets: Ticket[]; allTickets: Ticket[] }>()
const { busy, start, turnOff } = useAutoLoop()

const on = computed(() => !!props.project.auto?.enabled)
const confirmOpen = ref(false)
const error = ref('')

// How implementing / fixing dispatch — seeded from the last run's setting.
const mode = ref<AutoMode>(DEFAULT_ORCHESTRATION.mode)
const model = ref<PlanModel>(DEFAULT_ORCHESTRATION.model)
const effort = ref<Effort>(DEFAULT_ORCHESTRATION.effort)
const budget = ref(DEFAULT_ORCHESTRATION.budget)
const orchestrators = ref(DEFAULT_ORCHESTRATION.orchestrators)
const orchestrated = computed(() => mode.value === 'orchestrated')
const modelLabel = computed(() => PLAN_MODELS[model.value].label)
const modeItems = [
  { label: 'One session per ticket', value: 'sessions', description: 'Every ticket at once, each in its own session and worktree on the model below. Fastest, heaviest.' },
  { label: 'Orchestrated', value: 'orchestrated', description: 'One Fable 5.2 session runs the tickets through subagents on the model below, in pooled worktrees, deciding what runs side by side. Lighter, slower.' },
]
const modelItems = PLAN_MODEL_KEYS.map((m) => ({ label: PLAN_MODELS[m].label, value: m }))
const effortItems = EFFORTS.map((e) => ({ label: `${e} effort`, value: e }))
// Never 1: an orchestrator running one subagent at a time costs more than the work (BUDGET_MIN).
const budgetItems = Array.from({ length: ORCHESTRATION_BUDGET_MAX - BUDGET_MIN + 1 }, (_, i) => ({ label: `${BUDGET_MIN + i} at a time${orchestrators.value > 1 ? ' each' : ''}`, value: BUDGET_MIN + i }))
const orchestratorItems = Array.from({ length: PLAN_ORCHESTRATORS_MAX }, (_, i) => ({ label: `${i + 1} orchestrator${i ? 's' : ''}`, value: i + 1 }))

const afkFrontier = computed(() =>
  props.tickets.filter((t) => isFrontier(t, props.allTickets, props.project) && !isHitl(t) && !isPaused(t)),
)
const hitlFrontier = computed(() =>
  props.tickets.filter((t) => isFrontier(t, props.allTickets, props.project) && (isHitl(t) || isPaused(t))),
)
// How many loops pressing it would run — each a layer of the blocker graph the
// AFK frontier works through (utils/autoForecast.ts). The review's fix tickets
// ride inside their loop, so they never add one.
const forecast = computed(() => autoForecastFor(props.project, props.tickets, props.allTickets))
const loopCount = computed(() => forecast.value.loops.length)
// With auto on, the count is where the loop in progress sits among them.
const runningLoop = computed(() => {
  const a = props.project.auto
  return a?.enabled && a.phase !== 'idle' && a.phase !== 'reporting' ? a.loop : 0
})
const countLabel = computed(() => {
  const a = props.project.auto
  // A run plan counts its own steps, not forecast loops.
  if (on.value && a?.plan) return a.phase === 'reporting' ? '' : `step ${Math.min(a.cursor + 1, a.plan.steps.length)} of ${a.plan.steps.length}`
  if (on.value) {
    if (!runningLoop.value) return loopCount.value ? `${loopCount.value} to go` : ''
    return `loop ${runningLoop.value} of ${runningLoop.value - 1 + loopCount.value}`
  }
  return `${loopCount.value} loop${loopCount.value === 1 ? '' : 's'}`
})
const countHint = computed(() => {
  if (on.value && props.project.auto?.plan) return 'Auto mode is walking the Run setup plan — see the Run setup tab.'
  const n = loopCount.value
  const gated = forecast.value.gated.length
  const base = n
    ? `${on.value ? 'Auto mode has' : 'Pressing it runs'} ${n} more loop${n === 1 ? '' : 's'} if every dispatched ticket finishes in its loop — one per layer of the blocker graph.`
    : 'No AFK work the loop can reach — pressing it would wait for a human.'
  return gated
    ? `${base} ${gated} ticket${gated === 1 ? ' needs' : 's need'} a human first (HITL, or waiting on one) and no loop reaches ${gated === 1 ? 'it' : 'them'}.`
    : base
})

// What would stop the server from saying yes — shown before the human confirms.
const blocker = computed(() => {
  const p = props.project
  if (p.mode !== 'standard') return `Auto mode drives build projects — this is a ${projectTypeNoun(p.mode)} project.`
  if (!p.repo) return 'This project has no repo — set one first.'
  if (!p.integrationBranch) return 'This project has no integration branch — cut one first (the Branch button). Every loop merges into it.'
  return ''
})

async function onClick() {
  if (on.value) {
    if (!window.confirm('Turn auto mode off now? Sessions already running in herdr carry on; the loop stops driving them.')) return
    await turnOff(props.project).catch(() => {})
    return
  }
  error.value = ''
  const o = props.project.auto?.orchestration ?? DEFAULT_ORCHESTRATION
  mode.value = o.mode
  model.value = o.model
  effort.value = o.effort
  budget.value = o.budget
  orchestrators.value = o.orchestrators
  confirmOpen.value = true
}

async function confirmStart() {
  error.value = ''
  try {
    await start(props.project, { mode: mode.value, model: model.value, effort: effort.value, budget: budget.value, orchestrators: orchestrators.value })
    confirmOpen.value = false
  } catch (err: any) {
    error.value = String(err?.data?.statusMessage ?? err?.data?.message ?? err?.message ?? err)
  }
}
</script>

<template>
  <UTooltip v-if="countLabel" :text="countHint">
    <UBadge
      :color="on ? 'success' : loopCount ? 'neutral' : 'warning'"
      variant="subtle"
      size="md"
      icon="i-lucide-repeat"
      class="self-center tabular-nums"
    >
      {{ countLabel }}
    </UBadge>
  </UTooltip>
  <UTooltip :text="on ? 'jButton: auto mode is on — click to turn it off now' : 'jButton: run this project in auto loops'">
    <UButton
      icon="i-lucide-infinity"
      size="sm"
      :color="on ? 'success' : 'neutral'"
      :variant="on ? 'solid' : 'soft'"
      :loading="busy === 'start' || busy === 'off'"
      @click="onClick"
    >
      jButton
    </UButton>
  </UTooltip>

  <UModal v-model:open="confirmOpen" title="jButton: start auto mode?" :ui="{ content: 'sm:max-w-lg' }">
    <template #body>
      <div class="flex flex-col gap-4 text-sm">
        <p>
          jTicket will drive <span class="font-medium">{{ project.key }}</span> on its own, one loop after another, until
          you stop it or the project runs out of work:
        </p>
        <ol class="flex list-decimal flex-col gap-1.5 pl-5">
          <li v-if="orchestrated">
            <span class="font-medium">Implement</span> —
            <template v-if="orchestrators > 1">{{ orchestrators }} <span class="font-mono text-xs">Fable 5.2</span> orchestrators share the AFK frontier out between them, each working its share through</template>
            <template v-else>a <span class="font-mono text-xs">Fable 5.2</span> orchestrator works the AFK frontier through</template>
            <span class="font-mono text-xs">{{ modelLabel }}</span> subagents, at most {{ budget }} at a time{{ orchestrators > 1 ? ' each' : '' }}, and spec-checks each ticket against its acceptance criteria before marking it done.
          </li>
          <li v-else><span class="font-medium">Implement</span> — every AFK ticket on the frontier goes to herdr on <span class="font-mono text-xs">{{ modelLabel }}</span>.</li>
          <li><span class="font-medium">Merge</span> — once they're all done, a merge sweep on <span class="font-mono text-xs">Sonnet 5</span> lands their PRs on <span class="font-mono text-xs">{{ project.integrationBranch || 'the integration branch' }}</span>.</li>
          <li><span class="font-medium">Review</span> — two <span class="font-mono text-xs">Opus 5.5</span> reviewers read this loop's changes; a <span class="font-mono text-xs">Sonnet 5</span> session files only the findings <em>both</em> raised as tickets here.</li>
          <li>
            <span class="font-medium">Fix</span> — those tickets
            <template v-if="orchestrated">go to a fresh orchestrator the same way</template>
            <template v-else>go to herdr on <span class="font-mono text-xs">{{ modelLabel }}</span></template>, then a second merge sweep lands them.
          </li>
        </ol>
        <div class="flex flex-col gap-2">
          <URadioGroup v-model="mode" :items="modeItems" legend="How tickets are dispatched" />
          <div class="flex flex-wrap items-center gap-2">
            <USelect v-model="model" :items="modelItems" size="sm" class="w-36" :aria-label="orchestrated ? 'Subagent model' : 'Session model'" />
            <USelect v-model="effort" :items="effortItems" size="sm" class="w-36" aria-label="Effort" />
            <USelect v-if="orchestrated" v-model="orchestrators" :items="orchestratorItems" size="sm" class="w-40" aria-label="Orchestrators side by side" />
            <USelect v-if="orchestrated" v-model="budget" :items="budgetItems" size="sm" class="w-40" aria-label="Tickets in flight at once, per orchestrator" />
          </div>
        </div>
        <div class="rounded-md border border-default bg-elevated/40 px-3 py-2">
          <p>
            <span class="font-medium">{{ afkFrontier.length }}</span> AFK ticket{{ afkFrontier.length === 1 ? '' : 's' }} on the frontier now
            <template v-if="afkFrontier.length">— the first loop starts with them.</template>
            <template v-else>— the loop will wait until one appears.</template>
          </p>
          <p v-if="loopCount" class="mt-1">
            That's about <span class="font-medium">{{ loopCount }} loop{{ loopCount === 1 ? '' : 's' }}</span>
            <span class="text-muted">({{ forecast.loops.map((l) => l.length).join(' → ') }} tickets)</span> if
            each ticket finishes in its loop — review fixes ride inside their loop.
          </p>
          <p v-if="forecast.gated.length" class="mt-1 text-muted">
            {{ forecast.gated.length }} ticket{{ forecast.gated.length === 1 ? '' : 's' }} no loop reaches — HITL, paused, or waiting on one.
          </p>
          <p v-if="hitlFrontier.length" class="mt-1 text-muted">
            {{ hitlFrontier.length }} HITL or paused ticket{{ hitlFrontier.length === 1 ? ' is' : 's are' }} skipped — those stay yours to dispatch.
          </p>
        </div>
        <p class="text-muted">
          Hand dispatch of AFK tickets and the merge sweep buttons are off while it runs. The
          <span class="font-medium">Stop at the end of next loop</span> button lets the loop in progress finish first.
        </p>
        <UAlert v-if="blocker || error" color="error" variant="subtle" icon="i-lucide-triangle-alert" :description="blocker || error" />
      </div>
    </template>
    <template #footer>
      <div class="flex w-full justify-end gap-2">
        <UButton color="neutral" variant="ghost" @click="confirmOpen = false">Cancel</UButton>
        <UButton icon="i-lucide-infinity" color="success" :loading="busy === 'start'" :disabled="!!blocker" @click="confirmStart">
          Start auto mode
        </UButton>
      </div>
    </template>
  </UModal>
</template>
