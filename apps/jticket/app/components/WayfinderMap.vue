<script setup lang="ts">
import type { Project, Ticket, TicketBucket, WayfinderType } from '~/composables/useTracker'

// Map mode for a wayfinder project: tickets as nodes in dependency layers
// flowing left → right toward the destination, blocking edges drawn between
// them, and the un-ticketable parts of the journey — fog and destination —
// read straight out of the map body (the project description) so the picture
// matches what the body says.
// `project` carries the share the node states are judged against — the peer's
// half of a shared map is not takeable here, so it must not be drawn as the
// frontier the walk aims at.
const props = defineProps<{
  body: string
  tickets: Ticket[]
  allTickets: Ticket[]
  project?: Project | null
}>()
const emit = defineEmits<{ 'edit-ticket': [Ticket] }>()

type NodeState = TicketBucket

const NODE_W = 216
const NODE_H = 74
const FOG_H = 92
const DEST_H = 128
const COL_GAP = 72
const ROW_GAP = 18
const PAD_X = 24
const PAD_TOP = 40
const PAD_BOTTOM = 24

const byId = computed(() => new Map(props.allTickets.map((t) => [t.id, t])))

function stateOf(t: Ticket): NodeState {
  return bucketOf(t, props.allTickets, props.project)
}

// Blockers of t that are themselves tickets on this map — the drawable edges.
function mapDeps(t: Ticket): Ticket[] {
  const here = new Set(props.tickets.map((x) => x.id))
  return t.blockedBy
    .map((id) => byId.value.get(id))
    .filter((d): d is Ticket => !!d && here.has(d.id))
}

// ── Map body sections ── The project description is the map: Destination, Not
// yet specified (fog) and Out of scope render as first-class parts of the picture.
function stripMd(s: string): string {
  return s
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
}

const sections = computed(() => {
  const out: Record<string, string[]> = {}
  let cur = ''
  for (const line of props.body.replace(/<!--[\s\S]*?-->/g, '').split('\n')) {
    const h = /^##\s+(.+)/.exec(line)
    if (h) { cur = h[1]!.trim().toLowerCase(); out[cur] = []; continue }
    if (cur) out[cur]!.push(line)
  }
  return out
})

function bullets(lines: string[] = []): string[] {
  const items: string[] = []
  for (const line of lines) {
    if (/^\s*[-*]\s+/.test(line)) items.push(line.replace(/^\s*[-*]\s+/, ''))
    else if (items.length && line.trim()) items[items.length - 1] += ' ' + line.trim()
  }
  return items.map(stripMd).filter(Boolean)
}

const destination = computed(() => stripMd((sections.value['destination'] ?? []).join(' ')))
const fog = computed(() => bullets(sections.value['not yet specified']))
const outOfScope = computed(() => bullets(sections.value['out of scope']))

