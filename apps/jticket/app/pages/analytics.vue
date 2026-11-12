<script setup lang="ts">
// Global analytics: every project's performance rolled up — the trend by
// week, the project league table, model and mode comparisons, the codebase's
// verification profile and the machine-wide concurrency of heavy runs. Scoped
// to the selected codebase like every other page (clear it for everything),
// with an optional date range on when sessions were dispatched.
import type { BackfillResult, GlobalAnalyticsResponse } from '~/utils/analyticsTypes'
import { fmtDuration, fmtNum, fmtPct, fmtUsd, fmtWhen } from '~/utils/analyticsFormat'

useHead({ title: 'Analytics' })

const toast = useToast()
const route = useRoute()
const router = useRouter()
const { selectedPath, label, current } = useCodebase()

const from = ref(String(route.query.from ?? ''))
const to = ref(String(route.query.to ?? ''))
const allCodebases = ref(route.query.all === '1')
watch([from, to, allCodebases], () => {
  router.replace({ query: { ...route.query, from: from.value || undefined, to: to.value || undefined, all: allCodebases.value ? '1' : undefined } })
})

const query = computed(() => ({
  repo: allCodebases.value ? undefined : selectedPath.value || undefined,
  from: from.value || undefined,
  to: to.value || undefined,
  rows: '1',
}))
const { data, pending, error, refresh } = await useFetch<GlobalAnalyticsResponse>('/api/analytics', { query, lazy: true })

const backfilling = ref(false)
async function backfill() {
  backfilling.value = true
  try {
    const r = await $fetch<BackfillResult>('/api/analytics/backfill', { method: 'POST', body: {} })
    toast.add({
      title: r.added ? `Backfilled ${r.added} session${r.added === 1 ? '' : 's'}` : 'Nothing new to backfill',
      description: `${r.scanned} transcripts scanned · ${r.skipped.known} already known · ${r.skipped.unmatched} unmatched · ${r.skipped.unreadable} unreadable`,
      color: r.added ? 'success' : 'neutral',
    })
    await refresh()
  } catch (e: any) {
    toast.add({ title: 'Backfill failed', description: String(e?.data?.statusMessage ?? e?.message ?? e), color: 'error' })
  } finally {
    backfilling.value = false
  }
}

const leagueSort = ref<'tickets' | 'medianToCloseMs' | 'totalUsd' | 'verificationShare' | 'wholeRunsPerTicket'>('tickets')
const league = computed(() =>
  [...(data.value?.league ?? [])].sort((a, b) => ((b[leagueSort.value] as number | null) ?? -1) - ((a[leagueSort.value] as number | null) ?? -1)),
)
const spendByRole = computed(() => Object.entries(data.value?.spend.byRole ?? {}).sort((a, b) => b[1] - a[1]))
const spendByModel = computed(() => Object.entries(data.value?.spend.byModel ?? {}).sort((a, b) => b[1] - a[1]))
</script>

