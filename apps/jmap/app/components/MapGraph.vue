<script setup lang="ts">
import type { MapSynthesis } from '~/utils/mapTypes'
import { layoutMap, NODE_W, NODE_H } from '~/utils/mapLayout'

// The interactive map itself: hand-rolled SVG (the jRig way — no graph libs).
// Layout comes from layoutMap; this component draws it, pans/zooms the
// viewBox, highlights a hovered node's neighborhood, and reports clicks.

const props = defineProps<{
  synthesis: MapSynthesis
  selected: string | null
}>()
const emit = defineEmits<{ select: [id: string | null] }>()

const svgEl = ref<SVGSVGElement | null>(null)
const { viewBoxAttr, fit, onWheel, onPointerDown, dragging } = useMapPan(svgEl)

const layout = computed(() => layoutMap(props.synthesis))
watch(layout, (l) => fit(l.width, l.height), { immediate: true })

// One muted accent per node kind — inline styles, not utility classes, so the
// palette survives Tailwind's class scanning and reads in both themes.
const KIND_COLORS: Record<string, string> = {
  domain: '#10b981',
  external: '#94a3b8',
  store: '#f59e0b',
  service: '#38bdf8',
  route: '#818cf8',
  component: '#818cf8',
  model: '#f472b6',
  util: '#94a3b8',
}
const colorFor = (kind: string) => KIND_COLORS[kind] ?? '#94a3b8'

// ── Hover neighborhood ───────────────────────────────────────────────────────
const hovered = ref<string | null>(null)
const adjacency = computed(() => {
  const adj = new Map<string, Set<string>>()
  for (const e of props.synthesis.edges) {
    if (!adj.has(e.from)) adj.set(e.from, new Set())
    if (!adj.has(e.to)) adj.set(e.to, new Set())
    adj.get(e.from)!.add(e.to)
    adj.get(e.to)!.add(e.from)
  }
  return adj
})
const focusId = computed(() => hovered.value ?? props.selected)
function nodeDimmed(id: string): boolean {
  const f = focusId.value
  if (!f || f === id) return false
  return !(adjacency.value.get(f)?.has(id) ?? false)
}
function edgeActive(e: { from: string; to: string }): boolean {
  const f = focusId.value
  return !!f && (e.from === f || e.to === f)
}

// ── Edge geometry ────────────────────────────────────────────────────────────
function edgePath(e: { from: string; to: string }): string {
  const a = layout.value.positions[e.from]
  const b = layout.value.positions[e.to]
  if (!a || !b) return ''
  const acx = a.x + NODE_W / 2, acy = a.y + NODE_H / 2
  const bcx = b.x + NODE_W / 2, bcy = b.y + NODE_H / 2
  if (Math.abs(bcx - acx) >= Math.abs(bcy - acy)) {
    // Mostly horizontal: leave/enter through the vertical sides.
    const sx = bcx > acx ? a.x + NODE_W : a.x
    const tx = bcx > acx ? b.x - 8 : b.x + NODE_W + 8
    const bend = (tx - sx) / 2
    return `M ${sx} ${acy} C ${sx + bend} ${acy}, ${tx - bend} ${bcy}, ${tx} ${bcy}`
  }
  // Mostly vertical (same column): leave/enter through the horizontal sides.
  const sy = bcy > acy ? a.y + NODE_H : a.y
  const ty = bcy > acy ? b.y - 8 : b.y + NODE_H + 8
  const bend = (ty - sy) / 2
  return `M ${acx} ${sy} C ${acx} ${sy + bend}, ${bcx} ${ty - bend}, ${bcx} ${ty}`
}

function midpoint(e: { from: string; to: string }) {
  const a = layout.value.positions[e.from]
  const b = layout.value.positions[e.to]
  if (!a || !b) return { x: 0, y: 0 }
  return { x: (a.x + b.x) / 2 + NODE_W / 2, y: (a.y + b.y) / 2 + NODE_H / 2 }
}

