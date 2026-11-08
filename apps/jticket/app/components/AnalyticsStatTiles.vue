<script setup lang="ts">
// The KPI row every analytics view leads with: a handful of headline numbers
// as stat tiles (label, value, one line of context). No chart — these are
// single values.
import type { Rollup } from '~/utils/analyticsTypes'
import { fmtDuration, fmtNum, fmtPct, fmtUsd } from '~/utils/analyticsFormat'

const props = defineProps<{ rollup: Rollup }>()

const tiles = computed(() => {
  const s = props.rollup.summary
  const sp = props.rollup.spend
  const o = props.rollup.orchestration
  return [
    { label: 'Tickets measured', value: fmtNum(s.tickets), note: `${s.finished} finished` },
    { label: 'Median picked up → closed', value: fmtDuration(s.medianToCloseMs), note: `to PR ${fmtDuration(s.medianToPrMs)}` },
    { label: 'Median research before first edit', value: fmtDuration(s.medianResearchMs), note: `median ${fmtNum(s.medianLinesChanged)} lines changed` },
    { label: 'Verification share of session time', value: fmtPct(s.verificationShare), note: `${fmtDuration(s.verificationMs)} of ${fmtDuration(s.sessionMs)}` },
    { label: 'Whole-suite runs per ticket', value: fmtNum(s.wholeRunsPerTicket, 1), note: `${s.wholeRuns} whole · ${s.filteredRuns} filtered` },
    { label: 'Total spend', value: fmtUsd(sp.total), note: `median ${fmtUsd(s.medianCostUsd)} per ticket · ${fmtUsd(sp.orchestration + sp.jobs)} overhead` },
    ...(o.count
      ? [{ label: 'Orchestrator overhead', value: fmtPct(o.medianOverheadRatio), note: `${o.count} orchestration${o.count === 1 ? '' : 's'} · ${fmtNum(o.medianConcurrencyMax)} max in flight` }]
      : []),
    ...(s.humanWaitMs ? [{ label: 'Waited on you', value: fmtDuration(s.humanWaitMs), note: `${s.fixRounds} fix round${s.fixRounds === 1 ? '' : 's'}` }] : []),
  ]
})
</script>

<template>
  <div class="grid grid-cols-2 gap-3 md:grid-cols-4">
    <div v-for="t in tiles" :key="t.label" class="rounded-lg border border-default px-3.5 py-3">
      <div class="text-[11px] text-muted">{{ t.label }}</div>
      <div class="mt-0.5 text-xl font-semibold tabular-nums text-default">{{ t.value }}</div>
      <div class="mt-0.5 truncate text-[11px] text-dimmed" :title="t.note">{{ t.note }}</div>
    </div>
  </div>
</template>
