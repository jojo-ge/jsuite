<script setup lang="ts">
// Every measured ticket, one row each: the phase bar on a shared scale, the
// headline durations, verification runs and cost. Sortable by the columns
// that answer "which tickets ate the time / the money".
import type { TicketRow } from '~/utils/analyticsTypes'
import { PHASE_SLOTS } from '~/utils/analyticsTypes'
import { fmtDuration, fmtUsd, fmtNum, shortModel } from '~/utils/analyticsFormat'

const props = defineProps<{ rows: TicketRow[]; showProject?: boolean }>()

type SortKey = 'pickedUpAt' | 'toClose' | 'toPr' | 'research' | 'verification' | 'cost' | 'lines'
const sortKey = ref<SortKey>('pickedUpAt')
const desc = ref(true)
function sortBy(k: SortKey) {
  if (sortKey.value === k) desc.value = !desc.value
  else {
    sortKey.value = k
    desc.value = true
  }
}
const valueOf = (r: TicketRow, k: SortKey): number | string => {
  switch (k) {
    case 'pickedUpAt': return r.pickedUpAt || r.sessionStart || ''
    case 'toClose': return r.phases.toCloseMs ?? -1
    case 'toPr': return r.phases.toPrMs ?? -1
    case 'research': return r.phases.researchMs ?? -1
    case 'verification': return r.phases.verificationMs
    case 'cost': return r.cost.usd
    case 'lines': return r.linesChanged ?? -1
  }
}
const sorted = computed(() =>
  [...props.rows].sort((a, b) => {
    const x = valueOf(a, sortKey.value)
    const y = valueOf(b, sortKey.value)
    const c = typeof x === 'string' || typeof y === 'string' ? String(x).localeCompare(String(y)) : x - y
    return desc.value ? -c : c
  }),
)
// The longest ticket span sets the bars' scale.
const scaleMs = computed(() =>
  Math.max(1, ...props.rows.map((r) => (r.phases.waitMs ?? 0) + (r.phases.researchMs ?? 0) + (r.phases.buildMs ?? 0) + (r.prOpenedAt && r.completedAt ? Math.max(0, Date.parse(r.completedAt) - Date.parse(r.prOpenedAt)) : 0) + (r.phases.tailMs ?? 0))),
)

const MODE_LABEL: Record<string, string> = { hand: 'hand', solo: 'solo', orchestrated: 'orch', batch: 'batch', none: '–' }

// Rows open the shared ticket modal (rendered once in app.vue) by key.
const { tickets } = useTracker()
const { openEditTicket } = useTrackerModals()
function open(r: TicketRow) {
  const t = tickets.value.find((x) => x.key === r.key)
  if (t) openEditTicket(t)
}

const cols: { key: SortKey | ''; label: string; cls?: string }[] = [
  { key: '', label: 'Ticket' },
  { key: '', label: 'Timeline', cls: 'w-[22%]' },
  { key: 'toClose', label: 'To close' },
  { key: 'toPr', label: 'To PR' },
  { key: 'research', label: 'Research' },
  { key: 'verification', label: 'Verifying' },
  { key: 'cost', label: 'Cost' },
  { key: 'lines', label: 'Lines' },
]
</script>

<template>
  <div>
    <div class="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-dimmed">
      <span v-for="p in PHASE_SLOTS" :key="p.key" class="inline-flex items-center gap-1.5">
        <span class="inline-block size-2 rounded-sm" :style="{ background: `var(${p.token})` }" />{{ p.label }}
      </span>
      <span class="ml-auto">Timelines share one scale: the longest ticket is {{ fmtDuration(scaleMs) }}.</span>
    </div>
    <div class="overflow-x-auto rounded-lg border border-default">
      <table class="w-full text-sm">
        <thead class="bg-elevated/60 text-left text-[11px] uppercase tracking-wide text-muted">
          <tr>
            <th v-for="c in cols" :key="c.label" :class="['px-3 py-2 font-medium', c.cls, c.key && 'cursor-pointer select-none hover:text-default']" @click="c.key && sortBy(c.key)">
              {{ c.label }}<span v-if="c.key && sortKey === c.key" class="ml-0.5">{{ desc ? '↓' : '↑' }}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in sorted" :key="r.key" class="border-t border-default/60 hover:bg-elevated/40">
            <td class="max-w-[18rem] px-3 py-2">
              <button class="block max-w-full truncate text-left hover:text-primary" :title="r.title" @click="open(r)">
                <span class="font-mono text-xs text-muted">{{ showProject ? `${r.projectKey} · ` : '' }}{{ r.key }}</span>
                <span class="ml-1.5">{{ r.title }}</span>
              </button>
              <div class="mt-0.5 flex flex-wrap gap-x-2 text-[11px] text-dimmed">
                <span>{{ MODE_LABEL[r.mode] ?? r.mode }}</span>
                <span v-if="r.model">{{ shortModel(r.model) }}<template v-if="r.effort"> · {{ r.effort }}</template></span>
                <span v-if="r.loop">loop {{ r.loop }}</span>
                <span v-if="r.mode === 'orchestrated'">{{ r.implementers }} impl · {{ r.specChecks }} spec</span>
                <span v-if="r.phases.humanWaitMs" title="Time the session sat waiting for a human turn">waited {{ fmtDuration(r.phases.humanWaitMs) }}</span>
                <span v-if="r.missing.length" class="text-warning" :title="r.missing.join(', ')">{{ r.missing.length }} transcript{{ r.missing.length === 1 ? '' : 's' }} missing</span>
                <span v-if="!r.sessionIds.length" class="text-warning">no session</span>
              </div>
            </td>
            <td class="px-3 py-2 align-middle"><AnalyticsPhaseBar :row="r" :scale-ms="scaleMs" /></td>
            <td class="px-3 py-2 tabular-nums">{{ fmtDuration(r.phases.toCloseMs) }}</td>
            <td class="px-3 py-2 tabular-nums">{{ fmtDuration(r.phases.toPrMs) }}</td>
            <td class="px-3 py-2 tabular-nums">{{ fmtDuration(r.phases.researchMs) }}</td>
            <td class="px-3 py-2 tabular-nums">
              {{ fmtDuration(r.phases.verificationMs) }}
              <span v-if="r.verification.count" class="ml-1 text-[11px] text-dimmed" :title="`${r.verification.whole} whole-suite, ${r.verification.filtered} filtered, ${r.verification.failed} failed`">
                {{ r.verification.count }}×<template v-if="r.verification.whole"> · {{ r.verification.whole }}W</template>
              </span>
            </td>
            <td class="px-3 py-2 tabular-nums" :title="r.cost.unpriced.length ? `unpriced: ${r.cost.unpriced.join(', ')}` : ''">
              {{ fmtUsd(r.cost.usd) }}<span v-if="r.cost.unpriced.length" class="text-warning">*</span>
            </td>
            <td class="px-3 py-2 tabular-nums text-muted">{{ fmtNum(r.linesChanged) }}</td>
          </tr>
          <tr v-if="!rows.length">
            <td :colspan="cols.length" class="px-3 py-6 text-center text-sm text-muted">No measured tickets yet.</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
