<script setup lang="ts">
// One stored graph, drawn top → bottom (jTicket lives on a vertical
// monitor): a row per layer, a card per node, an arrow per edge. Each card
// says what the node is (type, project or proposed), how far its project is,
// whether the human moved on into it, its outcome report and — for a build —
// the size of its slice. Clicking a card selects it (the page opens its
// briefing); in connect mode two clicks draw an edge, and an edge's × removes
// it. Nothing here starts anything.
import { NODE_STATE_LABEL, sliceDisplay, type GraphNodeState, type GraphNodeView, type GraphView } from '~/utils/graphs'

const props = defineProps<{
  graph: GraphView
  selected?: string | null
  /** Connect mode: the first click picks the edge's start, the second its end. */
  connecting?: boolean
}>()
const emit = defineEmits<{ select: [nodeId: string]; connect: [from: string, to: string]; removeEdge: [from: string, to: string] }>()

const NODE_W = 248
const NODE_H = 148
const COL_GAP = 24
const ROW_GAP = 64
const PAD = 16

const layout = computed(() => {
  const rows: GraphNodeView[][] = []
  for (const n of props.graph.nodes) (rows[n.layer] ??= []).push(n)
  const full = rows.filter(Boolean)
  const widest = Math.max(1, ...full.map((r) => r.length))
  const width = PAD * 2 + widest * NODE_W + (widest - 1) * COL_GAP
  const pos = new Map<string, { x: number; y: number }>()
  full.forEach((row, r) => {
    const rowW = row.length * NODE_W + (row.length - 1) * COL_GAP
    row.forEach((n, i) => pos.set(n.id, { x: (width - rowW) / 2 + i * (NODE_W + COL_GAP), y: PAD + r * (NODE_H + ROW_GAP) }))
  })
  const height = Math.max(NODE_H + PAD * 2, PAD * 2 + full.length * NODE_H + (full.length - 1) * ROW_GAP)
  const edges = props.graph.edges
    .filter((e) => pos.has(e.from) && pos.has(e.to))
    .map((e) => {
      const a = pos.get(e.from)!
      const b = pos.get(e.to)!
      const x1 = a.x + NODE_W / 2
      const y1 = a.y + NODE_H
      const x2 = b.x + NODE_W / 2
      const y2 = b.y
      const dy = Math.max(40, Math.abs(y2 - y1) / 2)
      const stacked = props.graph.nodes.find((n) => n.id === e.to)?.stackOn === e.from
      return { ...e, key: `${e.from}>${e.to}`, d: `M ${x1} ${y1} C ${x1} ${y1 + dy}, ${x2} ${y2 - dy}, ${x2} ${y2 - 6}`, lx: (x1 + x2) / 2, ly: (y1 + y2) / 2, stacked }
    })
  return { width, height, pos, edges }
})

const STATE_COLOR: Record<GraphNodeState, 'neutral' | 'info' | 'success' | 'warning' | 'primary'> = {
  proposed: 'neutral',
  waiting: 'warning',
  ready: 'primary',
  entered: 'info',
  finished: 'success',
}
const STATE_ICON: Record<GraphNodeState, string> = {
  proposed: 'i-lucide-circle-dashed',
  waiting: 'i-lucide-hourglass',
  ready: 'i-lucide-circle-arrow-right',
  entered: 'i-lucide-circle-play',
  finished: 'i-lucide-circle-check',
}
const TYPE_ICON: Record<string, string> = {
  standard: 'i-lucide-hammer',
  plan: 'i-lucide-compass',
  prreview: 'i-lucide-git-pull-request',
  planreview: 'i-lucide-scan-search',
  predeploy: 'i-lucide-bug',
}

const from = ref<string | null>(null)
watch(() => props.connecting, () => (from.value = null))
function click(id: string) {
  if (!props.connecting) return emit('select', id)
  if (!from.value) from.value = id
  else if (from.value === id) from.value = null
  else {
    emit('connect', from.value, id)
    from.value = null
  }
}
</script>