// ── Layout ── Layer = longest blocker chain behind the ticket, so the x-axis
// reads as journey order. Cycle-safe: a cycle collapses to layer 0.
const layout = computed(() => {
  const depth = new Map<string, number>()
  const visiting = new Set<string>()
  const layerOf = (t: Ticket): number => {
    if (depth.has(t.id)) return depth.get(t.id)!
    if (visiting.has(t.id)) return 0
    visiting.add(t.id)
    const deps = mapDeps(t)
    const d = deps.length ? 1 + Math.max(...deps.map(layerOf)) : 0
    visiting.delete(t.id)
    depth.set(t.id, d)
    return d
  }

  const byKeyNum = (a: Ticket, b: Ticket) =>
    (Number(a.key.split('-').pop()) || 0) - (Number(b.key.split('-').pop()) || 0)

  const layers: Ticket[][] = []
  for (const t of [...props.tickets].sort(byKeyNum)) {
    const d = layerOf(t)
    ;(layers[d] ??= []).push(t)
  }

  // One barycenter pass: order each layer by the mean row of its blockers so
  // edges stay short and crossings stay rare.
  const row = new Map<string, number>()
  layers.forEach((layer, i) => {
    if (i > 0) {
      layer.sort((a, b) => {
        const mean = (t: Ticket) => {
          const rows = mapDeps(t).map((d) => row.get(d.id)).filter((r): r is number => r !== undefined)
          return rows.length ? rows.reduce((s, r) => s + r, 0) / rows.length : Number.MAX_SAFE_INTEGER
        }
        return mean(a) - mean(b) || byKeyNum(a, b)
      })
    }
    layer.forEach((t, r) => row.set(t.id, r))
  })

  const colHeight = (rows: number, h: number) => (rows ? rows * h + (rows - 1) * ROW_GAP : 0)
  const contentH = Math.max(
    ...layers.map((l) => colHeight(l.length, NODE_H)),
    colHeight(fog.value.length, FOG_H),
    destination.value ? DEST_H : 0,
    NODE_H,
  )

  const colX = (i: number) => PAD_X + i * (NODE_W + COL_GAP)
  const centered = (rows: number, h: number) => PAD_TOP + (contentH - colHeight(rows, h)) / 2

  const nodes = layers.flatMap((layer, i) =>
    layer.map((t, r) => ({
      ticket: t,
      state: stateOf(t),
      wf: wayfinderType(t) as WayfinderType | null,
      x: colX(i),
      y: centered(layer.length, NODE_H) + r * (NODE_H + ROW_GAP),
    })),
  )
  const pos = new Map(nodes.map((n) => [n.ticket.id, n]))

  const edges = nodes.flatMap((n) =>
    mapDeps(n.ticket).flatMap((d) => {
      const from = pos.get(d.id)
      if (!from) return []
      const x1 = from.x + NODE_W
      const y1 = from.y + NODE_H / 2
      const x2 = n.x
      const y2 = n.y + NODE_H / 2
      const bend = Math.min(COL_GAP, (x2 - x1) / 2)
      return [{
        id: `${d.id}-${n.ticket.id}`,
        d: `M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`,
        open: !isFinished(d.status),
      }]
    }),
  )

  let col = layers.length
  const fogX = fog.value.length ? colX(col++) : 0
  const fogNodes = fog.value.map((text, i) => ({
    text,
    x: fogX,
    y: centered(fog.value.length, FOG_H) + i * (FOG_H + ROW_GAP),
  }))
  const destX = destination.value ? colX(col++) : 0
  const destY = centered(1, DEST_H)

  return {
    nodes,
    edges,
    fogNodes,
    fogX,
    destX,
    destY,
    width: PAD_X * 2 + col * NODE_W + (col - 1) * COL_GAP,
    height: PAD_TOP + contentH + PAD_BOTTOM,
  }
})

const STATE_META: Record<NodeState, { label: string; icon: string; node: string; iconClass: string; dot: string }> = {
  frontier: {
    label: 'Frontier',
    icon: 'i-lucide-flag',
    node: 'border-primary bg-primary/10 ring-1 ring-primary/50',
    iconClass: 'text-primary',
    dot: 'bg-primary',
  },
  claimed: {
    label: 'In progress',
    icon: 'i-lucide-loader',
    node: 'border-info bg-info/10',
    iconClass: 'text-info',
    dot: 'bg-info',
  },
  notTakeable: {
    label: 'Not takeable here',
    icon: 'i-lucide-user-lock',
    node: 'border-warning/50 bg-warning/5 opacity-90',
    iconClass: 'text-warning',
    dot: 'bg-warning',
  },
  blocked: {
    label: 'Blocked',
    icon: 'i-lucide-lock',
    node: 'border-error/60 bg-error/5 opacity-90',
    iconClass: 'text-error',
    dot: 'bg-error',
  },
  done: {
    label: 'Resolved',
    icon: 'i-lucide-check',
    node: 'border-success/40 bg-success/5 opacity-75',
    iconClass: 'text-success',
    dot: 'bg-success',
  },
}

const counts = computed(() => {
  const c: Record<NodeState, number> = { frontier: 0, claimed: 0, notTakeable: 0, blocked: 0, done: 0 }
  for (const t of props.tickets) c[stateOf(t)]++
  return c
})

// The four flow states are always legended, zero or not — they describe the
// map itself. The fifth only exists on a shared one, so it appears only when
// it has something in it and a local-only map reads exactly as before.
const legend = computed(() =>
  (Object.entries(STATE_META) as [NodeState, (typeof STATE_META)[NodeState]][])
    .filter(([state]) => state !== 'notTakeable' || counts.value.notTakeable > 0),
)
</script>

