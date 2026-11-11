<script setup lang="ts">
// The project page's Analytics tab: how long each ticket took, phase by
// phase, what its sessions cost, where verification time went and how the
// heavy runs overlapped — all read off claude's own transcripts through the
// session ledger (GET /api/projects/:id/analytics). Nothing is reported by
// agents; Backfill scans the codebase's transcripts for sessions dispatched
// before the ledger existed.
import type { Project } from '~/composables/useTracker'
import type { BackfillResult, ProjectAnalyticsResponse } from '~/utils/analyticsTypes'
import { fmtDuration, fmtUsd, fmtWhen, shortModel } from '~/utils/analyticsFormat'

const props = defineProps<{ project: Project }>()
const toast = useToast()

const { data, pending, error, refresh } = await useFetch<ProjectAnalyticsResponse>(() => `/api/projects/${props.project.id}/analytics`, {
  lazy: true,
  watch: [() => props.project.id],
})

const backfilling = ref(false)
async function backfill() {
  backfilling.value = true
  try {
    const r = await $fetch<BackfillResult>(`/api/projects/${props.project.id}/analytics/backfill`, { method: 'POST' })
    toast.add({
      title: r.added ? `Backfilled ${r.added} session${r.added === 1 ? '' : 's'}` : 'Nothing new to backfill',
      description: `${r.scanned} transcripts scanned · ${r.skipped.known} already known · ${r.skipped.unmatched} not this project's`,
      color: r.added ? 'success' : 'neutral',
    })
    await refresh()
  } catch (e: any) {
    toast.add({ title: 'Backfill failed', description: String(e?.data?.statusMessage ?? e?.message ?? e), color: 'error' })
  } finally {
    backfilling.value = false
  }
}

const ROLE_LABEL: Record<string, string> = {
  merge: 'merge sweep',
  'slice-report': 'slice report',
  'outcome-report': 'outcome report',
  'runplan-build': 'run plan build',
  'pr-assess': 'PR assessment',
  worktree: 'worktree',
  tour: 'tour build',
  other: 'other',
}
</script>

<template>
  <div class="space-y-8">
    <div class="flex flex-wrap items-center gap-3">
      <p class="text-sm text-muted">
        Measured from each session's transcript: the clock starts when a ticket is picked up and the costs are the sessions' own token usage at list price.
      </p>
      <div class="ml-auto flex items-center gap-2">
        <span v-if="data" class="text-xs text-dimmed">
          {{ data.ledger.withTranscript }}/{{ data.ledger.sessions }} sessions readable<template v-if="data.ledger.missing"> · {{ data.ledger.missing }} transcript{{ data.ledger.missing === 1 ? '' : 's' }} gone</template>
          · {{ fmtWhen(data.generatedAt) }}
        </span>
        <UButton size="xs" color="neutral" variant="soft" icon="i-lucide-refresh-cw" :loading="pending" @click="refresh()">Refresh</UButton>
        <UTooltip text="Match this codebase's older transcripts to this project's tickets and add them to the ledger">
          <UButton size="xs" color="neutral" variant="soft" icon="i-lucide-history" :loading="backfilling" @click="backfill">Backfill</UButton>
        </UTooltip>
      </div>
    </div>

    <div v-if="error" class="rounded-md border border-error/40 bg-error/5 px-3 py-2 text-sm text-error">{{ (error.data as any)?.statusMessage ?? error.message }}</div>
    <div v-else-if="!data && pending" class="flex items-center gap-2 py-10 text-sm text-muted"><UIcon name="i-lucide-loader-2" class="animate-spin" /> Reading transcripts…</div>

    <template v-else-if="data">
      <AnalyticsStatTiles :rollup="data" />

      <p v-if="!data.tickets.length" class="rounded-md border border-dashed border-default px-4 py-6 text-center text-sm text-muted">
        No ticket in this project has been picked up by a dispatched session yet. Sessions started before this release can be added with Backfill.
      </p>

      <section v-if="data.tickets.length">
        <h2 class="mb-2 text-sm font-semibold">Tickets</h2>
        <AnalyticsTicketTable :rows="data.tickets" />
      </section>

      <section v-if="data.tickets.length">
        <h2 class="mb-3 text-sm font-semibold">Verification</h2>
        <AnalyticsVerification :profile="data.verification" />
      </section>

      <section v-if="data.heavyRuns.length">
        <h2 class="mb-1 text-sm font-semibold">Heavy runs in flight</h2>
        <p class="mb-3 text-xs text-muted">Whole-suite runs and anything over a minute, across every session of this project. Overlap is where runs slow each other down.</p>
        <AnalyticsConcurrency :view="data.concurrency" />
      </section>

      <section v-if="data.orchestrations.length">
        <h2 class="mb-2 text-sm font-semibold">Orchestrations</h2>
        <AnalyticsOrchestrations :rows="data.orchestrations" />
      </section>

      <section v-if="data.jobs.length">
        <h2 class="mb-2 text-sm font-semibold">Other sessions</h2>
        <ul class="divide-y divide-default/60 overflow-hidden rounded-lg border border-default text-sm">
          <li v-for="j in data.jobs" :key="j.sessionId" class="flex flex-wrap items-center gap-x-3 px-3 py-2">
            <span class="font-medium">{{ ROLE_LABEL[j.role] ?? j.role }}</span>
            <span v-if="j.loop" class="text-muted">loop {{ j.loop }}</span>
            <span class="text-xs text-dimmed">{{ fmtWhen(j.startedAt) }} · {{ shortModel(j.model) }}</span>
            <span class="ml-auto tabular-nums text-muted">{{ fmtDuration(j.durationMs) }}</span>
            <span class="w-16 text-right tabular-nums">{{ fmtUsd(j.cost.usd) }}</span>
          </li>
        </ul>
      </section>

      <section v-if="data.tickets.length" class="grid gap-6 lg:grid-cols-2">
        <AnalyticsCompare :groups="data.byModel" dimension="model" title="By model" />
        <AnalyticsCompare :groups="data.byMode" dimension="mode" title="By how it ran" />
      </section>
    </template>
  </div>
</template>