<template>
  <div class="overflow-x-auto rounded-lg border border-default bg-elevated/30">
    <div class="relative mx-auto" :style="{ width: `${layout.width}px`, height: `${layout.height}px` }">
      <svg class="pointer-events-none absolute inset-0 overflow-visible text-muted/60" :width="layout.width" :height="layout.height">
        <defs>
          <marker id="gc-arrow" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor" />
          </marker>
        </defs>
        <path
          v-for="e in layout.edges"
          :key="e.key"
          :d="e.d"
          fill="none"
          stroke="currentColor"
          :stroke-width="e.stacked ? 2.5 : 1.5"
          marker-end="url(#gc-arrow)"
        />
      </svg>
      <!-- Edge chips: "stacks" on a build stacked on its upstream; × in connect mode removes the edge. -->
      <template v-for="e in layout.edges" :key="`l-${e.key}`">
        <button
          v-if="connecting"
          type="button"
          class="absolute flex -translate-x-1/2 -translate-y-1/2 items-center rounded-full border border-default bg-default p-0.5 text-muted hover:border-error hover:text-error"
          :style="{ left: `${e.lx}px`, top: `${e.ly}px` }"
          aria-label="Remove this edge"
          @click="emit('removeEdge', e.from, e.to)"
        >
          <UIcon name="i-lucide-x" class="size-3.5" />
        </button>
        <span
          v-else-if="e.stacked"
          class="absolute -translate-x-1/2 -translate-y-1/2 rounded-full border border-default bg-default px-2 py-0.5 text-[11px] text-muted"
          :style="{ left: `${e.lx}px`, top: `${e.ly}px` }"
        >
          stacks on
        </span>
      </template>

      <button
        v-for="n in graph.nodes"
        :key="n.id"
        type="button"
        class="absolute flex flex-col gap-1.5 overflow-hidden rounded-lg border bg-default p-3 text-left shadow-sm transition"
        :class="[
          n.state === 'proposed' ? 'border-dashed border-default' : 'border-default',
          selected === n.id || from === n.id ? 'ring-2 ring-primary' : 'hover:border-primary',
        ]"
        :style="{ left: `${layout.pos.get(n.id)?.x}px`, top: `${layout.pos.get(n.id)?.y}px`, width: `${NODE_W}px`, height: `${NODE_H}px` }"
        @click="click(n.id)"
      >
        <div class="flex items-center gap-1.5">
          <UIcon :name="TYPE_ICON[n.mode] ?? 'i-lucide-folder'" class="size-3.5 shrink-0 text-muted" />
          <span class="text-[11px] font-medium text-muted">{{ n.type }}</span>
          <span v-if="n.project" class="whitespace-nowrap font-mono text-[11px] text-dimmed">{{ n.project.key }}</span>
          <UBadge :color="STATE_COLOR[n.state]" :icon="STATE_ICON[n.state]" variant="subtle" size="sm" class="ml-auto max-w-36 truncate">
            {{ NODE_STATE_LABEL[n.state] }}
          </UBadge>
        </div>
        <p class="line-clamp-2 w-full text-sm font-semibold leading-snug" :class="n.state === 'proposed' ? 'text-muted' : ''" :title="n.title">
          {{ n.title }}
        </p>
        <div class="mt-auto flex flex-col gap-0.5 text-xs">
          <div v-if="n.project" class="flex items-center gap-2">
            <span class="text-muted">{{ n.tickets.done }}/{{ n.tickets.total }} tickets</span>
            <span v-if="n.running" class="flex items-center gap-1 text-info"><UIcon name="i-lucide-loader" class="size-3.5" /> running</span>
            <span v-if="n.outcomeDoc" class="ml-auto flex items-center gap-1 text-success"><UIcon name="i-lucide-file-check-2" class="size-3.5" /> Outcome report</span>
          </div>
          <span v-else class="text-dimmed">No project yet — moving on creates it</span>
          <span
            v-if="n.mode === 'standard' && n.slice && (n.slice.state !== 'unknown' || n.sharedWith?.length)"
            class="flex min-w-0 items-start gap-1"
            :class="sliceDisplay(n.slice, n.sharedWith).large ? 'text-warning' : sliceDisplay(n.slice, n.sharedWith).shared ? 'text-warning' : n.slice.state === 'ok' ? 'text-muted' : 'text-dimmed'"
            :title="sliceDisplay(n.slice, n.sharedWith).title"
          >
            <UIcon :name="sliceDisplay(n.slice, n.sharedWith).shared ? 'i-lucide-git-branch' : 'i-lucide-diff'" class="mt-px size-3.5 shrink-0" />
            <span class="line-clamp-2">{{ sliceDisplay(n.slice, n.sharedWith).text }}<template v-if="sliceDisplay(n.slice, n.sharedWith).large"> · large</template></span>
          </span>
        </div>
      </button>
    </div>
  </div>
</template>
