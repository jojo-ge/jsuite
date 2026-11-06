// The run plan as a graph — the Run setup tab's Graph view (RunPlanGraph.vue).
//
// A horizontal pipeline. The SPINE runs left to right through one node per
// step, from a Start node to an End node; the flow arrows ride on it, and so
// does the slice-report marker before every implement step after the first.
// Under an implement node hang its tickets: one card each, stacked in boxes —
// a box per orchestrator group (its subagents' runner in the header) and one
// for the tickets that run as their own agent. Merge, review and gate steps
// are a node on the spine and nothing below.
//
// Above the spine, a review's ARC shows what it reads: from the checkpoint
// (the Start node, or the end of an earlier step) over to the review node.
// Arcs that overlap stack into lanes, the shorter ones nearer the spine.
//
// Between cards, a BLOCKER edge joins a ticket to one it waits on in an
// earlier column; `ok` is false when the order is wrong (same or later step,
// or no merge between) — planProblems says the same in words.
//
// Pure: no Nuxt, no I/O — tests/runPlanGraph.test.ts. Running state (done /
// running / next) is the component's overlay, not the layout's business.
import {
  PLAN_START,
  groupRunnerOf,
  runnerLabel,
  runnerOf,
  soloTickets,
  stepGroupEntries,
  type PlanDispatch,
  type PlanStep,
  type RunPlan,
} from './runPlan'

/** What the graph needs to know about a ticket the plan names. */
export interface GraphTicketInfo {
  key: string
  title: string
  hitl: boolean
  paused: boolean
  finished: boolean
  /** Blocker keys (whatever the plan can name). */
  blockedBy: string[]
}

export interface GraphTicket {
  key: string
  title: string
  x: number
  y: number
  w: number
  h: number
  /** The step it runs in. */
  step: number
  /** Its orchestrator group within the step, or null for its own agent. */
  group: number | null
  runner: string
  hitl: boolean
  paused: boolean
  finished: boolean
  /** The plan names it but the project doesn't have it. */
  unknown: boolean
}

/** A box under an implement node: an orchestrator group, or the own-agent tickets. */
export interface GraphBox {
  step: number
  /** The orchestrator's index, or null for the own-agent box. */
  group: number | null
  x: number
  y: number
  w: number
  h: number
  label: string
  tickets: string[]
}

/** A step's node on the spine. */
export interface GraphNode {
  id: string
  index: number
  kind: PlanStep['kind']
  x: number
  y: number
  w: number
  h: number
  /** One line under the kind — who runs what / how many reviewers / the gate's note. */
  summary: string
  /** implement: an incoming slice report is read first. */
  readsSlice: boolean
  /** The column's width — what the step's boxes take below the node. */
  colW: number
}

export interface GraphReviewArc {
  stepIndex: number
  /** 0 = nearest the spine. */
  lane: number
  /** Where the arc leaves: the checkpoint node's right edge … */
  fromX: number
  /** … and where it lands: the review node's centre. */
  toX: number
  /** The arc's flat top. */
  laneY: number
  /** The y it leaves and lands at (the nodes' top edge). */
  nodeTop: number
  label: string
}

export interface GraphBlockerEdge {
  from: string
  to: string
  x1: number
  y1: number
  x2: number
  y2: number
  ok: boolean
}

export interface GraphFlowEdge {
  /** Node index it leaves (-1 = Start) … */
  from: number
  /** … and enters (plan.steps.length = End). */
  to: number
  x1: number
  x2: number
  y: number
  /** A slice report is written here, read by the step it enters. */
  slice: boolean
}

export interface RunPlanGraphLayout {
  width: number
  height: number
  /** The spine's y — every node's vertical centre. */
  spineY: number
  start: { x: number; y: number; w: number; h: number }
  end: { x: number; y: number; w: number; h: number }
  nodes: GraphNode[]
  boxes: GraphBox[]
  tickets: GraphTicket[]
  flows: GraphFlowEdge[]
  reviews: GraphReviewArc[]
  blockers: GraphBlockerEdge[]
}