<template>
  <div class="min-h-screen bg-default">
    <UContainer class="space-y-8 py-8">
      <div class="flex flex-wrap items-end gap-3">
        <div class="mr-auto">
          <h1 class="text-2xl font-bold">Analytics</h1>
          <p class="text-sm text-muted">
            How projects perform
            <template v-if="!allCodebases && current"> in <span class="font-medium text-default">{{ label(current) }}</span></template>
            <template v-else> across every codebase</template>: close times, spend, verification and concurrency, read off the sessions' transcripts.
          </p>
        </div>
        <!-- filters: one row, above the charts -->
        <UFormField label="From" size="xs"><UInput v-model="from" type="date" size="xs" /></UFormField>
        <UFormField label="To" size="xs"><UInput v-model="to" type="date" size="xs" /></UFormField>
        <UCheckbox v-model="allCodebases" label="All codebases" size="xs" />
        <UButton size="xs" color="neutral" variant="soft" icon="i-lucide-refresh-cw" :loading="pending" @click="refresh()">Refresh</UButton>
        <UTooltip text="Scan every codebase's transcripts for sessions dispatched before the ledger existed">
          <UButton size="xs" color="neutral" variant="soft" icon="i-lucide-history" :loading="backfilling" @click="backfill">Backfill</UButton>
        </UTooltip>
      </div>

      <div v-if="error" class="rounded-md border border-error/40 bg-error/5 px-3 py-2 text-sm text-error">{{ (error.data as any)?.statusMessage ?? error.message }}</div>
      <div v-else-if="!data && pending" class="flex items-center gap-2 py-10 text-sm text-muted"><UIcon name="i-lucide-loader-2" class="animate-spin" /> Reading transcripts…</div>

      <template v-else-if="data">
        <AnalyticsStatTiles :rollup="data" />
        <p class="-mt-5 text-xs text-dimmed">
          {{ data.ledger.withTranscript }}/{{ data.ledger.sessions }} ledger sessions readable<template v-if="data.ledger.missing"> · {{ data.ledger.missing }} transcript{{ data.ledger.missing === 1 ? '' : 's' }} gone</template>
          · generated {{ fmtWhen(data.generatedAt) }}
        </p>

        <p v-if="!data.summary.tickets" class="rounded-md border border-dashed border-default px-4 py-8 text-center text-sm text-muted">
          No measured tickets in this scope. New dispatches are recorded as they happen; older sessions can be added with Backfill.
        </p>

        <section v-if="data.weekly.length">
          <h2 class="mb-3 text-sm font-semibold">By week</h2>
          <AnalyticsWeekly :weeks="data.weekly" />
        </section>

        <section v-if="data.league.length">
          <div class="mb-2 flex items-center gap-3">
            <h2 class="text-sm font-semibold">Projects</h2>
            <USelect
              v-model="leagueSort"
              size="xs"
              :items="[
                { label: 'most tickets', value: 'tickets' },
                { label: 'slowest to close', value: 'medianToCloseMs' },
                { label: 'most spend', value: 'totalUsd' },
                { label: 'most verifying', value: 'verificationShare' },
                { label: 'most whole-suite runs', value: 'wholeRunsPerTicket' },
              ]"
              class="w-48"
            />
          </div>
          <div class="overflow-x-auto rounded-lg border border-default">
            <table class="w-full text-sm">
              <thead class="bg-elevated/60 text-left text-[11px] uppercase tracking-wide text-muted">
                <tr>
                  <th class="px-3 py-2 font-medium">Project</th>
                  <th class="px-3 py-2 text-right font-medium">Tickets</th>
                  <th class="px-3 py-2 text-right font-medium">To close</th>
                  <th class="px-3 py-2 text-right font-medium">To PR</th>
                  <th class="px-3 py-2 text-right font-medium">Research</th>
                  <th class="px-3 py-2 text-right font-medium">Verifying</th>
                  <th class="px-3 py-2 text-right font-medium">Whole/t</th>
                  <th class="px-3 py-2 text-right font-medium">Fix rounds</th>
                  <th class="px-3 py-2 text-right font-medium">Overhead</th>
                  <th class="px-3 py-2 text-right font-medium">Spend</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="p in league" :key="p.projectId" class="border-t border-default/60 hover:bg-elevated/40">
                  <td class="px-3 py-2">
                    <NuxtLink :to="`/projects/${p.projectKey}?tab=analytics`" class="hover:text-primary">
                      <span class="font-mono text-xs">{{ p.projectKey }}</span>
                      <span class="ml-2 text-xs text-muted">{{ p.projectMode }}<template v-if="p.orchestrations"> · {{ p.orchestrations }} orch</template></span>
                    </NuxtLink>
                  </td>
                  <td class="px-3 py-2 text-right tabular-nums">{{ p.tickets }} <span class="text-dimmed">/ {{ p.finished }}</span></td>
                  <td class="px-3 py-2 text-right tabular-nums">{{ fmtDuration(p.medianToCloseMs) }}</td>
                  <td class="px-3 py-2 text-right tabular-nums">{{ fmtDuration(p.medianToPrMs) }}</td>
                  <td class="px-3 py-2 text-right tabular-nums">{{ fmtDuration(p.medianResearchMs) }}</td>
                  <td class="px-3 py-2 text-right tabular-nums">{{ fmtPct(p.verificationShare) }}</td>
                  <td class="px-3 py-2 text-right tabular-nums">{{ fmtNum(p.wholeRunsPerTicket, 1) }}</td>
                  <td class="px-3 py-2 text-right tabular-nums">{{ p.fixRounds }}</td>
                  <td class="px-3 py-2 text-right tabular-nums">{{ fmtPct(p.overheadRatio) }}</td>
                  <td class="px-3 py-2 text-right tabular-nums">{{ fmtUsd(p.totalUsd) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <section v-if="data.summary.tickets" class="grid gap-6 lg:grid-cols-3">
          <AnalyticsCompare :groups="data.byModel" dimension="model" title="By model" />
          <AnalyticsCompare :groups="data.byMode" dimension="mode" title="By how it ran" />
          <AnalyticsCompare :groups="data.byType" dimension="type" title="By ticket type" />
        </section>

        <section v-if="data.spend.total" class="grid gap-6 lg:grid-cols-2">
          <div>
            <h3 class="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Spend by role</h3>
            <ul class="space-y-1 text-xs">
              <li v-for="[role, usd] in spendByRole" :key="role" class="flex items-center gap-2">
                <span class="w-28 truncate">{{ role }}</span>
                <div class="h-3 flex-1"><div class="h-full rounded-r-[4px]" :style="{ width: `${(usd / data.spend.total) * 100}%`, background: 'var(--jt-viz-1)' }" /></div>
                <span class="w-16 text-right tabular-nums text-muted">{{ fmtUsd(usd) }}</span>
              </li>
            </ul>
          </div>
          <div>
            <h3 class="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Spend by model</h3>
            <ul class="space-y-1 text-xs">
              <li v-for="[model, usd] in spendByModel" :key="model" class="flex items-center gap-2">
                <span class="w-28 truncate">{{ model }}</span>
                <div class="h-3 flex-1"><div class="h-full rounded-r-[4px]" :style="{ width: `${(usd / data.spend.total) * 100}%`, background: 'var(--jt-viz-1)' }" /></div>
                <span class="w-16 text-right tabular-nums text-muted">{{ fmtUsd(usd) }}</span>
              </li>
            </ul>
          </div>
        </section>

        <section v-if="data.summary.tickets">
          <h2 class="mb-3 text-sm font-semibold">Verification</h2>
          <AnalyticsVerification :profile="data.verification" />
        </section>

        <section v-if="data.concurrency.points.length">
          <h2 class="mb-1 text-sm font-semibold">Heavy runs in flight, machine-wide</h2>
          <p class="mb-3 text-xs text-muted">Every project's whole-suite runs and anything over a minute, on one clock — side-by-side projects contend for the same cores.</p>
          <AnalyticsConcurrency :view="data.concurrency" />
        </section>

        <section v-if="data.orchestrations.length">
          <h2 class="mb-2 text-sm font-semibold">Orchestrations</h2>
          <AnalyticsOrchestrations :rows="data.orchestrations" show-project />
        </section>

        <section v-if="data.tickets?.length">
          <h2 class="mb-2 text-sm font-semibold">Every ticket</h2>
          <AnalyticsTicketTable :rows="data.tickets" show-project />
        </section>
      </template>
    </UContainer>
  </div>
</template>
