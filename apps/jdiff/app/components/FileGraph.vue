<script setup lang="ts">
import { categorize, type FileCategory } from '~/utils/fileCategories'
import type { FileRisk } from '~/utils/risk'

interface DiffFileMeta {
  path: string
  additions: number
  deletions: number
}
interface GraphNode {
  path: string
  cluster: string
}
interface GraphEdge {
  source: string
  target: string
  kind: 'import' | 'mention'
}
interface GraphCluster {
  id: string
  label: string
  linked: boolean
}

const props = defineProps<{
  repo: string
  number: string
  files: DiffFileMeta[]
  anchorFor: (path: string) => string
  risks?: Record<string, FileRisk>
  lastPushedAt?: string | null
  // Query params identifying the review target; defaults to { number } for a
  // PR. Branch targets pass { branch, base }.
  targetQuery?: Record<string, string>
  // fills the viewport (used inside the fullscreen overlay) instead of
  // rendering as an inline card
  fullscreen?: boolean
}>()
const emit = defineEmits<{
  (e: 'open', ev: MouseEvent, path: string): void
}>()

const { data, pending, error, refresh } = useFetch<{
  nodes: GraphNode[]
  edges: GraphEdge[]
  clusters: GraphCluster[]
}>('/api/graph', {
  query: { repo: props.repo, ...(props.targetQuery ?? { number: props.number }) },
})

// The graph is computed from the PR refs at fetch time; a push after that
// makes it out of date.
const fetchedAt = ref('')
watch(data, (d) => {
  if (d) fetchedAt.value = new Date().toISOString()
}, { immediate: true })
const stale = computed(() =>
  !!fetchedAt.value &&
  !!props.lastPushedAt &&
  new Date(props.lastPushedAt).getTime() > new Date(fetchedAt.value).getTime(),
)

const CATEGORY_COLORS: Record<FileCategory, string> = {
  source: '#58a6ff',
  tests: '#3fb950',
  config: '#d29922',
  docs: '#bc8cff',
  data: '#39c5cf',
  assets: '#f778ba',
  generated: '#6e7681',
}

interface SimNode {
  path: string
  name: string
  cluster: string
  x: number
  y: number
  vx: number
  vy: number
  r: number
  color: string
  category: FileCategory
}

const wrap = ref<HTMLElement | null>(null)
const width = ref(1200)
const height = ref(480)

const simNodes = ref<SimNode[]>([])
const simEdges = ref<{ a: SimNode; b: SimNode; kind: 'import' | 'mention' }[]>([])
const clusterCenters = ref(new Map<string, { x: number; y: number; r: number; size: number; label: string; linked: boolean }>())
// bumped each simulation frame so the SVG re-renders
const frame = ref(0)

const hovered = ref<string | null>(null)
const neighbors = computed(() => {
  const set = new Set<string>()
  if (!hovered.value) return set
  set.add(hovered.value)
  for (const e of simEdges.value) {
    if (e.a.path === hovered.value) set.add(e.b.path)
    if (e.b.path === hovered.value) set.add(e.a.path)
  }
  return set
})
const hoveredNode = computed(() =>
  hovered.value ? simNodes.value.find((n) => n.path === hovered.value) ?? null : null,
)

const usedCategories = computed(() => {
  const cats = new Set(simNodes.value.map((n) => n.category))
  return (Object.keys(CATEGORY_COLORS) as FileCategory[]).filter((c) => cats.has(c))
})
const hasMentions = computed(() => simEdges.value.some((e) => e.kind === 'mention'))
const hasImports = computed(() => simEdges.value.some((e) => e.kind === 'import'))

let alpha = 0
let raf = 0

// deterministic pseudo-random spread so layout is stable across reloads
function jitter(i: number): number {
  return ((i * 2654435761) % 1000) / 1000 - 0.5
}

