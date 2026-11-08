<script setup lang="ts">
// The run plan as a horizontal pipeline (utils/runPlanGraph.ts lays it out):
// a spine of step nodes from Start to End, ticket cards stacked under each
// implement step in orchestrator / own-agent boxes, review arcs above the
// spine showing what each review reads, blocker arrows between cards, and
// slice-report markers on the spine. An own-agent box past its free sessions
// draws a queue line: the cards below it start as sessions free, and each
// wears its place in the queue. Started, each node wears its state and
// what it did. Clicking a node opens the step's modal (when editable);
// clicking a card opens the ticket.
import type { PlanStepRecord } from '~/utils/autoLoop'
import type { PlanDispatch, RunPlan } from '~/utils/runPlan'
import { GRAPH, layoutRunPlan, type GraphTicketInfo } from '~/utils/runPlanGraph'

export interface GraphStepState {
  label: string
  color: 'success' | 'info' | 'neutral' | 'warning'
}

const props = defineProps<{
  plan: RunPlan
  /** Every ticket the plan or a blocker can name. */
  info: Record<string, GraphTicketInfo>
  runDefault: PlanDispatch
  /** Per step: its running state, or null when the plan isn't running / the step hasn't been reached. */
  states: Array<GraphStepState | null>
  /** Per step: what it did, once it ran. */
  records: Array<PlanStepRecord | undefined>
  /** Per step: the slice report its agents read (DOC-n), when known. */
  sliceDocs: string[]
  editable: boolean
}>()
const emit = defineEmits<{ edit: [index: number]; open: [key: string] }>()

const layout = computed(() => layoutRunPlan(props.plan, props.info, props.runDefault))

// Blocker edges: a long plan has dozens, so by default only the wrong-order
// ones draw; hovering a card shows what it waits on and what waits on it.
// "All" draws every one.
const allDeps = ref(false)
const hover = ref<string | null>(null)
const showBlocker = (b: { from: string; to: string; ok: boolean }) => !b.ok || allDeps.value || hover.value === b.from || hover.value === b.to
const hot = (b: { from: string; to: string }) => hover.value === b.from || hover.value === b.to

// Each kind has a colour; the node's accent, icon and box tint follow it.
const KIND = {
  implement: { icon: 'i-lucide-hammer', label: 'Implement', accent: 'bg-primary', text: 'text-primary', soft: 'bg-primary/10' },
  merge: { icon: 'i-lucide-git-merge', label: 'Merge', accent: 'bg-neutral-500', text: 'text-neutral-500', soft: 'bg-neutral-500/10' },
  review: { icon: 'i-lucide-scan-eye', label: 'Review', accent: 'bg-violet-500', text: 'text-violet-500', soft: 'bg-violet-500/10' },
  gate: { icon: 'i-lucide-hand', label: 'Gate', accent: 'bg-amber-500', text: 'text-amber-500', soft: 'bg-amber-500/10' },
} as const

const nodeRing = (i: number) => {
  const st = props.states[i]
  if (!st) return 'border-default'
  if (st.color === 'info') return 'border-info ring-4 ring-info/20'
  if (st.color === 'success') return 'border-success/60'
  if (st.color === 'warning') return 'border-warning ring-4 ring-warning/20'
  return 'border-default opacity-60'
}
const stateDot = (i: number) => {
  const st = props.states[i]
  if (!st) return ''
  return { success: 'bg-success', info: 'bg-info animate-pulse', warning: 'bg-warning', neutral: 'bg-neutral-400' }[st.color]
}

// Edge paths.
const flowD = (f: { x1: number; x2: number; y: number }) => `M ${f.x1} ${f.y} L ${f.x2 - 6} ${f.y}`
// A review arc: up from the checkpoint, flat along its lane, down into the review node.
const arcD = (a: { fromX: number; toX: number; laneY: number; nodeTop: number }) => {
  const r = Math.min(18, (a.toX - a.fromX) / 2)
  return `M ${a.fromX} ${a.nodeTop} V ${a.laneY + r} Q ${a.fromX} ${a.laneY} ${a.fromX + r} ${a.laneY} H ${a.toX - r} Q ${a.toX} ${a.laneY} ${a.toX} ${a.laneY + r} V ${a.nodeTop - 6}`
}
const blockerD = (b: { x1: number; y1: number; x2: number; y2: number }) => {
  const horizontal = Math.abs(b.x2 - b.x1) > Math.abs(b.y2 - b.y1)
  const dx = Math.max(28, (b.x2 - b.x1) / 2)
  const dy = Math.max(20, (b.y2 - b.y1) / 2)
  return horizontal ? `M ${b.x1} ${b.y1} C ${b.x1 + dx} ${b.y1}, ${b.x2 - dx} ${b.y2}, ${b.x2 - 6} ${b.y2}` : `M ${b.x1} ${b.y1} C ${b.x1} ${b.y1 + dy}, ${b.x2} ${b.y2 - dy}, ${b.x2} ${b.y2 - 6}`
}
const px = (n: number) => `${n}px`
</script>

