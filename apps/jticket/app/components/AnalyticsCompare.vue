<script setup lang="ts">
// Tickets grouped along one dimension (model, mode, type), each group's
// medians side by side with its median lines changed — the size proxy that
// keeps "Opus was slower" honest when Opus got the bigger tickets.
import type { CompareGroup } from '~/utils/analyticsTypes'
import { fmtDuration, fmtNum, fmtPct, fmtUsd, shortModel } from '~/utils/analyticsFormat'

defineProps<{ groups: CompareGroup[]; dimension: 'model' | 'mode' | 'type'; title: string }>()
const label = (dim: string, key: string) => (dim === 'model' && key.startsWith('claude-') ? shortModel(key) : key)
</script>

<template>
  <div>
    <h3 class="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">{{ title }}</h3>
    <p v-if="!groups.length" class="text-sm text-muted">Nothing to compare yet.</p>
    <table v-else class="w-full text-xs">
      <thead class="text-left text-[11px] uppercase tracking-wide text-muted">
        <tr>
          <th class="py-1 pr-2 font-medium">{{ dimension }}</th>
          <th class="py-1 pr-2 text-right font-medium">Tickets</th>
          <th class="py-1 pr-2 text-right font-medium">To close</th>
          <th class="py-1 pr-2 text-right font-medium">To PR</th>
          <th class="py-1 pr-2 text-right font-medium">Cost</th>
          <th class="py-1 pr-2 text-right font-medium">Verifying</th>
          <th class="py-1 pr-2 text-right font-medium">Whole/t</th>
          <th class="py-1 text-right font-medium">Lines</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="g in groups" :key="g.key" class="border-t border-default/60">
          <td class="py-1.5 pr-2">{{ label(dimension, g.key) }}</td>
          <td class="py-1.5 pr-2 text-right tabular-nums">{{ g.tickets }}</td>
          <td class="py-1.5 pr-2 text-right tabular-nums">{{ fmtDuration(g.medianToCloseMs) }}</td>
          <td class="py-1.5 pr-2 text-right tabular-nums">{{ fmtDuration(g.medianToPrMs) }}</td>
          <td class="py-1.5 pr-2 text-right tabular-nums">{{ fmtUsd(g.medianCostUsd) }}</td>
          <td class="py-1.5 pr-2 text-right tabular-nums">{{ fmtPct(g.verificationShare) }}</td>
          <td class="py-1.5 pr-2 text-right tabular-nums">{{ fmtNum(g.wholeRunsPerTicket, 1) }}</td>
          <td class="py-1.5 text-right tabular-nums text-muted">{{ fmtNum(g.medianLinesChanged) }}</td>
        </tr>
      </tbody>
    </table>
    <p class="mt-1 text-[10px] text-dimmed">Medians per group. Cost is the ticket's own sessions; verifying is the share of session time.</p>
  </div>
</template>