function buildSim() {
  const graph = data.value
  if (!graph) return

  const churn = new Map(props.files.map((f) => [f.path, f.additions + f.deletions]))

  width.value = Math.max(600, wrap.value?.clientWidth ?? 1200)

  // pack cluster centers in rows, biggest clusters first
  const counts = new Map<string, number>()
  for (const n of graph.nodes) counts.set(n.cluster, (counts.get(n.cluster) ?? 0) + 1)
  const ordered = [...graph.clusters].sort(
    (a, b) => (counts.get(b.id) ?? 0) - (counts.get(a.id) ?? 0),
  )

  const centers = new Map<string, { x: number; y: number; r: number; size: number; label: string; linked: boolean }>()
  const pad = 30
  let x = pad
  let y = pad
  let rowH = 0
  for (const c of ordered) {
    const n = counts.get(c.id) ?? 1
    const r = 34 * Math.sqrt(n) + 46
    if (x + r * 2 > width.value - pad && x > pad) {
      x = pad
      y += rowH + pad
      rowH = 0
    }
    centers.set(c.id, { x: x + r, y: y + r, r, size: n, label: c.label, linked: c.linked })
    x += r * 2 + pad
    rowH = Math.max(rowH, r * 2)
  }
  // In fullscreen, stretch at least to the visible area (minus overlay
  // chrome) so small graphs still fill the screen.
  const minH = props.fullscreen ? Math.max(420, window.innerHeight - 170) : 420
  height.value = Math.max(minH, y + rowH + pad)
  clusterCenters.value = centers

  const nodes: SimNode[] = graph.nodes.map((n, i) => {
    const c = centers.get(n.cluster)!
    const category = categorize(n.path)
    return {
      path: n.path,
      name: n.path.split('/').pop() ?? n.path,
      cluster: n.cluster,
      x: c.x + jitter(i) * c.r * 1.4,
      y: c.y + jitter(i + 7) * c.r * 1.4,
      vx: 0,
      vy: 0,
      r: Math.max(6, Math.min(20, 4 + Math.sqrt(churn.get(n.path) ?? 0) * 0.9)),
      color: CATEGORY_COLORS[category],
      category,
    }
  })
  const byPath = new Map(nodes.map((n) => [n.path, n]))
  simNodes.value = nodes
  simEdges.value = graph.edges
    .map((e) => ({ a: byPath.get(e.source)!, b: byPath.get(e.target)!, kind: e.kind }))
    .filter((e) => e.a && e.b)

  reheat(1)
}

function reheat(a: number) {
  alpha = Math.max(alpha, a)
  cancelAnimationFrame(raf)
  raf = requestAnimationFrame(tick)
}

function tick() {
  const nodes = simNodes.value
  const centers = clusterCenters.value

  // pairwise repulsion, stronger within the same cluster's neighborhood
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i]!
      const b = nodes[j]!
      let dx = a.x - b.x
      let dy = a.y - b.y
      let d2 = dx * dx + dy * dy
      if (d2 > 260 * 260) continue
      if (d2 < 1) { dx = jitter(i) || 0.5; dy = jitter(j) || 0.5; d2 = 1 }
      const f = Math.min(9, 2800 / d2) * alpha
      const d = Math.sqrt(d2)
      a.vx += (dx / d) * f
      a.vy += (dy / d) * f
      b.vx -= (dx / d) * f
      b.vy -= (dy / d) * f
    }
  }
  // edge springs
  for (const e of simEdges.value) {
    const rest = e.kind === 'import' ? 70 : 95
    const dx = e.b.x - e.a.x
    const dy = e.b.y - e.a.y
    const d = Math.max(1, Math.sqrt(dx * dx + dy * dy))
    const f = (d - rest) * 0.04 * (e.kind === 'import' ? 1 : 0.5) * alpha
    e.a.vx += (dx / d) * f
    e.a.vy += (dy / d) * f
    e.b.vx -= (dx / d) * f
    e.b.vy -= (dy / d) * f
  }
  // gravity toward cluster centers keeps components apart; weaker for big
  // clusters so they can spread out instead of collapsing into a knot
  for (const n of nodes) {
    const c = centers.get(n.cluster)
    if (c) {
      const g = 0.09 / Math.sqrt(c.size)
      n.vx += (c.x - n.x) * g * alpha
      n.vy += (c.y - n.y) * g * alpha
    }
    if (dragging?.node === n) { n.vx = 0; n.vy = 0; continue }
    n.vx *= 0.82
    n.vy *= 0.82
    n.x = Math.max(n.r + 4, Math.min(width.value - n.r - 4, n.x + n.vx))
    n.y = Math.max(n.r + 4, Math.min(height.value - n.r - 4, n.y + n.vy))
  }

  frame.value++
  alpha *= 0.985
  if (alpha > 0.015) raf = requestAnimationFrame(tick)
}

