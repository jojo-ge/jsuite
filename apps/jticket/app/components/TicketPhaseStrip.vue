<script setup lang="ts">
// A ticket's timeline as one strip — wait, research, build, to close, after
// close — read from its analytics row (GET /api/tickets/:id/sessions). Shown in
// the ticket modal once the ticket has been picked up.
import { fmtDuration, fmtUsd } from '~/utils/analyticsFormat'

const props = defineProps<{ ticketId: string; enabled: boolean }>()

interface Row {
  mode: string
  model: string
  pickedUpAt: string
  sessionStart: string
  firstEditAt: string
  prOpenedAt: string
  completedAt: string
  sessionEnd: string
  phases: { waitMs: number | null; researchMs: number | null; buildMs: number | null; verificationMs: number; toPrMs: number | null; toCloseMs: number | null; tailMs: number | null; humanWaitMs: number; sessionMs: number }
  sessions: number
  implementers: number
  specChecks: number
  verification: { count: number; whole: number; filtered: number; wallMs: number }
  cost: { usd: number; unpriced: string[] }
  missing: string[]
}

const { data, pending } = await useFetch<{ row: Row | null }>(() => `/api/tickets/${props.ticketId}/sessions`, {
  immediate: props.enabled,
  watch: [() => props.ticketId],
  lazy: true,
})
const row = computed(() => data.value?.row ?? null)

// Phase colours: the same fixed order the Analytics tab uses (phase palette in
// analyticsFormat's consumers) — identity by position, never cycled.
const PHASES = [
  { key: 'wait', label: 'Wait', cls: 'bg-[var(--jt-phase-wait)]' },
  { key: 'research', label: 'Research', cls: 'bg-[var(--jt-phase-research)]' },
  { key: 'build', label: 'Build', cls: 'bg-[var(--jt-phase-build)]' },
  { key: 'close', label: 'PR → closed', cls: 'bg-[var(--jt-phase-close)]' },
  { key: 'tail', label: 'After close', cls: 'bg-[var(--jt-phase-tail)]' },
] as const

const segments = computed(() => {
  const r = row.value
  if (!r) return []
  const ms: Record<string, number> = {
    wait: r.phases.waitMs ?? 0,
    research: r.phases.researchMs ?? 0,
    build: r.phases.buildMs ?? 0,
    close: r.prOpenedAt && r.completedAt ? Math.max(0, Date.parse(r.completedAt) - Date.parse(r.prOpenedAt)) : 0,
    tail: r.phases.tailMs ?? 0,
  }
  const parts = PHASES.map((p) => ({ ...p, ms: ms[p.key]! })).filter((p) => p.ms > 0)
  const total = parts.reduce((a, p) => a + p.ms, 0) || 1
  return parts.map((p) => ({ ...p, pct: (p.ms / total) * 100 }))
})
</script>

<template>
  <div v-if="enabled && (pending || row)" class="jt-phases rounded-lg border border-default px-3 py-2.5">
    <div class="mb-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
      <span class="font-medium text-default"><UIcon name="i-lucide-timer" class="mr-1 inline size-3.5 align-[-2px]" />Timeline</span>
      <template v-if="row">
        <span>picked up → closed <b class="text-default">{{ fmtDuration(row.phases.toCloseMs) }}</b></span>
        <span>to PR <b class="text-default">{{ fmtDuration(row.phases.toPrMs) }}</b></span>
        <span>
          verification <b class="text-default">{{ fmtDuration(row.phases.verificationMs) }}</b> in {{ row.verification.count }} run{{ row.verification.count === 1 ? '' : 's' }}<template v-if="row.verification.whole"> ({{ row.verification.whole }} whole-suite)</template>
        </span>
        <span>cost <b class="text-default">{{ fmtUsd(row.cost.usd) }}</b></span>
        <span v-if="row.phases.humanWaitMs">waited on you {{ fmtDuration(row.phases.humanWaitMs) }}</span>
        <span v-if="row.mode === 'orchestrated'">{{ row.implementers }} implementer{{ row.implementers === 1 ? '' : 's' }}, {{ row.specChecks }} spec check{{ row.specChecks === 1 ? '' : 's' }}</span>
        <span v-if="row.missing.length" class="text-warning">{{ row.missing.length }} session transcript{{ row.missing.length === 1 ? '' : 's' }} not found</span>
      </template>
      <span v-else>Reading sessions…</span>
    </div>
    <div v-if="segments.length" class="flex h-2.5 w-full gap-px overflow-hidden rounded-full bg-elevated">
      <UTooltip v-for="s in segments" :key="s.key" :text="`${s.label}: ${fmtDuration(s.ms)}`" :style="{ width: `${s.pct}%` }">
        <div :class="['h-full w-full', s.cls]" />
      </UTooltip>
    </div>
    <div v-if="segments.length" class="mt-1 flex flex-wrap gap-x-3 text-[10px] text-dimmed">
      <span v-for="s in segments" :key="s.key"><span :class="['mr-1 inline-block size-2 rounded-sm align-middle', s.cls]" />{{ s.label }} {{ fmtDuration(s.ms) }}</span>
    </div>
  </div>
</template>