<template>
  <div>
    <!-- Legend -->
    <div class="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
      <span v-for="[state, meta] in legend" :key="state" class="flex items-center gap-1.5">
        <span class="size-2 rounded-full" :class="meta.dot" />
        {{ meta.label }} · {{ counts[state] }}
      </span>
      <span v-if="layout.fogNodes.length" class="flex items-center gap-1.5">
        <UIcon name="i-lucide-cloud-fog" class="size-3.5" />
        Fog · {{ layout.fogNodes.length }}
      </span>
      <span v-if="outOfScope.length" class="flex items-center gap-1.5">
        <UIcon name="i-lucide-circle-off" class="size-3.5" />
        Out of scope · {{ outOfScope.length }}
      </span>
    </div>

    <!-- Canvas -->
    <div class="overflow-x-auto rounded-lg border border-default bg-elevated/25">
      <div class="relative" :style="{ width: layout.width + 'px', height: layout.height + 'px' }">
        <!-- Blocking edges -->
        <svg class="pointer-events-none absolute inset-0" :width="layout.width" :height="layout.height">
          <path
            v-for="e in layout.edges"
            :key="e.id"
            :d="e.d"
            fill="none"
            stroke="currentColor"
            stroke-width="1.5"
            :class="e.open ? 'text-error/60' : 'text-success/35'"
            :stroke-dasharray="e.open ? '5 4' : undefined"
          />
        </svg>

        <!-- Tickets -->
        <button
          v-for="n in layout.nodes"
          :key="n.ticket.id"
          type="button"
          class="absolute rounded-md border text-left transition hover:ring-2 hover:ring-primary/40"
          :class="STATE_META[n.state].node"
          :style="{ left: n.x + 'px', top: n.y + 'px', width: NODE_W + 'px', height: NODE_H + 'px' }"
          :title="`${n.ticket.key} ${n.ticket.title}${n.ticket.assignee ? ` — ${n.ticket.assignee}` : ''}`"
          @click="emit('edit-ticket', n.ticket)"
        >
          <span class="flex items-center gap-1.5 px-2 pt-1.5">
            <span class="font-mono text-[10px] text-muted">{{ n.ticket.key }}</span>
            <UIcon v-if="n.wf" :name="WAYFINDER_TYPE_META[n.wf].icon" class="size-3 text-muted" />
            <span v-if="n.ticket.type === 'HITL'" class="text-[9px] font-semibold text-warning">HITL</span>
            <span v-if="n.state === 'claimed' && n.ticket.assignee" class="max-w-16 truncate text-[9px] text-info">
              {{ n.ticket.assignee }}
            </span>
            <UIcon :name="STATE_META[n.state].icon" class="ml-auto size-3.5 shrink-0" :class="STATE_META[n.state].iconClass" />
          </span>
          <span class="block px-2 pb-1.5 text-xs font-medium leading-snug line-clamp-2">{{ n.ticket.title }}</span>
        </button>

        <!-- Fog of war — the map body's Not yet specified section -->
        <template v-if="layout.fogNodes.length">
          <div
            class="absolute flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-muted"
            :style="{ left: layout.fogX + 'px', top: PAD_TOP - 24 + 'px' }"
          >
            <UIcon name="i-lucide-cloud-fog" class="size-3.5" />
            Fog — not yet specified
          </div>
          <div
            v-for="(f, i) in layout.fogNodes"
            :key="i"
            class="absolute overflow-hidden rounded-md border border-dashed border-accented bg-elevated/60 px-2.5 py-2"
            :style="{ left: f.x + 'px', top: f.y + 'px', width: NODE_W + 'px', height: FOG_H + 'px' }"
            :title="f.text"
          >
            <p class="text-xs leading-snug text-muted line-clamp-4">{{ f.text }}</p>
            <div class="pointer-events-none absolute inset-0 bg-gradient-to-r from-transparent via-elevated/30 to-elevated/80" />
          </div>
        </template>

        <!-- Destination -->
        <template v-if="destination">
          <div
            class="absolute flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-primary"
            :style="{ left: layout.destX + 'px', top: PAD_TOP - 24 + 'px' }"
          >
            <UIcon name="i-lucide-flag-triangle-right" class="size-3.5" />
            Destination
          </div>
          <div
            class="absolute overflow-hidden rounded-md border-2 border-primary/60 bg-primary/5 px-2.5 py-2"
            :style="{ left: layout.destX + 'px', top: layout.destY + 'px', width: NODE_W + 'px', height: DEST_H + 'px' }"
            :title="destination"
          >
            <p class="text-xs leading-snug line-clamp-6">{{ destination }}</p>
          </div>
        </template>
      </div>
    </div>

    <!-- Out of scope — beyond the destination, never graduates -->
    <div v-if="outOfScope.length" class="mt-3">
      <div class="mb-1.5 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted">
        <UIcon name="i-lucide-circle-off" class="size-3.5" />
        Out of scope
      </div>
      <div class="grid grid-cols-1 gap-2 opacity-70 md:grid-cols-2 xl:grid-cols-3">
        <p
          v-for="(o, i) in outOfScope"
          :key="i"
          class="rounded-md border border-dashed border-default px-2.5 py-1.5 text-xs leading-snug text-muted line-clamp-2"
          :title="o"
        >
          {{ o }}
        </p>
      </div>
    </div>
  </div>
</template>