<template>
  <div class="overflow-x-auto rounded-xl border border-default bg-gradient-to-b from-elevated/40 to-default">
    <div class="relative" :style="{ width: px(layout.width), height: px(layout.height), minWidth: '100%' }">
      <svg class="pointer-events-none absolute inset-0 overflow-visible" :width="layout.width" :height="layout.height">
        <defs>
          <marker id="rpg-flow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="8" markerHeight="8" orient="auto">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor" />
          </marker>
          <marker id="rpg-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor" />
          </marker>
        </defs>
        <!-- the spine -->
        <g class="text-muted/50">
          <path v-for="f in layout.flows" :key="`f${f.to}`" :d="flowD(f)" fill="none" stroke="currentColor" stroke-width="2" marker-end="url(#rpg-flow)" />
        </g>
        <!-- what each review reads -->
        <g v-for="a in layout.reviews" :key="`r${a.stepIndex}`" class="text-violet-500/70">
          <path :d="arcD(a)" fill="none" stroke="currentColor" stroke-width="1.75" stroke-dasharray="5 4" marker-end="url(#rpg-arrow)" />
          <circle :cx="a.fromX" :cy="a.nodeTop" r="3.5" fill="currentColor" />
        </g>
        <!-- who waits on whom -->
        <path
          v-for="b in layout.blockers.filter(showBlocker)"
          :key="`b${b.from}>${b.to}`"
          :d="blockerD(b)"
          fill="none"
          stroke="currentColor"
          :stroke-width="hot(b) ? 2.5 : 1.75"
          :class="b.ok ? (hot(b) ? 'text-amber-500' : 'text-amber-500/60') : 'text-error'"
          marker-end="url(#rpg-arrow)"
        />
      </svg>

      <!-- review arc labels, on the flat of each arc -->
      <span
        v-for="a in layout.reviews"
        :key="`rl${a.stepIndex}`"
        class="absolute -translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded-full border border-violet-500/30 bg-default px-2 py-0.5 text-[10.5px] text-violet-500"
        :style="{ left: px((a.fromX + a.toX) / 2), top: px(a.laneY) }"
      >
        <UIcon name="i-lucide-scan-eye" class="mr-0.5 inline size-3 align-[-2px]" />{{ a.label }}
      </span>

      <!-- Start -->
      <div class="absolute flex items-center justify-center gap-1.5 rounded-full border border-default bg-default text-xs font-medium shadow-sm" :style="{ left: px(layout.start.x), top: px(layout.start.y), width: px(layout.start.w), height: px(layout.start.h) }" title="The integration branch tip when the plan starts — the first review's checkpoint">
        <UIcon name="i-lucide-flag" class="size-4 text-success" /> Start
      </div>

      <!-- slice-report markers on the spine -->
      <template v-for="f in layout.flows" :key="`s${f.to}`">
        <component
          :is="sliceDocs[f.to] ? 'NuxtLink' : 'span'"
          v-if="f.slice"
          :to="sliceDocs[f.to] ? `/docs/${sliceDocs[f.to]}` : undefined"
          class="absolute flex -translate-x-1/2 -translate-y-1/2 items-center gap-1 rounded-full border border-default bg-default px-1.5 py-0.5 text-[10px] text-muted shadow-sm"
          :class="sliceDocs[f.to] && 'hover:border-primary hover:text-primary'"
          :style="{ left: px((f.x1 + f.x2) / 2), top: px(f.y) }"
          :title="`A facts-only slice report is written here (Opus 5.5 medium) and every agent in the next step reads it first${sliceDocs[f.to] ? ` — ${sliceDocs[f.to]}` : ''}`"
        >
          <UIcon name="i-lucide-file-text" class="size-3" />{{ sliceDocs[f.to] ? sliceDocs[f.to] : 'slice' }}
        </component>
      </template>

      <!-- step nodes: merges are a compact pill on the spine; the rest a card -->
      <div
        v-for="n in layout.nodes"
        :key="n.id"
        class="absolute flex overflow-hidden border bg-default shadow-sm transition"
        :class="[n.kind === 'merge' ? 'items-center justify-center rounded-full' : 'rounded-lg', nodeRing(n.index), editable && 'cursor-pointer hover:border-primary hover:shadow-md']"
        :style="{ left: px(n.x), top: px(n.y), width: px(n.w), height: px(n.h) }"
        :role="editable ? 'button' : undefined"
        :title="`Step ${n.index + 1} · ${KIND[n.kind].label} — ${n.summary}`"
        @click="editable && emit('edit', n.index)"
      >
        <template v-if="n.kind === 'merge'">
          <span class="flex size-8 items-center justify-center rounded-full" :class="KIND.merge.soft"><UIcon :name="KIND.merge.icon" class="size-4" :class="KIND.merge.text" /></span>
          <span v-if="stateDot(n.index)" class="absolute right-1.5 top-1.5 size-2 rounded-full" :class="stateDot(n.index)" />
        </template>
        <div v-if="n.kind !== 'merge'" class="w-1.5 shrink-0" :class="KIND[n.kind].accent" />
        <div v-if="n.kind !== 'merge'" class="flex min-w-0 flex-1 flex-col justify-center gap-0.5 px-2.5">
          <div class="flex items-center gap-1.5 text-sm">
            <span class="text-[11px] tabular-nums text-dimmed">{{ n.index + 1 }}</span>
            <UIcon :name="KIND[n.kind].icon" class="size-4" :class="KIND[n.kind].text" />
            <span class="font-semibold">{{ KIND[n.kind].label }}</span>
            <span v-if="stateDot(n.index)" class="ml-auto size-2 rounded-full" :class="stateDot(n.index)" :title="states[n.index]!.label" />
          </div>
          <p class="truncate text-[11px] text-muted">{{ n.summary }}</p>
          <div v-if="records[n.index] && !records[n.index]!.skipped && (records[n.index]!.reviewKey || records[n.index]!.archReviewKey || records[n.index]!.fixTickets.length)" class="flex items-center gap-2 text-[10px]">
            <a v-if="records[n.index]!.archReviewKey" :href="`https://jreview.local/r/${records[n.index]!.archReviewKey}`" target="_blank" class="text-primary hover:underline" @click.stop>arch ↗</a>
            <a v-if="records[n.index]!.reviewKey" :href="`https://jreview.local/r/${records[n.index]!.reviewKey}`" target="_blank" class="text-primary hover:underline" @click.stop>review ↗</a>
            <span v-if="records[n.index]!.fixTickets.length" class="text-muted">{{ records[n.index]!.fixTickets.length }} fixed</span>
          </div>
        </div>
      </div>
      <!-- state label under a node that has one -->
      <span
        v-for="n in layout.nodes.filter((n) => states[n.index])"
        :key="`st${n.id}`"
        class="absolute -translate-x-1/2 rounded-full px-2 py-px text-[10px] font-medium"
        :class="{ 'bg-success/15 text-success': states[n.index]!.color === 'success', 'bg-info/15 text-info': states[n.index]!.color === 'info', 'bg-warning/15 text-warning': states[n.index]!.color === 'warning', 'bg-elevated text-muted': states[n.index]!.color === 'neutral' }"
        :style="{ left: px(n.x + n.w / 2), top: px(n.y + n.h + 3) }"
      >
        {{ states[n.index]!.label }}
      </span>

      <!-- boxes under implement nodes: an orchestrator's group, or the own agents -->
      <div
        v-for="b in layout.boxes"
        :key="`g${b.step}-${b.group}`"
        class="absolute rounded-lg border"
        :class="b.group === null ? 'border-default bg-elevated/50' : 'border-primary/30 bg-primary/5'"
        :style="{ left: px(b.x), top: px(b.y), width: px(b.w), height: px(b.h) }"
      >
        <div class="flex items-center gap-1.5 truncate px-2 text-[11px] font-medium" :class="b.group === null ? 'text-muted' : 'text-primary'" :style="{ height: px(GRAPH.boxHead) }">
          <UIcon :name="b.group === null ? 'i-lucide-user-round' : 'i-lucide-bot'" class="size-3.5 shrink-0" />
          <span class="truncate">{{ b.label }}</span>
        </div>
      </div>
      <!-- the queue line in an own-agent box: above it starts at once, below it waits for a session -->
      <template v-for="b in layout.boxes.filter((b) => b.queueY !== null)" :key="`q${b.step}`">
        <div class="absolute border-t border-dashed border-amber-500/70" :style="{ left: px(b.x + GRAPH.boxPad), top: px(b.queueY!), width: px(b.w - GRAPH.boxPad * 2) }" />
        <span class="absolute -translate-y-1/2 rounded-full border border-amber-500/40 bg-default px-1.5 text-[9.5px] font-medium text-amber-600" :style="{ left: px(b.x + GRAPH.boxPad + 6), top: px(b.queueY!) }" title="The step's own-agent tickets run in this order; these start as sessions above them finish">queue ↓</span>
      </template>

      <!-- ticket cards -->
      <button
        v-for="t in layout.tickets"
        :key="`t${t.key}`"
        type="button"
        class="absolute flex flex-col overflow-hidden rounded-md border bg-default px-2 py-1.5 text-left shadow-sm transition hover:border-primary hover:shadow"
        :class="[t.unknown ? 'border-error/60' : t.hitl || t.paused ? 'border-warning/60' : 'border-default', t.finished && 'opacity-55', t.queued && !t.finished && 'border-dashed bg-elevated/40']"
        :style="{ left: px(t.x), top: px(t.y), width: px(t.w), height: px(t.h) }"
        :title="`${t.key} — ${t.title}\n${t.group === null ? `own agent · ${t.order} in the queue${t.queued ? ' (starts as a session frees)' : ''}` : `orchestrator ${t.group + 1}`} · ${t.runner}`"
        @click.stop="emit('open', t.key)"
        @mouseenter="hover = t.key"
        @mouseleave="hover = null"
      >
        <div class="flex items-center gap-1 text-[10.5px]">
          <span v-if="t.order !== null" class="rounded px-1 text-[9.5px] tabular-nums" :class="t.queued ? 'bg-amber-500/15 text-amber-600' : 'bg-elevated text-dimmed'">{{ t.order }}</span>
          <span class="font-mono text-muted">{{ t.key }}</span>
          <UIcon v-if="t.finished" name="i-lucide-circle-check" class="size-3 text-success" />
          <span v-if="t.hitl" class="ml-auto rounded bg-warning/15 px-1 text-[9.5px] font-medium text-warning">HITL</span>
          <span v-else-if="t.paused" class="ml-auto rounded bg-warning/15 px-1 text-[9.5px] font-medium text-warning">paused</span>
          <span v-else-if="t.unknown" class="ml-auto rounded bg-error/15 px-1 text-[9.5px] font-medium text-error">unknown</span>
        </div>
        <p class="truncate text-xs font-medium leading-snug">{{ t.title }}</p>
        <p class="mt-auto truncate text-[10px] text-dimmed">{{ t.runner }}</p>
      </button>

      <!-- End -->
      <div class="absolute flex items-center justify-center gap-1.5 rounded-full border border-dashed border-default bg-default text-xs font-medium text-muted" :style="{ left: px(layout.end.x), top: px(layout.end.y), width: px(layout.end.w), height: px(layout.end.h) }" title="Auto turns off; with no ticket left open, the outcome report is written first">
        <UIcon name="i-lucide-flag-triangle-right" class="size-4 text-success" /> Plan ends
      </div>
    </div>

    <!-- legend -->
    <div class="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-default px-3 py-1.5 text-[10.5px] text-muted">
      <span class="flex items-center gap-1.5"><span class="inline-block size-2 rounded-sm bg-primary" /> implement</span>
      <span class="flex items-center gap-1.5"><span class="inline-block size-2 rounded-sm bg-neutral-500" /> merge</span>
      <span class="flex items-center gap-1.5"><span class="inline-block size-2 rounded-sm bg-violet-500" /> review</span>
      <span class="flex items-center gap-1.5"><span class="inline-block size-2 rounded-sm bg-amber-500" /> gate</span>
      <span class="ml-2 flex items-center gap-1.5"><span class="inline-block h-0 w-5 border-t-2 border-dashed border-violet-500/70" /> what a review reads</span>
      <button type="button" class="flex items-center gap-1.5 rounded px-1 hover:bg-elevated" :class="allDeps && 'text-amber-600'" :title="allDeps ? 'Showing every dependency — click to show only wrong-order ones (hover a card for its own)' : 'Showing wrong-order dependencies only — hover a card for its own, or click to show all'" @click="allDeps = !allDeps">
        <span class="inline-block h-0 w-5 border-t-2 border-amber-500/80" /> waits on · {{ allDeps ? 'all' : 'hover a card' }}
      </button>
      <span class="flex items-center gap-1.5"><span class="inline-block h-0 w-5 border-t-2 border-error" /> wrong order</span>
      <span class="flex items-center gap-1.5"><UIcon name="i-lucide-file-text" class="size-3" /> slice report</span>
      <span class="flex items-center gap-1.5" title="Own-agent tickets run in queue order: at most 4 sessions at once in a step, 3 beside an orchestrator; two orchestrators run alone"><span class="inline-block h-0 w-5 border-t border-dashed border-amber-500/70" /> queue — starts as a session frees</span>
    </div>
  </div>
</template>
