<script setup lang="ts">
// The trend by week, as small multiples with one axis each: median time to
// close, spend, verification time. Columns in one hue; hover for the week's
// figures. The weeks are consecutive even where nothing shipped.
import type { WeekRow } from '~/utils/analyticsTypes'
import { fmtDuration, fmtUsd } from '~/utils/analyticsFormat'

const props = defineProps<{ weeks: WeekRow[] }>()

interface Panel {
  key: string
  title: string
  value: (w: WeekRow) => number | null
  fmt: (v: number | null) => string
}
const panels: Panel[] = [
  { key: 'close', title: 'Median picked up → closed', value: (w) => w.medianToCloseMs, fmt: fmtDuration },
  { key: 'usd', title: 'Spend', value: (w) => w.usd, fmt: fmtUsd },
  { key: 'verify', title: 'Verification time', value: (w) => w.verificationMs, fmt: fmtDuration },
]

const W = 320
const H = 96
const PAD = { l: 4, r: 4, t: 14, b: 16 }
const BAR_MAX = 24

const weeks = computed(() => props.weeks)
const slot = computed(() => (W - PAD.l - PAD.r) / Math.max(1, weeks.value.length))
const barW = computed(() => Math.min(BAR_MAX, slot.value * 0.6))

function bars(p: Panel) {
  const vals = weeks.value.map((w) => p.value(w) ?? 0)
  const max = Math.max(1, ...vals)
  return weeks.value.map((w, i) => {
    const v = p.value(w)
    const h = v == null ? 0 : (v / max) * (H - PAD.t - PAD.b)
    return { w, v, x: PAD.l + i * slot.value + (slot.value - barW.value) / 2, y: H - PAD.b - h, h, max }
  })
}
const label = (week: string) => {
  const d = new Date(week)
  return Number.isFinite(d.getTime()) ? d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : week
}
const hover = ref<number | null>(null)
</script>

<template>
  <p v-if="!weeks.length" class="text-sm text-muted">No weeks with measured tickets yet.</p>
  <div v-else class="grid gap-4 md:grid-cols-3">
    <div v-for="p in panels" :key="p.key" class="min-w-0">
      <div class="mb-1 flex items-baseline justify-between text-[11px]">
        <span class="font-medium text-default">{{ p.title }}</span>
        <span v-if="hover != null && weeks[hover]" class="tabular-nums text-muted">{{ label(weeks[hover]!.week) }} · {{ p.fmt(p.value(weeks[hover]!)) }}</span>
        <span v-else class="text-dimmed">peak {{ p.fmt(bars(p)[0]?.max ?? null) }}</span>
      </div>
      <svg :viewBox="`0 0 ${W} ${H}`" class="block h-auto w-full" role="img" :aria-label="`${p.title} by week`" @mouseleave="hover = null">
        <line :x1="PAD.l" :x2="W - PAD.r" :y1="H - PAD.b" :y2="H - PAD.b" stroke="var(--jt-viz-grid)" stroke-width="1" />
        <g v-for="(b, i) in bars(p)" :key="b.w.week" @mouseenter="hover = i">
          <!-- a wide invisible hit target per week, bigger than the bar -->
          <rect :x="PAD.l + i * slot" :y="PAD.t" :width="slot" :height="H - PAD.t - PAD.b" fill="transparent" />
          <path
            v-if="b.h > 0"
            :d="`M${b.x},${H - PAD.b} V${b.y + 4} Q${b.x},${b.y} ${b.x + 4},${b.y} H${b.x + barW - 4} Q${b.x + barW},${b.y} ${b.x + barW},${b.y + 4} V${H - PAD.b} Z`"
            :fill="hover === i ? 'var(--jt-viz-1)' : 'var(--jt-viz-1-soft)'"
          />
          <circle v-else :cx="b.x + barW / 2" :cy="H - PAD.b" r="1.5" fill="var(--ui-text-dimmed)" />
        </g>
        <text :x="PAD.l" :y="H - 4" font-size="9" fill="var(--ui-text-muted)">{{ label(weeks[0]!.week) }}</text>
        <text v-if="weeks.length > 1" :x="W - PAD.r" :y="H - 4" text-anchor="end" font-size="9" fill="var(--ui-text-muted)">{{ label(weeks[weeks.length - 1]!.week) }}</text>
      </svg>
    </div>
  </div>
</template>