export const GRAPH = {
  pad: 24,
  /** A step node on the spine. */
  nodeH: 60,
  /** An implement column — the node and the boxes under it. */
  implW: 232,
  /** A review / gate node. */
  nodeW: 168,
  /** A merge node — a compact pill; a long plan has one between most steps. */
  mergeW: 52,
  /** Between columns — room for the arrow and a slice marker. */
  gap: 60,
  startW: 96,
  endW: 128,
  /** One review-arc lane; lane 0 sits this far above the nodes. */
  laneH: 30,
  laneGap: 22,
  /** From the node's bottom to the first box. */
  drop: 20,
  boxHead: 26,
  boxPad: 8,
  boxGap: 12,
  cardH: 62,
  cardGap: 8,
} as const

const summaryOf = (s: PlanStep, fallback: PlanDispatch): string => {
  if (s.kind === 'implement') {
    const solo = soloTickets(s).length
    const groups = stepGroupEntries(s, fallback).length
    const parts: string[] = []
    if (solo) parts.push(`${solo} own agent${solo === 1 ? '' : 's'}`)
    if (groups) parts.push(`${groups} orchestrator${groups === 1 ? '' : 's'}`)
    return parts.join(' · ') || 'no tickets'
  }
  if (s.kind === 'review') {
    const c = s.review
    return `${s.reviewers} reviewers · ${runnerLabel({ model: c.model, effort: c.effort })}${c.arch ? ' · arch pass first' : ''}`
  }
  if (s.kind === 'gate') return s.note || 'waits for Continue'
  return 'lands the open PRs'
}

/**
 * Lay the plan out. `info` is every ticket the plan (or a blocker) can name;
 * a key the plan names but `info` lacks is drawn as unknown. `fallback` is
 * the run's dispatch, for steps without one. The drawing is as wide as the
 * pipeline needs — the component scrolls it.
 */