// dashed hull circle per linked cluster, recomputed from live positions
const hulls = computed(() => {
  void frame.value
  const groups = new Map<string, SimNode[]>()
  for (const n of simNodes.value) {
    ;(groups.get(n.cluster) ?? groups.set(n.cluster, []).get(n.cluster)!).push(n)
  }
  const out: { id: string; x: number; y: number; r: number; label: string; linked: boolean }[] = []
  for (const [id, members] of groups) {
    const meta = clusterCenters.value.get(id)
    if (!meta) continue
    const cx = members.reduce((s, n) => s + n.x, 0) / members.length
    const cy = members.reduce((s, n) => s + n.y, 0) / members.length
    let r = 0
    for (const n of members) {
      r = Math.max(r, Math.hypot(n.x - cx, n.y - cy) + n.r)
    }
    out.push({ id, x: cx, y: cy, r: r + 18, label: meta.label, linked: meta.linked })
  }
  return out
})

// drag: pin the node to the pointer; suppress the click-through if it moved
let dragging: { node: SimNode; moved: number } | null = null

function svgPoint(ev: PointerEvent): { x: number; y: number } {
  const rect = (wrap.value?.querySelector('svg') as SVGSVGElement).getBoundingClientRect()
  return {
    x: ((ev.clientX - rect.left) / rect.width) * width.value,
    y: ((ev.clientY - rect.top) / rect.height) * height.value,
  }
}

function onPointerDown(ev: PointerEvent, node: SimNode) {
  dragging = { node, moved: 0 }
  ;(ev.currentTarget as Element).setPointerCapture(ev.pointerId)
}
function onPointerMove(ev: PointerEvent) {
  if (!dragging) return
  const p = svgPoint(ev)
  dragging.moved += Math.hypot(p.x - dragging.node.x, p.y - dragging.node.y)
  dragging.node.x = p.x
  dragging.node.y = p.y
  reheat(0.3)
}
let lastDragMoved = 0
function onPointerUp() {
  lastDragMoved = dragging?.moved ?? 0
  dragging = null
}
// pointerup fires before click; if the node was dragged, swallow the click
// so releasing a drag doesn't navigate to the file anchor
function onNodeClick(ev: MouseEvent, node: SimNode) {
  if (lastDragMoved > 4) {
    ev.preventDefault()
    ev.stopPropagation()
    return
  }
  emit('open', ev, node.path)
}

watch(data, () => nextTick(buildSim), { immediate: true })
onMounted(() => {
  if (data.value && !simNodes.value.length) buildSim()
})
onBeforeUnmount(() => cancelAnimationFrame(raf))
</script>

<template>
  <div ref="wrap" class="filegraph" :class="{ fullscreen }">
    <div v-if="pending" class="state">
      <span class="spinner" />
      <span>reading changed files &amp; extracting references…</span>
    </div>
    <div v-else-if="error" class="error-box">{{ error.data?.message ?? error.message }}</div>
    <template v-else-if="data">
      <div class="legend">
        <span v-for="c in usedCategories" :key="c" class="lg">
          <span class="dot" :style="{ background: CATEGORY_COLORS[c] }" />{{ c }}
        </span>
        <span class="lg sep" />
        <span v-if="hasImports" class="lg"><span class="edge-sample import" />import</span>
        <span v-if="hasMentions" class="lg"><span class="edge-sample mention" />mention</span>
        <span class="lg hint">node size = churn · drag to untangle · click to jump to diff</span>
        <template v-if="stale">
          <span class="lg stale-badge" title="the PR was pushed after this graph was computed">out of date</span>
          <button class="lg refresh" @click="refresh()">refresh</button>
        </template>
      </div>

      <svg
        :viewBox="`0 0 ${width} ${height}`"
        :style="{ aspectRatio: `${width} / ${height}` }"
        @pointermove="onPointerMove"
        @pointerup="onPointerUp"
        @pointerleave="onPointerUp"
      >
        <!-- cluster hulls + labels -->
        <g v-for="h in hulls" :key="h.id" class="hull">
          <circle
            v-if="h.linked"
            :cx="h.x"
            :cy="h.y"
            :r="h.r"
            class="hull-circle"
          />
          <text :x="h.x" :y="h.y - h.r - 6" class="hull-label" :class="{ dim: !h.linked }">
            {{ h.label }}
          </text>
        </g>

        <!-- edges -->
        <line
          v-for="(e, i) in simEdges"
          :key="i"
          :x1="e.a.x"
          :y1="e.a.y"
          :x2="e.b.x"
          :y2="e.b.y"
          class="edge"
          :class="[e.kind, { faded: hovered && !(neighbors.has(e.a.path) && neighbors.has(e.b.path)) }]"
        />

        <!-- nodes -->
        <a
          v-for="n in simNodes"
          :key="n.path"
          :href="'#' + anchorFor(n.path)"
          class="node"
          :class="{ faded: hovered && !neighbors.has(n.path) }"
          @click="onNodeClick($event, n)"
          @pointerdown="onPointerDown($event, n)"
          @pointerenter="hovered = n.path"
          @pointerleave="hovered = null"
        >
          <circle
            :cx="n.x"
            :cy="n.y"
            :r="n.r"
            :fill="n.color"
            :class="{ risky: risks?.[n.path]?.level === 'high' }"
          />
          <text :x="n.x" :y="n.y + n.r + 11" class="node-label">{{ n.name }}</text>
        </a>
      </svg>

      <div class="status">
        <template v-if="hoveredNode">
          <span class="path">{{ hoveredNode.path }}</span>
          <span v-if="risks?.[hoveredNode.path]" class="risk" :class="risks[hoveredNode.path]!.level">
            {{ risks[hoveredNode.path]!.level }} risk
          </span>
        </template>
        <span v-else class="muted">
          {{ simNodes.length }} files · {{ simEdges.length }} link{{ simEdges.length === 1 ? '' : 's' }}
          · hover a node for details
        </span>
      </div>
    </template>
  </div>