function onBackgroundClick() {
  if (!dragging.value) emit('select', null)
}
const clipLabel = (s: string) => (s.length > 26 ? s.slice(0, 25) + '…' : s)
</script>

<template>
  <svg
    ref="svgEl"
    class="h-full w-full touch-none select-none"
    :viewBox="viewBoxAttr"
    preserveAspectRatio="xMidYMid meet"
    @wheel="onWheel"
    @pointerdown="onPointerDown"
    @click.self="onBackgroundClick"
  >
    <defs>
      <marker id="jmap-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
        <path d="M 0 1 L 9 5 L 0 9 z" class="fill-(--ui-text-dimmed)" />
      </marker>
      <marker id="jmap-arrow-hot" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
        <path d="M 0 1 L 9 5 L 0 9 z" class="fill-(--ui-primary)" />
      </marker>
    </defs>

    <!-- Group hulls -->
    <g v-for="g in layout.groupBoxes" :key="g.id" class="pointer-events-none">
      <rect
        :x="g.x" :y="g.y" :width="g.width" :height="g.height" rx="14"
        class="fill-(--ui-bg-elevated)/40 stroke-(--ui-border)"
        stroke-dasharray="4 4"
      />
      <text :x="g.x + 12" :y="g.y + 18" class="fill-(--ui-text-muted) text-[11px] font-semibold uppercase tracking-wide">
        {{ g.label }}
      </text>
    </g>

    <!-- Edges -->
    <g v-for="(e, i) in synthesis.edges" :key="i" class="pointer-events-none">
      <path
        :d="edgePath(e)"
        fill="none"
        :class="edgeActive(e) ? 'stroke-(--ui-primary)' : 'stroke-(--ui-text-dimmed)'"
        :stroke-width="edgeActive(e) ? 2.5 : 1.5"
        :opacity="focusId && !edgeActive(e) ? 0.15 : 0.8"
        :marker-end="edgeActive(e) ? 'url(#jmap-arrow-hot)' : 'url(#jmap-arrow)'"
      />
      <text
        v-if="edgeActive(e)"
        :x="midpoint(e).x" :y="midpoint(e).y - 6"
        text-anchor="middle"
        class="fill-(--ui-primary) text-[10px] font-medium"
      >{{ e.kind }}</text>
    </g>

    <!-- Nodes -->
    <g
      v-for="n in synthesis.nodes"
      :key="n.id"
      class="cursor-pointer transition-opacity"
      :opacity="nodeDimmed(n.id) ? 0.25 : 1"
      @pointerdown.stop
      @click.stop="emit('select', n.id)"
      @pointerenter="hovered = n.id"
      @pointerleave="hovered = null"
    >
      <rect
        :x="layout.positions[n.id]?.x" :y="layout.positions[n.id]?.y"
        :width="NODE_W" :height="NODE_H" rx="10"
        class="fill-(--ui-bg)"
        :stroke="colorFor(n.kind)"
        :stroke-width="selected === n.id ? 3 : 1.5"
      />
      <rect
        :x="layout.positions[n.id]?.x" :y="layout.positions[n.id]?.y"
        :width="NODE_W" :height="NODE_H" rx="10"
        :fill="colorFor(n.kind)" opacity="0.08"
      />
      <text
        :x="(layout.positions[n.id]?.x ?? 0) + NODE_W / 2"
        :y="(layout.positions[n.id]?.y ?? 0) + 26"
        text-anchor="middle"
        class="fill-(--ui-text) text-[13px] font-semibold"
      >{{ clipLabel(n.label) }}</text>
      <text
        :x="(layout.positions[n.id]?.x ?? 0) + NODE_W / 2"
        :y="(layout.positions[n.id]?.y ?? 0) + 44"
        text-anchor="middle"
        :fill="colorFor(n.kind)"
        class="text-[10px] font-medium uppercase tracking-wide"
      >{{ n.kind }}</text>
    </g>
  </svg>
</template>