export function layoutRunPlan(plan: RunPlan, info: Record<string, GraphTicketInfo>, fallback: PlanDispatch): RunPlanGraphLayout {
  const { pad, nodeH } = GRAPH
  const arcs = reviewRanges(plan)
  const lanes = assignLanes(arcs)
  const laneCount = lanes.length ? Math.max(...lanes) + 1 : 0
  const nodeTop = pad + (laneCount ? GRAPH.laneGap + laneCount * GRAPH.laneH : 0)
  const spineY = nodeTop + nodeH / 2

  const nodes: GraphNode[] = []
  const boxes: GraphBox[] = []
  const tickets: GraphTicket[] = []
  const flows: GraphFlowEdge[] = []

  let x = pad
  const start = { x, y: nodeTop, w: GRAPH.startW, h: nodeH }
  x += GRAPH.startW
  let seenImplement = false
  let bottom = nodeTop + nodeH

  plan.steps.forEach((s, i) => {
    const readsSlice = s.kind === 'implement' && seenImplement
    flows.push({ from: i - 1, to: i, x1: x, x2: x + GRAPH.gap, y: spineY, slice: readsSlice })
    x += GRAPH.gap
    const colW = s.kind === 'implement' ? GRAPH.implW : s.kind === 'merge' ? GRAPH.mergeW : GRAPH.nodeW
    nodes.push({ id: s.id, index: i, kind: s.kind, x, y: nodeTop, w: colW, h: nodeH, summary: summaryOf(s, fallback), readsSlice, colW })
    if (s.kind === 'implement') {
      seenImplement = true
      const d = s.dispatch ?? fallback
      let by = nodeTop + nodeH + GRAPH.drop
      const cardW = colW - GRAPH.boxPad * 2
      const place = (keys: string[], group: number | null, label: string, runnerFor: (k: string) => string) => {
        const h = GRAPH.boxHead + GRAPH.boxPad + keys.length * (GRAPH.cardH + GRAPH.cardGap) - GRAPH.cardGap + GRAPH.boxPad
        boxes.push({ step: i, group, x, y: by, w: colW, h, label, tickets: keys })
        keys.forEach((k, n) => {
          const t = info[k]
          tickets.push({
            key: k,
            title: t?.title ?? '(unknown ticket)',
            x: x + GRAPH.boxPad,
            y: by + GRAPH.boxHead + GRAPH.boxPad + n * (GRAPH.cardH + GRAPH.cardGap),
            w: cardW,
            h: GRAPH.cardH,
            step: i,
            group,
            runner: runnerFor(k),
            hitl: !!t?.hitl,
            paused: !!t?.paused,
            finished: !!t?.finished,
            unknown: !t,
          })
        })
        by += h + GRAPH.boxGap
      }
      stepGroupEntries(s, d).forEach((g, gi) => place(g.tickets, gi, `Orchestrator ${gi + 1} · ${runnerLabel(g.runner)}`, () => runnerLabel(groupRunnerOf(s, g.tickets[0]!, d))))
      const solo = soloTickets(s)
      if (solo.length) place(solo, null, solo.length === 1 ? 'Own agent' : 'Own agents', (k) => runnerLabel(runnerOf(s, k, d)))
      bottom = Math.max(bottom, by - GRAPH.boxGap)
    }
    x += colW
  })

  flows.push({ from: plan.steps.length - 1, to: plan.steps.length, x1: x, x2: x + GRAPH.gap, y: spineY, slice: false })
  x += GRAPH.gap
  const end = { x, y: nodeTop, w: GRAPH.endW, h: nodeH }
  x += GRAPH.endW + pad

  const reviews: GraphReviewArc[] = arcs.map((a, n) => {
    const node = nodes[a.stepIndex]!
    const from = a.fromStep < 0 ? start : nodes[a.fromStep]!
    const lane = lanes[n]!
    return { stepIndex: a.stepIndex, lane, fromX: from.x + from.w, toX: node.x + node.w / 2, laneY: nodeTop - GRAPH.laneGap - lane * GRAPH.laneH, nodeTop, label: a.label }
  })

  const placed = new Map(tickets.map((t) => [t.key, t]))
  const mergeBetween = (from: number, to: number) => plan.steps.slice(from + 1, to).some((s) => s.kind === 'merge')
  const blockers: GraphBlockerEdge[] = []
  for (const t of tickets) {
    for (const b of info[t.key]?.blockedBy ?? []) {
      const from = placed.get(b)
      if (!from || from.key === t.key) continue
      const ok = from.step < t.step && mergeBetween(from.step, t.step)
      // Leaves the blocker's right edge, lands on the blocked card's left — or, in the same column, its top.
      const same = from.step === t.step
      blockers.push({
        from: b,
        to: t.key,
        x1: same ? from.x + from.w / 2 : from.x + from.w,
        y1: same ? from.y + from.h : from.y + from.h / 2,
        x2: same ? t.x + t.w / 2 : t.x,
        y2: same ? t.y : t.y + t.h / 2,
        ok,
      })
    }
  }

  return { width: x, height: bottom + pad, spineY, start, end, nodes, boxes, tickets, flows, reviews, blockers }
}

interface ReviewRange {
  stepIndex: number
  /** -1 = the plan start. */
  fromStep: number
  label: string
}

/** Each review step's range: which checkpoint it reads from (mirrors reviewBaseSha, by step rather than by sha). */
export function reviewRanges(plan: RunPlan): ReviewRange[] {
  const out: ReviewRange[] = []
  plan.steps.forEach((s, i) => {
    if (s.kind !== 'review') return
    let fromStep = -1
    let label = 'everything since the plan started'
    if (s.base && s.base !== PLAN_START) {
      const j = plan.steps.findIndex((x) => x.id === s.base)
      if (j >= 0 && j < i) {
        fromStep = j
        label = `changes since step ${j + 1}`
      }
    } else if (!s.base) {
      for (let j = i - 1; j >= 0; j--) {
        if (plan.steps[j]!.kind === 'review') {
          fromStep = j
          label = `changes since the review in step ${j + 1}`
          break
        }
      }
    }
    out.push({ stepIndex: i, fromStep, label })
  })
  return out
}

/**
 * Greedy interval packing: arcs whose step ranges overlap take different
 * lanes. One that starts where another ends (a review since the previous
 * review) shares its lane.
 */
function assignLanes(ranges: ReviewRange[]): number[] {
  const laneEnds: number[] = []
  return ranges.map((r) => {
    const lane = laneEnds.findIndex((end) => end <= r.fromStep)
    const use = lane < 0 ? laneEnds.length : lane
    laneEnds[use] = r.stepIndex
    return use
  })
}
