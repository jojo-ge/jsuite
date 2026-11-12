<script setup lang="ts">
// One graph on the Graphs menu (/graphs): enough to pick the right one at a
// glance — its key and title, the project types it chains in flow order, how
// far along it is (a segment per node state), where it is now, a thumbnail of
// its shape and when it last changed. The whole card opens the graph.
import { agoLabel } from '~/composables/useTracker'
import { graphSummary, graphThumbnail, graphUrl, NODE_STATE_LABEL, type GraphNodeState, type GraphView } from '~/utils/graphs'

const props = defineProps<{
  graph: GraphView
  /** Its projects' and tickets' updatedAt — so "last changed" follows the work, not only edits to the graph. */
  activity?: string[]
  now: Date
}>()

const summary = computed(() => graphSummary(props.graph, props.activity))
const thumb = computed(() => graphThumbnail(props.graph))

// Flow order of states, as the progress bar reads left → right.
const STATE_ORDER: GraphNodeState[] = ['finished', 'entered', 'ready', 'waiting', 'proposed']
const STATE_BAR: Record<GraphNodeState, string> = {
  finished: 'bg-success',
  entered: 'bg-info',
  ready: 'bg-primary',
  waiting: 'bg-warning/70',
  proposed: 'bg-accented',
}
const STATE_FILL: Record<GraphNodeState, string> = {
  finished: 'fill-success',
  entered: 'fill-info',
  ready: 'fill-primary',
  waiting: 'fill-warning',
  proposed: '',
}
const stateOf = (id: string) => props.graph.nodes.find((n) => n.id === id)?.state ?? 'proposed'

// The thumbnail: a cell per node, scaled into a fixed box.
const CELL_W = 22
const CELL_H = 18
const R = 4.5
</script>

<template>
  <NuxtLink
    :to="graphUrl(graph.key)"
    class="group flex gap-4 rounded-lg border border-default bg-elevated/40 p-4 transition hover:border-primary hover:bg-elevated/70"
    :class="summary.done && 'opacity-70 hover:opacity-100'"
  >
    <div class="flex min-w-0 flex-1 flex-col gap-2">
      <div class="flex items-center gap-2">
        <span class="font-mono text-xs text-muted">{{ graph.key }}</span>
        <span class="ml-auto shrink-0 text-xs text-dimmed" :title="summary.lastChanged.slice(0, 16).replace('T', ' ')">
          {{ summary.lastChanged ? agoLabel(summary.lastChanged, now) : '' }}
        </span>
      </div>
      <h3 class="text-balance font-semibold group-hover:text-primary">{{ graph.name }}</h3>
      <p v-if="summary.chainLabel" class="text-xs text-muted">{{ summary.chainLabel }}</p>

      <!-- Progress: a segment per node, in flow order of states -->
      <div v-if="summary.total" class="flex flex-col gap-1">
        <div class="flex h-1.5 w-full gap-0.5 overflow-hidden rounded-full">
          <template v-for="s in STATE_ORDER" :key="s">
            <div
              v-if="summary.states[s]"
              :class="STATE_BAR[s]"
              :style="{ flexGrow: summary.states[s] }"
              :title="`${summary.states[s]} ${NODE_STATE_LABEL[s].toLowerCase()}`"
            />
          </template>
        </div>
        <p class="flex flex-wrap gap-x-2 text-xs text-muted">
          <span>{{ summary.finished }}/{{ summary.total }} finished</span>
          <span>· {{ summary.entered }}/{{ summary.total }} moved on into</span>
          <span v-if="summary.running" class="flex items-center gap-1 text-info">· <UIcon name="i-lucide-loader" class="size-3.5" /> {{ summary.running }} running</span>
          <span v-if="summary.proposed">· {{ summary.proposed }} proposed, no project yet</span>
        </p>
      </div>
      <p v-else class="text-xs text-dimmed">No projects yet</p>

      <!-- Where it is now -->
      <p v-if="summary.done" class="flex items-center gap-1 text-xs text-success">
        <UIcon name="i-lucide-circle-check" class="size-3.5" /> Every project finished
      </p>
      <div v-else-if="summary.now.length" class="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-xs">
        <span class="text-dimmed">Now</span>
        <span v-for="n in summary.now" :key="n.nodeId" class="min-w-0 truncate">
          <span v-if="n.projectKey" class="font-mono text-muted">{{ n.projectKey }}</span>
          {{ n.title }}
          <span class="text-dimmed">({{ NODE_STATE_LABEL[n.state].toLowerCase() }})</span>
        </span>
      </div>
    </div>

    <!-- The shape, drawn like the full graph: a row per layer, top → bottom -->
    <svg
      v-if="summary.total > 1"
      class="hidden shrink-0 self-center text-muted sm:block"
      :width="Math.min(thumb.cols * CELL_W, 132)"
      :height="Math.min(thumb.rows * CELL_H, 108)"
      :viewBox="`0 0 ${thumb.cols * CELL_W} ${thumb.rows * CELL_H}`"
      preserveAspectRatio="xMidYMid meet"
      aria-hidden="true"
    >
      <line
        v-for="e in thumb.edges"
        :key="`${e.from}>${e.to}`"
        :x1="e.x1 * CELL_W"
        :y1="e.y1 * CELL_H"
        :x2="e.x2 * CELL_W"
        :y2="e.y2 * CELL_H"
        stroke="currentColor"
        stroke-opacity="0.5"
        stroke-width="1.25"
      />
      <circle
        v-for="n in thumb.nodes"
        :key="n.id"
        :cx="n.x * CELL_W"
        :cy="n.y * CELL_H"
        :r="R"
        :class="STATE_FILL[stateOf(n.id)]"
        class="stroke-current"
        :stroke-dasharray="stateOf(n.id) === 'proposed' ? '2 1.5' : undefined"
        :style="stateOf(n.id) === 'proposed' ? { fill: 'var(--ui-bg)' } : undefined"
        stroke-width="1.25"
      />
    </svg>
  </NuxtLink>
</template>
