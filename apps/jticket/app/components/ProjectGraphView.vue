<script setup lang="ts">
// One project graph, drawn top → bottom (jTicket lives on a vertical
// monitor): a row per layer, a card per project, an arrow per link labelled
// with how many tickets wait across it. Each card says how far the project
// is and whether its outcome report exists; clicking one scrolls to it.
// Display only — nothing here starts anything.
import type { Doc, Project, Ticket } from '~/composables/useTracker'
import { REPORT_PHASE, AUTO_PHASES } from '~/utils/autoLoop'
import type { ProjectGraph } from '~/utils/projectGraphs'

const props = defineProps<{
  graph: ProjectGraph
  projects: Project[]
  tickets: Ticket[]
  reports: Map<string, Doc | null>
}>()
const emit = defineEmits<{ select: [projectId: string] }>()

const NODE_W = 240
const NODE_H = 120
const COL_GAP = 24
const ROW_GAP = 64
const PAD = 16

const byId = computed(() => new Map(props.projects.map((p) => [p.id, p])))

const layout = computed(() => {
  const rows: string[][] = []
  for (const id of props.graph.projects) (rows[props.graph.layer[id] ?? 0] ??= []).push(id)
  const widest = Math.max(1, ...rows.map((r) => r?.length ?? 0))
  const width = PAD * 2 + widest * NODE_W + (widest - 1) * COL_GAP
  const pos = new Map<string, { x: number; y: number }>()
  rows.forEach((row, r) => {
    const rowW = row.length * NODE_W + (row.length - 1) * COL_GAP
    row.forEach((id, i) => pos.set(id, { x: (width - rowW) / 2 + i * (NODE_W + COL_GAP), y: PAD + r * (NODE_H + ROW_GAP) }))
  })
  const height = PAD * 2 + rows.length * NODE_H + (rows.length - 1) * ROW_GAP
  const edges = props.graph.links.map((l) => {
    const a = pos.get(l.from)!
    const b = pos.get(l.to)!
    const x1 = a.x + NODE_W / 2
    const y1 = a.y + NODE_H
    const x2 = b.x + NODE_W / 2
    const y2 = b.y
    // A link back up (a cycle) or across a row bends out to the side.
    const dy = Math.max(40, Math.abs(y2 - y1) / 2)
    return {
      id: `${l.from}>${l.to}`,
      d: `M ${x1} ${y1} C ${x1} ${y1 + dy}, ${x2} ${y2 - dy}, ${x2} ${y2 - 6}`,
      label: `${l.pairs.length} ticket${l.pairs.length === 1 ? '' : 's'}`,
      title: l.pairs.map((p) => `${p.blocked} waits on ${p.blocker}`).join('\n'),
      lx: (x1 + x2) / 2,
      ly: (y1 + y2) / 2,
    }
  })
  return { width, height, pos, edges }
})

const finished = (t: Ticket) => t.status === 'done' || t.status === 'merged'

function stateOf(p: Project) {
  const mine = props.tickets.filter((t) => t.projectId === p.id)
  const done = mine.filter(finished).length
  const auto = p.auto
  let status: { label: string; color: 'success' | 'info' | 'warning' | 'neutral'; icon: string }
  if (auto?.enabled) {
    const phase = auto.phase === 'reporting' ? REPORT_PHASE.label : (AUTO_PHASES.find((x) => x.phase === auto.phase)?.label ?? 'Between loops')
    status = auto.paused
      ? { label: `Loop ${auto.loop} · paused`, color: 'warning', icon: 'i-lucide-circle-pause' }
      : { label: auto.phase === 'reporting' ? phase : `Loop ${auto.loop} · ${phase}`, color: 'info', icon: 'i-lucide-infinity' }
  } else if (mine.length && done === mine.length) {
    status = { label: 'Complete', color: 'success', icon: 'i-lucide-circle-check' }
  } else if (mine.some((t) => t.status !== 'todo')) {
    status = { label: 'In progress', color: 'info', icon: 'i-lucide-loader' }
  } else {
    status = { label: 'Not started', color: 'neutral', icon: 'i-lucide-circle-dashed' }
  }
  const report = props.reports.get(p.id) ?? null
  const writing = auto?.enabled && auto.phase === 'reporting'
  return { done, total: mine.length, status, report, writing }
}

const nodes = computed(() =>
  props.graph.projects
    .map((id) => ({ id, project: byId.value.get(id), at: layout.value.pos.get(id)! }))
    .filter((n): n is { id: string; project: Project; at: { x: number; y: number } } => !!n.project)
    .map((n) => ({ ...n, state: stateOf(n.project) })),
)
</script>

<template>
  <div class="overflow-x-auto rounded-lg border border-default bg-elevated/30">
    <div class="relative mx-auto" :style="{ width: `${layout.width}px`, height: `${layout.height}px` }">
      <svg class="pointer-events-none absolute inset-0 overflow-visible text-muted/60" :width="layout.width" :height="layout.height">
        <defs>
          <marker id="pg-arrow" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor" />
          </marker>
        </defs>
        <path v-for="e in layout.edges" :key="e.id" :d="e.d" fill="none" stroke="currentColor" stroke-width="1.5" marker-end="url(#pg-arrow)" />
      </svg>
      <!-- Edge labels as HTML, so they get a tooltip and theme-aware chips. -->
      <UTooltip v-for="e in layout.edges" :key="`l-${e.id}`" :text="e.title">
        <span
          class="absolute -translate-x-1/2 -translate-y-1/2 rounded-full border border-default bg-default px-2 py-0.5 text-[11px] text-muted"
          :style="{ left: `${e.lx}px`, top: `${e.ly}px` }"
        >
          {{ e.label }}
        </span>
      </UTooltip>

      <button
        v-for="n in nodes"
        :key="n.id"
        type="button"
        class="absolute flex flex-col gap-1.5 overflow-hidden rounded-lg border border-default bg-default p-3 text-left shadow-sm transition hover:border-primary"
        :style="{ left: `${n.at.x}px`, top: `${n.at.y}px`, width: `${NODE_W}px`, height: `${NODE_H}px` }"
        @click="emit('select', n.id)"
      >
        <div class="flex items-center gap-2">
          <span class="font-mono text-[11px] text-muted">{{ n.project.key }}</span>
          <UBadge :color="n.state.status.color" :icon="n.state.status.icon" variant="subtle" size="sm" class="ml-auto max-w-36 truncate">
            {{ n.state.status.label }}
          </UBadge>
        </div>
        <p class="line-clamp-2 w-full text-sm font-semibold leading-snug" :title="n.project.title">{{ n.project.title }}</p>
        <div class="mt-auto flex items-center gap-2 text-xs">
          <span class="text-muted">{{ n.state.done }}/{{ n.state.total }} tickets</span>
          <span v-if="n.state.writing" class="ml-auto flex items-center gap-1 text-info">
            <UIcon name="i-lucide-pen-line" class="size-3.5" /> Writing report…
          </span>
          <span v-else-if="n.state.report" class="ml-auto flex items-center gap-1 text-success">
            <UIcon name="i-lucide-file-check-2" class="size-3.5" /> Outcome report
          </span>
          <span v-else class="ml-auto text-dimmed">No report yet</span>
        </div>
      </button>
    </div>
  </div>
</template>
