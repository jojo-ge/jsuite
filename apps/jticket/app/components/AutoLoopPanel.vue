<script setup lang="ts">
// Auto mode's dashboard, above the board while the jButton is on: which loop,
// which phase, what it's waiting on, why it paused — and the big "Stop at the
// end of next loop" button. When auto mode is off it shows only how the last
// run ended (if there was one). Everything reads project.auto, which the
// server's loop keeps current; nothing here advances the loop.
import type { LocalPr, Project, Ticket } from '~/composables/useTracker'
import { AUTO_PHASES, autoPending, type AutoLoop } from '~/utils/autoLoop'

const props = defineProps<{ project: Project; tickets: Ticket[] }>()
const { prs } = useTracker()
const { busy, requestStop, retry, turnOff } = useAutoLoop()

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

const phaseIndex = computed(() => AUTO_PHASES.findIndex((p) => p.phase === auto.value?.phase))

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
  }
  return ''
})

const ticketDone = (t: Ticket) => t.status === 'done' || t.status === 'merged'
const prDone = (p: LocalPr) => p.status === 'merged' || p.status === 'closed'

const endedText = computed(() => {
  const e = auto.value?.ended
  if (!e) return ''
  const when = new Date(e.at).toLocaleString()
  if (e.reason === 'complete') return `Auto mode finished — no open work left (${when}).`
  if (e.reason === 'stopped') return `Auto mode stopped at the end of a loop, as asked (${when}).`
  return `Auto mode was turned off (${when}).`
})

async function turnOffNow() {
  if (!window.confirm('Turn auto mode off now, mid-loop? Sessions already running in herdr carry on; the loop stops driving them.')) return
  await turnOff(props.project).catch(() => {})
}
</script>

<template>
  <section v-if="on && auto" class="mb-8 rounded-lg border border-success/40 bg-success/5 p-4">
    <div class="mb-3 flex flex-wrap items-center gap-2">
      <UIcon name="i-lucide-infinity" class="size-5 text-success" />
      <h2 class="font-semibold">Auto mode · loop {{ auto.loop }}</h2>
      <UBadge v-if="auto.paused" color="warning" variant="subtle" size="sm">
        {{ auto.paused.reason === 'waiting-human' ? 'waiting on you' : 'paused' }}
      </UBadge>
      <span v-if="auto.phase !== 'idle'" class="text-xs text-muted">phase running {{ since(auto.phaseStartedAt) }}</span>
      <UButton
        class="ml-auto"
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

    <!-- The phase stepper -->
    <ol class="mb-3 flex flex-wrap items-center gap-1 text-xs">
      <template v-for="(p, i) in AUTO_PHASES" :key="p.phase">
        <li
          class="rounded-full px-2.5 py-1"
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
        <UIcon v-if="i < AUTO_PHASES.length - 1" name="i-lucide-chevron-right" class="size-3 text-dimmed" />
      </template>
    </ol>

    <p class="mb-2 text-sm">{{ phaseText }}</p>

    <!-- What the phase is waiting on -->
    <div v-if="pending.tickets.length || pending.prs.length" class="mb-3 flex flex-wrap gap-1.5">
      <NuxtLink
        v-for="t in pending.tickets"
        :key="t.key"
        :to="`/tickets/${t.key}`"
        class="inline-flex items-center gap-1 rounded-md border border-default px-2 py-0.5 text-xs hover:bg-elevated"
        :class="ticketDone(t) && 'opacity-60'"
      >
        <UIcon
          :name="ticketDone(t) ? 'i-lucide-circle-check' : t.status === 'in_progress' ? 'i-lucide-loader-circle' : 'i-lucide-circle-dashed'"
          :class="[ticketDone(t) ? 'text-success' : 'text-muted', t.status === 'in_progress' && 'animate-spin']"
          class="size-3.5"
        />
        <span class="font-mono">{{ t.key }}</span>
        <span class="max-w-48 truncate text-muted">{{ t.title }}</span>
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
    </div>

    <p v-if="auto.reviewKey" class="mb-3 text-xs">
      <a :href="`https://jreview.local/r/${auto.reviewKey}`" target="_blank" class="text-primary hover:underline">
        This loop's review in jReview ↗
      </a>
    </p>

    <!-- A pause, and the way out of it -->
    <UAlert
      v-if="auto.paused"
      class="mb-3"
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

    <!-- The big one -->
    <UButton
      v-if="!auto.stopRequested"
      block
      size="xl"
      color="warning"
      icon="i-lucide-octagon-pause"
      :loading="busy === 'stop'"
      @click="requestStop(project, true).catch(() => {})"
    >
      Stop at the end of next loop
    </UButton>
    <div v-else class="flex items-center gap-3 rounded-md border border-warning/40 bg-warning/10 px-4 py-3">
      <UIcon name="i-lucide-octagon-pause" class="size-5 text-warning" />
      <span class="text-sm font-medium">Stopping after loop {{ auto.loop }} — auto mode turns off once its fixes are merged.</span>
      <UButton class="ml-auto" size="sm" color="neutral" variant="soft" :loading="busy === 'stop'" @click="requestStop(project, false).catch(() => {})">
        Keep going
      </UButton>
    </div>

    <!-- Finished loops -->
    <details v-if="auto.history.length" class="mt-3 text-xs">
      <summary class="cursor-pointer text-muted">{{ auto.history.length }} finished loop{{ auto.history.length === 1 ? '' : 's' }}</summary>
      <ul class="mt-2 flex flex-col gap-1">
        <li v-for="h in [...auto.history].reverse()" :key="`${h.loop}-${h.endedAt}`" class="flex flex-wrap gap-x-2">
          <span class="font-medium">Loop {{ h.loop }}</span>
          <span class="text-muted">{{ h.tickets.length }} ticket{{ h.tickets.length === 1 ? '' : 's' }}, {{ h.fixTickets.length }} fix{{ h.fixTickets.length === 1 ? '' : 'es' }}</span>
          <a v-if="h.reviewKey" :href="`https://jreview.local/r/${h.reviewKey}`" target="_blank" class="text-primary hover:underline">review ↗</a>
          <span class="text-dimmed">{{ new Date(h.endedAt).toLocaleString() }}</span>
        </li>
      </ul>
    </details>
  </section>

  <p v-else-if="endedText" class="mb-6 flex items-center gap-2 text-xs text-muted">
    <UIcon name="i-lucide-infinity" class="size-4" />
    {{ endedText }}
  </p>
</template>
