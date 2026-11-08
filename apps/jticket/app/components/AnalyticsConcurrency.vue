<script setup lang="ts">
// How many heavy verification runs were in flight at once, over time — a
// step area for every run (soft) with the whole-suite runs on top (strong),
// drawn as inline SVG. Hover for the bucket's counts. Underneath: the
// inflation figure — how much longer a run takes when it overlaps another.
import type { ConcurrencyView } from '~/utils/analyticsTypes'
import { fmtDuration, fmtPct, fmtWhen } from '~/utils/analyticsFormat'

const props = defineProps<{ view: ConcurrencyView }>()

const W = 720
const H = 140
const PAD = { l: 28, r: 8, t: 8, b: 20 }

const pts = computed(() => props.view.points)
const peak = computed(() => Math.max(1, props.view.peak))
const x = (i: number) => PAD.l + (pts.value.length > 1 ? (i / (pts.value.length - 1)) * (W - PAD.l - PAD.r) : 0)
const y = (v: number) => PAD.t + (1 - v / peak.value) * (H - PAD.t - PAD.b)

/** A step path along the buckets (each bucket holds its value until the next). */
function stepPath(get: (p: { running: number; whole: number }) => number, closed: boolean) {
  const p = pts.value
  if (!p.length) return ''
  const half = p.length > 1 ? (x(1) - x(0)) / 2 : 4
  let d = `M${(x(0) - half).toFixed(1)},${y(get(p[0]!)).toFixed(1)}`
  for (let i = 0; i < p.length; i++) {
    const yi = y(get(p[i]!)).toFixed(1)
    d += ` H${(x(i) + half).toFixed(1)}`
    if (i + 1 < p.length) d += ` V${y(get(p[i + 1]!)).toFixed(1)}`
    void yi
  }
  if (closed) d += ` V${y(0).toFixed(1)} H${(x(0) - half).toFixed(1)} Z`
  return d
}
const runningArea = computed(() => stepPath((p) => p.running, true))
const wholeArea = computed(() => stepPath((p) => p.whole, true))
const runningLine = computed(() => stepPath((p) => p.running, false))

const yTicks = computed(() => {
  const n = peak.value
  const step = n <= 4 ? 1 : Math.ceil(n / 4)
  const out: number[] = []
  for (let v = 0; v <= n; v += step) out.push(v)
  return out
})
const xLabels = computed(() => {
  const p = pts.value
  if (!p.length) return []
  const idx = p.length > 1 ? [0, Math.floor((p.length - 1) / 2), p.length - 1] : [0]
  return [...new Set(idx)].map((i) => ({ i, label: fmtWhen(p[i]!.at) }))
})

// Hover: nearest bucket.
const hover = ref<number | null>(null)
const svg = ref<SVGSVGElement | null>(null)
function onMove(e: MouseEvent) {
  if (!svg.value || !pts.value.length) return
  const rect = svg.value.getBoundingClientRect()
  const px = ((e.clientX - rect.left) / rect.width) * W
  const n = pts.value.length
  const i = n > 1 ? Math.round(((px - PAD.l) / (W - PAD.l - PAD.r)) * (n - 1)) : 0
  hover.value = Math.min(n - 1, Math.max(0, i))
}
const hovered = computed(() => (hover.value == null ? null : pts.value[hover.value] ?? null))
</script>

<template>
  <div>
    <p v-if="!pts.length" class="text-sm text-muted">No heavy runs recorded (runs over a minute, or whole-suite runs).</p>
    <template v-else>
      <div class="mb-1 flex flex-wrap items-center gap-x-4 text-[11px] text-dimmed">
        <span><span class="mr-1 inline-block size-2 rounded-sm" style="background: var(--jt-viz-1-soft)" />Heavy runs in flight</span>
        <span><span class="mr-1 inline-block size-2 rounded-sm" style="background: var(--jt-viz-1)" />of which whole-suite</span>
        <span class="ml-auto">{{ fmtDuration(view.bucketMs) }} buckets · peak {{ view.peak }}</span>
      </div>
      <div class="relative">
        <svg ref="svg" :viewBox="`0 0 ${W} ${H}`" class="block h-auto w-full" role="img" aria-label="Heavy verification runs in flight over time" @mousemove="onMove" @mouseleave="hover = null">
          <g v-for="t in yTicks" :key="t">
            <line :x1="PAD.l" :x2="W - PAD.r" :y1="y(t)" :y2="y(t)" stroke="var(--jt-viz-grid)" stroke-width="1" />
            <text :x="PAD.l - 6" :y="y(t) + 3" text-anchor="end" font-size="9" fill="var(--ui-text-muted)">{{ t }}</text>
          </g>
          <path :d="runningArea" fill="var(--jt-viz-1-soft)" opacity="0.55" />
          <path :d="wholeArea" fill="var(--jt-viz-1)" opacity="0.85" />
          <path :d="runningLine" fill="none" stroke="var(--jt-viz-1)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" />
          <text v-for="l in xLabels" :key="l.i" :x="x(l.i)" :y="H - 6" :text-anchor="l.i === 0 ? 'start' : l.i === pts.length - 1 ? 'end' : 'middle'" font-size="9" fill="var(--ui-text-muted)">{{ l.label }}</text>
          <line v-if="hover != null" :x1="x(hover)" :x2="x(hover)" :y1="PAD.t" :y2="H - PAD.b" stroke="var(--ui-text-dimmed)" stroke-width="1" />
        </svg>
        <div v-if="hovered" class="pointer-events-none absolute right-2 top-1 rounded-md border border-default bg-default px-2 py-1 text-[11px] shadow-sm">
          <div class="text-muted">{{ fmtWhen(hovered.at) }}</div>
          <div class="tabular-nums">{{ hovered.running }} in flight · {{ hovered.whole }} whole-suite</div>
        </div>
      </div>
      <dl class="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-4">
        <dt class="text-muted">Median run, alone</dt><dd class="tabular-nums">{{ fmtDuration(view.inflation.aloneMs) }} <span class="text-dimmed">({{ view.inflation.alone }})</span></dd>
        <dt class="text-muted">Median run, overlapped</dt><dd class="tabular-nums">{{ fmtDuration(view.inflation.overlappedMs) }} <span class="text-dimmed">({{ view.inflation.overlapped }})</span></dd>
        <dt class="text-muted">Run time spent overlapping</dt><dd class="tabular-nums">{{ fmtPct(view.overlapShare) }}</dd>
        <dt class="text-muted">Peak in flight</dt><dd class="tabular-nums">{{ view.peak }}</dd>
      </dl>
    </template>
  </div>
</template>
