<script setup lang="ts">
// Each orchestrator session as a row: what it ran, how long, its own cost
// against its subagents' (the overhead ratio), how many it kept in flight,
// and how long spec checks took to start after an implementer finished.
import type { OrchestrationRow } from '~/utils/analyticsTypes'
import { fmtDuration, fmtNum, fmtPct, fmtUsd, fmtWhen, shortModel } from '~/utils/analyticsFormat'

defineProps<{ rows: OrchestrationRow[]; showProject?: boolean }>()
</script>

<template>
  <div class="overflow-x-auto rounded-lg border border-default">
    <table class="w-full text-sm">
      <thead class="bg-elevated/60 text-left text-[11px] uppercase tracking-wide text-muted">
        <tr>
          <th class="px-3 py-2 font-medium">Orchestration</th>
          <th class="px-3 py-2 font-medium">Tickets</th>
          <th class="px-3 py-2 text-right font-medium">Duration</th>
          <th class="px-3 py-2 text-right font-medium">Own cost</th>
          <th class="px-3 py-2 text-right font-medium">Subagents</th>
          <th class="px-3 py-2 text-right font-medium">Overhead</th>
          <th class="px-3 py-2 text-right font-medium">In flight</th>
          <th class="px-3 py-2 text-right font-medium">Spec-check lag</th>
          <th class="px-3 py-2 text-right font-medium">Idle</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="o in rows" :key="o.sessionId" class="border-t border-default/60">
          <td class="px-3 py-2">
            <div>{{ showProject ? `${o.projectKey} · ` : '' }}<template v-if="o.loop">loop {{ o.loop }} · </template>orchestrator {{ o.orchestrator || 1 }}<span v-if="o.stepKind" class="text-muted"> · {{ o.stepKind }}</span></div>
            <div class="text-[11px] text-dimmed">{{ fmtWhen(o.startedAt) }} · {{ shortModel(o.model) }} · {{ o.implementers }} impl, {{ o.specChecks }} spec</div>
          </td>
          <td class="max-w-[14rem] px-3 py-2 font-mono text-xs text-muted"><span class="block truncate" :title="o.tickets.join(', ')">{{ o.tickets.join(', ') || '–' }}</span></td>
          <td class="px-3 py-2 text-right tabular-nums">{{ fmtDuration(o.durationMs) }}</td>
          <td class="px-3 py-2 text-right tabular-nums">{{ fmtUsd(o.cost.usd) }}</td>
          <td class="px-3 py-2 text-right tabular-nums">{{ fmtUsd(o.subagentCost.usd) }}</td>
          <td class="px-3 py-2 text-right tabular-nums">{{ fmtPct(o.overheadRatio) }}</td>
          <td class="px-3 py-2 text-right tabular-nums">{{ o.concurrency.max }} <span class="text-dimmed">(mean {{ fmtNum(o.concurrency.mean, 1) }})</span></td>
          <td class="px-3 py-2 text-right tabular-nums">{{ fmtDuration(o.specCheckLatencyMs) }}</td>
          <td class="px-3 py-2 text-right tabular-nums">{{ fmtDuration(o.idleMs) }}</td>
        </tr>
        <tr v-if="!rows.length">
          <td colspan="9" class="px-3 py-6 text-center text-sm text-muted">No orchestrated runs measured.</td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