</template>

<style scoped>
.filegraph {
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--panel);
  padding: 10px 12px 6px;
  margin-bottom: 20px;
}
/* Inside the fullscreen overlay: take the remaining height and scroll when
   the packed clusters run taller than the viewport. */
.filegraph.fullscreen {
  flex: 1;
  min-height: 0;
  margin-bottom: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
}
.filegraph.fullscreen .state { flex: 1; }
.filegraph.fullscreen svg { flex: none; }
.state {
  display: flex;
  gap: 10px;
  align-items: center;
  justify-content: center;
  padding: 40px 0;
  color: var(--muted);
  font-size: 13px;
}
.legend {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
  padding: 0 4px 8px;
  font-family: var(--mono);
  font-size: 10px;
  color: var(--muted);
}
.lg {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}
.lg.sep {
  width: 1px;
  height: 12px;
  background: var(--border);
}
.lg.hint { margin-left: auto; }
.lg.stale-badge {
  color: #d29922;
  border: 1px solid #d2992255;
  border-radius: 10px;
  padding: 0 8px;
  white-space: nowrap;
}
.lg.refresh {
  border: 1px solid var(--border);
  background: var(--panel-2);
  color: var(--muted);
  border-radius: 5px;
  padding: 1px 8px;
  cursor: pointer;
  font-family: var(--mono);
  font-size: 10px;
}
.lg.refresh:hover { color: var(--text); }
.dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
}
.edge-sample {
  width: 16px;
  height: 0;
  border-top: 1.5px solid var(--muted);
}
.edge-sample.mention { border-top-style: dashed; opacity: 0.7; }
svg {
  display: block;
  width: 100%;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg);
  touch-action: none;
}
.hull-circle {
  fill: rgba(88, 166, 255, 0.03);
  stroke: var(--border);
  stroke-dasharray: 4 5;
}
.hull-label {
  fill: var(--muted);
  font-family: var(--mono);
  font-size: 11px;
  font-weight: 600;
  text-anchor: middle;
}
.hull-label.dim { opacity: 0.6; font-weight: 400; }
.edge {
  stroke: var(--muted);
  stroke-opacity: 0.55;
  stroke-width: 1.3;
  transition: stroke-opacity 0.15s;
}
.edge.mention {
  stroke-dasharray: 3 4;
  stroke-opacity: 0.3;
}
.edge.faded { stroke-opacity: 0.06; }
.node { cursor: pointer; }
.node circle {
  stroke: var(--bg);
  stroke-width: 1.5;
  transition: opacity 0.15s;
}
.node circle.risky {
  stroke: var(--red);
  stroke-width: 2;
}
.node text {
  fill: var(--text);
  font-family: var(--mono);
  font-size: 10px;
  text-anchor: middle;
  pointer-events: none;
  paint-order: stroke;
  stroke: var(--bg);
  stroke-width: 3px;
}
.node.faded { opacity: 0.15; }
.status {
  display: flex;
  gap: 12px;
  align-items: baseline;
  padding: 6px 4px 2px;
  font-family: var(--mono);
  font-size: 11px;
  min-height: 24px;
}
.status .path { color: var(--text); overflow-wrap: anywhere; }
.status .muted { color: var(--muted); }
.status .risk.high { color: var(--red); }
.status .risk.medium { color: #d29922; }
.status .risk.low { color: var(--green); }
</style>
