<script setup lang="ts">
// The jButton — auto mode's on/off switch in the project header. Turning it
// on goes through a confirmation modal (it will spend real sessions); turning
// it off is immediate and leaves any running herdr sessions alone. The big
// "Stop at the end of next loop" button lives in <AutoLoopPanel>.
import type { Project, Ticket } from '~/composables/useTracker'

const props = defineProps<{ project: Project; tickets: Ticket[]; allTickets: Ticket[] }>()
const { busy, start, turnOff } = useAutoLoop()

const on = computed(() => !!props.project.auto?.enabled)
const confirmOpen = ref(false)
const error = ref('')

const afkFrontier = computed(() =>
  props.tickets.filter((t) => isFrontier(t, props.allTickets, props.project) && !isHitl(t)),
)
const hitlFrontier = computed(() =>
  props.tickets.filter((t) => isFrontier(t, props.allTickets, props.project) && isHitl(t)),
)
// What would stop the server from saying yes — shown before the human confirms.
const blocker = computed(() => {
  const p = props.project
  if (p.mode !== 'standard') return `Auto mode drives standard projects — this is a ${p.mode} project.`
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
  confirmOpen.value = true
}

async function confirmStart() {
  error.value = ''
  try {
    await start(props.project)
    confirmOpen.value = false
  } catch (err: any) {
    error.value = String(err?.data?.statusMessage ?? err?.data?.message ?? err?.message ?? err)
  }
}
</script>

<template>
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
          <li><span class="font-medium">Implement</span> — every AFK ticket on the frontier goes to herdr on <span class="font-mono text-xs">Opus 5.5</span>.</li>
          <li><span class="font-medium">Merge</span> — once they're all done, a merge sweep on <span class="font-mono text-xs">Sonnet 5</span> lands their PRs on <span class="font-mono text-xs">{{ project.integrationBranch || 'the integration branch' }}</span>.</li>
          <li><span class="font-medium">Review</span> — two <span class="font-mono text-xs">Opus 5.5</span> reviewers in jReview read this loop's changes; a <span class="font-mono text-xs">Sonnet 5</span> session files only the findings <em>both</em> raised as tickets here.</li>
          <li><span class="font-medium">Fix</span> — those tickets go to herdr on <span class="font-mono text-xs">Opus 5.5</span>, then a second merge sweep lands them.</li>
        </ol>
        <div class="rounded-md border border-default bg-elevated/40 px-3 py-2">
          <p>
            <span class="font-medium">{{ afkFrontier.length }}</span> AFK ticket{{ afkFrontier.length === 1 ? '' : 's' }} on the frontier now
            <template v-if="afkFrontier.length">— the first loop starts with them.</template>
            <template v-else>— the loop will wait until one appears.</template>
          </p>
          <p v-if="hitlFrontier.length" class="mt-1 text-muted">
            {{ hitlFrontier.length }} HITL ticket{{ hitlFrontier.length === 1 ? ' is' : 's are' }} skipped — those stay yours to dispatch.
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
