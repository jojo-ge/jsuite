<script setup lang="ts">
// Where verification time goes: wall time by category as ranked bars (one
// hue), the whole-suite vs filtered split as a thin segmented bar, and the
// commands that cost the most. Hover a bar for its count and share.
import type { VerificationProfile } from '~/utils/analyticsTypes'
import { fmtDuration, fmtNum, fmtPct } from '~/utils/analyticsFormat'

const props = defineProps<{ profile: VerificationProfile }>()

const LABEL: Record<string, string> = { test: 'Tests', e2e: 'End-to-end', lint: 'Lint', typecheck: 'Typecheck', guards: 'Guards', build: 'Build' }

const categories = computed(() => {
  const rows = Object.entries(props.profile.byCategory)
    .map(([k, v]) => ({ key: k, label: LABEL[k] ?? k, ...v }))
    .filter((r) => r.count > 0)
    .sort((a, b) => b.wallMs - a.wallMs)
  const max = Math.max(1, ...rows.map((r) => r.wallMs))
  const total = rows.reduce((a, r) => a + r.wallMs, 0) || 1
  return rows.map((r) => ({ ...r, pct: (r.wallMs / max) * 100, share: r.wallMs / total }))
})

const scope = computed(() => {
  let whole = 0
  let filtered = 0
  let count = 0
  for (const r of Object.values(props.profile.byCategory)) {
    whole += r.whole
    filtered += r.filtered
    count += r.count
  }
  const other = Math.max(0, count - whole - filtered)
  const total = count || 1
  return { whole, filtered, other, count, wholePct: (whole / total) * 100, filteredPct: (filtered / total) * 100, otherPct: (other / total) * 100 }
})

const totalMs = computed(() => Object.values(props.profile.byCategory).reduce((a, r) => a + r.wallMs, 0))
</script>

<template>
  <div class="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
    <div>
      <h3 class="text-xs font-semibold uppercase tracking-wide text-muted">Wall time by category</h3>
      <p class="mb-3 text-[11px] text-dimmed">{{ fmtDuration(totalMs) }} across {{ scope.count }} run{{ scope.count === 1 ? '' : 's' }}.</p>
      <p v-if="!categories.length" class="text-sm text-muted">No verification runs classified yet.</p>
      <ul v-else class="space-y-2">
        <li v-for="c in categories" :key="c.key">
          <UTooltip :text="`${c.label}: ${c.count} run${c.count === 1 ? '' : 's'}, ${fmtPct(c.share)} of verification time; ${c.whole} whole-suite, ${c.filtered} filtered`">
            <div class="grid grid-cols-[6.5rem_1fr_4.5rem] items-center gap-2 text-xs">
              <span class="truncate text-default">{{ c.label }}</span>
              <div class="h-4 w-full">
                <div class="h-full rounded-r-[4px]" :style="{ width: `${Math.max(0.5, c.pct)}%`, background: 'var(--jt-viz-1)' }" />
              </div>
              <span class="text-right tabular-nums text-muted">{{ fmtDuration(c.wallMs) }}</span>
            </div>
          </UTooltip>
        </li>
      </ul>

      <h3 class="mt-6 text-xs font-semibold uppercase tracking-wide text-muted">Whole suite vs filtered</h3>
      <p class="mb-2 text-[11px] text-dimmed">Whole-suite runs are the blockers; filtered runs name a file, a pattern or a test.</p>
      <div v-if="scope.count" class="flex h-2 w-full gap-px rounded-full">
        <div class="h-full rounded-l-full" :style="{ width: `${scope.wholePct}%`, background: 'var(--jt-viz-2)' }" />
        <div class="h-full" :style="{ width: `${scope.filteredPct}%`, background: 'var(--jt-viz-1)' }" />
        <div class="h-full rounded-r-full" :style="{ width: `${scope.otherPct}%`, background: 'var(--jt-phase-wait)' }" />
      </div>
      <div class="mt-1.5 flex flex-wrap gap-x-4 text-[11px] text-dimmed">
        <span><span class="mr-1 inline-block size-2 rounded-sm" style="background: var(--jt-viz-2)" />Whole {{ scope.whole }}</span>
        <span><span class="mr-1 inline-block size-2 rounded-sm" style="background: var(--jt-viz-1)" />Filtered {{ scope.filtered }}</span>
        <span v-if="scope.other"><span class="mr-1 inline-block size-2 rounded-sm" style="background: var(--jt-phase-wait)" />Single / unknown {{ scope.other }}</span>
      </div>
      <dl class="mt-4 grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
        <dt class="text-muted">Failed runs</dt><dd class="tabular-nums">{{ fmtNum(profile.failed) }}</dd>
        <dt class="text-muted">Timed out</dt><dd class="tabular-nums">{{ fmtNum(profile.timedOut) }}</dd>
        <dt class="text-muted">Same command re-run</dt><dd class="tabular-nums">{{ fmtNum(profile.repeated) }}</dd>
        <dt class="text-muted">Hidden in commits / hooks</dt><dd class="tabular-nums">{{ fmtNum(profile.hidden) }}</dd>
      </dl>
    </div>

    <div>
      <h3 class="text-xs font-semibold uppercase tracking-wide text-muted">Costliest commands</h3>
      <p class="mb-2 text-[11px] text-dimmed">By total wall time; W counts the whole-suite runs among them.</p>
      <p v-if="!profile.topCommands.length" class="text-sm text-muted">Nothing yet.</p>
      <table v-else class="w-full text-xs">
        <thead class="text-left text-[11px] uppercase tracking-wide text-muted">
          <tr><th class="py-1 pr-2 font-medium">Command</th><th class="py-1 pr-2 text-right font-medium">Runs</th><th class="py-1 pr-2 text-right font-medium">W</th><th class="py-1 text-right font-medium">Time</th></tr>
        </thead>
        <tbody>
          <tr v-for="c in profile.topCommands" :key="c.command" class="border-t border-default/60">
            <td class="max-w-0 py-1.5 pr-2"><code class="block truncate font-mono text-[11px]" :title="c.command">{{ c.command }}</code></td>
            <td class="py-1.5 pr-2 text-right tabular-nums">{{ c.count }}</td>
            <td class="py-1.5 pr-2 text-right tabular-nums" :class="c.whole ? 'text-default' : 'text-dimmed'">{{ c.whole }}</td>
            <td class="py-1.5 text-right tabular-nums">{{ fmtDuration(c.wallMs) }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
