// Graphs — how a large piece of work is cut into reviewable slices and handed
// along: a stored, hand-built set of plan, build and review projects (nodes)
// joined by directed edges ("work passes from this project to that one").
// Any combination of project types is allowed, a project sits in at most one
// node of one graph, and a node may be PROPOSED (no project yet — it gets one
// when the human moves on into it).
//
// Nothing here gates anything. Before each node is one briefing covering all
// of its upstreams: what jTicket can look up itself (tickets, running work,
// roll-up PRs, reviews, the slice's size) plus `flags` — the things not in the
// expected state, as warnings. "Move on" (enter) always works; the briefing
// shown at that moment is kept on the node as a record.
//
// Machine-local: graphs never go on the share-sync wire. Cross-project ticket
// blockers are plain ticket facts and no longer make a graph (the one-time
// seed below turned the old derived graphs into stored ones).
//
// Pure: no Nuxt, no I/O — tests/graphs.test.ts. The facts a briefing reads are
// gathered by server/utils/graphs.ts and handed in already fetched.
import { OUTCOME_LABEL } from './autoLoop'
import { projectTypeLabel } from './projectType'

// ── The stored shape (store.graphs) ─────────────────────────────────────────

export interface GraphNode {
  id: string
  /** The project mode this node is or will be: 'plan' | 'planreview' | 'standard' | 'prreview' | … */
  mode: string
  /** null = proposed: no project yet. */
  projectId: string | null
  /** Shown while proposed; the project's own title wins once it exists. */
  title: string
  /** Why this node exists (the proposer's reasoning — for a build, what the slice is and how big). '' when hand-made. */
  note: string
  /** When the human pressed Move on into this node; null = not yet. */
  enteredAt: string | null
  /** Free text the human left at that moment. */
  enteredNote: string
  /** The briefing shown at that moment (a record — never re-read as live state). */
  enteredBriefing: unknown | null
  /** Build nodes: the upstream node this build stacks on; null = the default branch. */
  stackOn: string | null
}

export interface GraphEdge {
  from: string
  to: string
}

export interface Graph {
  id: string
  /** G-1 */
  key: string
  title: string
  description: string
  /** The codebase, like Project.repo. */
  repo: string
  nodes: GraphNode[]
  edges: GraphEdge[]
  createdAt: string
  updatedAt: string
}

export interface GraphProblem {
  /** The node it's about ('' = the graph as a whole). */
  nodeId: string
  message: string
}

/** The modes a node may name: every project mode, plus the plan review still to come. */
export const GRAPH_NODE_MODES = ['plan', 'planreview', 'standard', 'prreview', 'predeploy', 'todo'] as const

const str = (v: unknown) => (typeof v === 'string' ? v : '')
const strOrNull = (v: unknown) => (typeof v === 'string' && v ? v : null)

/** A node's mode as stored: a known mode, 'wayfinder' read as 'plan', anything else 'standard' (as the store coerces projects). */
export function coerceNodeMode(v: unknown): string {
  if (v === 'wayfinder') return 'plan'
  return (GRAPH_NODE_MODES as readonly string[]).includes(v as string) ? (v as string) : 'standard'
}

/** One stored node with its load-time defaults; null when it has no id. */
export function coerceGraphNode(raw: any): GraphNode | null {
  if (!raw || typeof raw !== 'object' || !str(raw.id)) return null
  return {
    id: raw.id,
    mode: coerceNodeMode(raw.mode),
    projectId: strOrNull(raw.projectId),
    title: str(raw.title),
    note: str(raw.note),
    enteredAt: strOrNull(raw.enteredAt),
    enteredNote: str(raw.enteredNote),
    enteredBriefing: raw.enteredBriefing ?? null,
    stackOn: strOrNull(raw.stackOn),
  }
}

/** Edges deduped, with self-loops and edges to unknown nodes left out. */
export function cleanEdges(raw: unknown, nodeIds: ReadonlySet<string>): GraphEdge[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const out: GraphEdge[] = []
  for (const e of raw) {
    const from = str(e?.from)
    const to = str(e?.to)
    if (!from || !to || from === to || !nodeIds.has(from) || !nodeIds.has(to)) continue
    const k = `${from}>${to}`
    if (seen.has(k)) continue
    seen.add(k)
    out.push({ from, to })
  }
  return out
}

/** A stored graph with its load-time defaults; null when it has no id. */
export function coerceGraph(raw: any): Graph | null {
  if (!raw || typeof raw !== 'object' || !str(raw.id)) return null
  const nodes = (Array.isArray(raw.nodes) ? raw.nodes : []).map(coerceGraphNode).filter((n: GraphNode | null): n is GraphNode => !!n)
  return {
    id: raw.id,
    key: str(raw.key),
    title: str(raw.title),
    description: str(raw.description),
    repo: str(raw.repo),
    nodes,
    edges: cleanEdges(raw.edges, new Set(nodes.map((n: GraphNode) => n.id))),
    createdAt: str(raw.createdAt),
    updatedAt: str(raw.updatedAt),
  }
}

/**
 * A whole-shape save (PUT /api/graphs/:id): the nodes and edges as sent,
 * merged onto the stored graph. A node without an id (or with one the graph
 * doesn't have) is new and gets `mint()`. What the shape owns is mode,
 * project, title, note and stackOn; the entered record (enteredAt, its note and
 * briefing) is only ever written by Move on, so it is kept from the stored
 * node — and dropped when the node now names a different project. Edges to
 * nodes not in the shape are left out and reported.
 */
export function mergeGraphShape(
  stored: Graph,
  raw: { nodes?: unknown; edges?: unknown },
  mint: () => string,
): { nodes: GraphNode[]; edges: GraphEdge[]; notes: GraphProblem[] } {
  const was = new Map(stored.nodes.map((n) => [n.id, n]))
  const sent = Array.isArray(raw.nodes) ? raw.nodes : stored.nodes
  const used = new Set<string>()
  const nodes: GraphNode[] = []
  for (const r of sent) {
    if (!r || typeof r !== 'object') continue
    const prev = str((r as any).id) && !used.has((r as any).id) ? was.get((r as any).id) : undefined
    const id = prev?.id ?? (str((r as any).id) && !used.has((r as any).id) && !was.has((r as any).id) ? (r as any).id : mint())
    used.add(id)
    const projectId = 'projectId' in (r as any) ? strOrNull((r as any).projectId) : (prev?.projectId ?? null)
    const keepEntered = prev && prev.projectId === projectId
    nodes.push({
      id,
      mode: coerceNodeMode((r as any).mode ?? prev?.mode),
      projectId,
      title: 'title' in (r as any) ? str((r as any).title).trim() : (prev?.title ?? ''),
      note: 'note' in (r as any) ? str((r as any).note) : (prev?.note ?? ''),
      stackOn: 'stackOn' in (r as any) ? strOrNull((r as any).stackOn) : (prev?.stackOn ?? null),
      enteredAt: keepEntered ? prev.enteredAt : null,
      enteredNote: keepEntered ? prev.enteredNote : '',
      enteredBriefing: keepEntered ? prev.enteredBriefing : null,
    })
  }
  const ids = new Set(nodes.map((n) => n.id))
  const rawEdges = Array.isArray(raw.edges) ? raw.edges : stored.edges
  const notes: GraphProblem[] = []
  for (const e of rawEdges as any[]) {
    const from = str(e?.from)
    const to = str(e?.to)
    if (from && to && (!ids.has(from) || !ids.has(to))) notes.push({ nodeId: '', message: `An edge ${from} → ${to} names a node that isn't in the graph — it was left out.` })
  }
  return { nodes, edges: cleanEdges(rawEdges, ids), notes }
}

// ── Lookups ─────────────────────────────────────────────────────────────────

/** The nodes with an edge into `nodeId`, in node order. */
export function upstreamIds(graph: Pick<Graph, 'nodes' | 'edges'>, nodeId: string): string[] {
  const from = new Set(graph.edges.filter((e) => e.to === nodeId).map((e) => e.from))
  return graph.nodes.filter((n) => from.has(n.id)).map((n) => n.id)
}

/** The nodes `nodeId` has an edge into, in node order. */
export function downstreamIds(graph: Pick<Graph, 'nodes' | 'edges'>, nodeId: string): string[] {
  const to = new Set(graph.edges.filter((e) => e.from === nodeId).map((e) => e.to))
  return graph.nodes.filter((n) => to.has(n.id)).map((n) => n.id)
}

/**
 * The upstream nodes of a node — the direct ones, or every ancestor with
 * `transitive` (nearest first) — optionally only those of one mode: "the
 * build this review follows" is upstreamNodes(g, review, { mode: 'standard' }).
 */
export function upstreamNodes(
  graph: Pick<Graph, 'nodes' | 'edges'>,
  nodeId: string,
  opts: { mode?: string; transitive?: boolean } = {},
): GraphNode[] {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]))
  const seen = new Set<string>([nodeId])
  const out: GraphNode[] = []
  let wave = upstreamIds(graph, nodeId)
  while (wave.length) {
    const next: string[] = []
    for (const id of wave) {
      if (seen.has(id)) continue
      seen.add(id)
      out.push(byId.get(id)!)
      if (opts.transitive) next.push(...upstreamIds(graph, id))
    }
    wave = next
  }
  return opts.mode ? out.filter((n) => n.mode === opts.mode) : out
}

/** The downstream nodes of a node (direct), optionally only one mode. */
export function downstreamNodes(graph: Pick<Graph, 'nodes' | 'edges'>, nodeId: string, opts: { mode?: string } = {}): GraphNode[] {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]))
  const out = downstreamIds(graph, nodeId).map((id) => byId.get(id)!)
  return opts.mode ? out.filter((n) => n.mode === opts.mode) : out
}

/** The graph and node a project sits in, or null. */
export function graphOfProject<G extends Pick<Graph, 'nodes'>>(graphs: G[], projectId: string): { graph: G; node: GraphNode } | null {
  for (const graph of graphs) {
    const node = graph.nodes.find((n) => n.projectId === projectId)
    if (node) return { graph, node }
  }
  return null
}

/**
 * A graph by what a person or an agent calls it: its id, its key (G-3, any
 * case), or the id or key of a project in it. The old derived ids
 * (G-<project key>) still resolve, through that project.
 */
export function resolveGraph<G extends Pick<Graph, 'id' | 'key' | 'nodes'>>(
  graphs: G[],
  projects: Array<{ id: string; key: string }>,
  ref: string,
): G | null {
  if (!ref) return null
  const up = ref.toUpperCase()
  const direct = graphs.find((g) => g.id === ref || g.key.toUpperCase() === up)
  if (direct) return direct
  const legacy = up.startsWith('G-') ? up.slice(2) : ''
  const project = projects.find((p) => p.id === ref || p.key.toUpperCase() === up || (legacy && p.key.toUpperCase() === legacy))
  return project ? (graphOfProject(graphs, project.id)?.graph ?? null) : null
}

// ── Validation ──────────────────────────────────────────────────────────────

/** A cycle in the edges as a node-id path that ends where it starts, or null. */
export function findCycle(graph: Pick<Graph, 'nodes' | 'edges'>): string[] | null {
  const state = new Map<string, 1 | 2>()
  const stack: string[] = []
  const visit = (id: string): string[] | null => {
    state.set(id, 1)
    stack.push(id)
    for (const next of downstreamIds(graph, id)) {
      if (state.get(next) === 1) return [...stack.slice(stack.indexOf(next)), next]
      if (!state.has(next)) {
        const found = visit(next)
        if (found) return found
      }
    }
    stack.pop()
    state.set(id, 2)
    return null
  }
  for (const n of graph.nodes) {
    if (state.has(n.id)) continue
    const found = visit(n.id)
    if (found) return found
  }
  return null
}

/** A node's name in messages: its project's key and title, or its own title. */
function nameOf(node: GraphNode, projects: Map<string, { key: string; title: string }>): string {
  const p = node.projectId ? projects.get(node.projectId) : undefined
  return p ? `${p.key} ${p.title}` : node.title || `an untitled ${projectTypeLabel(node.mode).toLowerCase()}`
}

/**
 * Everything wrong with a graph's shape — [] when it's sound. A shape with
 * problems is still saved (a draft may be half-built), like a run plan: the
 * problems come back beside it. `otherGraphs` is every other stored graph,
 * so a project already in one is caught.
 */
export function graphProblems(
  graph: Pick<Graph, 'id' | 'nodes' | 'edges'>,
  ctx: { projects: Array<{ id: string; key: string; title: string; mode: string }>; otherGraphs: Array<Pick<Graph, 'id' | 'key' | 'nodes'>> },
): GraphProblem[] {
  const problems: GraphProblem[] = []
  const projects = new Map(ctx.projects.map((p) => [p.id, p]))
  const byId = new Map(graph.nodes.map((n) => [n.id, n]))
  if (!graph.nodes.length) problems.push({ nodeId: '', message: 'The graph has no projects yet.' })

  const placed = new Map<string, string>()
  for (const n of graph.nodes) {
    const name = nameOf(n, projects)
    if (n.projectId) {
      const p = projects.get(n.projectId)
      if (!p) problems.push({ nodeId: n.id, message: `${n.title || 'A step'} names a project that no longer exists — pick another, or make it proposed.` })
      if (placed.has(n.projectId)) problems.push({ nodeId: n.id, message: `${name} is in this graph twice — a project sits in one node.` })
      placed.set(n.projectId, n.id)
      const elsewhere = ctx.otherGraphs.find((g) => g.id !== graph.id && g.nodes.some((x) => x.projectId === n.projectId))
      if (elsewhere) problems.push({ nodeId: n.id, message: `${name} is already in graph ${elsewhere.key} — a project sits in one graph.` })
    } else if (!n.title.trim()) {
      problems.push({ nodeId: n.id, message: `A proposed ${projectTypeLabel(n.mode).toLowerCase()} has no title.` })
    }
    if (n.stackOn) {
      const on = byId.get(n.stackOn)
      if (n.mode !== 'standard') problems.push({ nodeId: n.id, message: `${name} stacks on another project, but only a build stacks.` })
      else if (!on || !upstreamIds(graph, n.id).includes(on.id)) problems.push({ nodeId: n.id, message: `${name} stacks on a project that isn't directly before it.` })
      else if (on.mode !== 'standard') problems.push({ nodeId: n.id, message: `${name} stacks on ${nameOf(on, projects)}, which isn't a build — a build stacks on an upstream build's integration branch.` })
    }
  }

  const cycle = findCycle(graph)
  if (cycle) {
    const names = cycle.map((id) => nameOf(byId.get(id)!, projects))
    problems.push({ nodeId: cycle[0]!, message: `${names.join(' → ')} is a cycle — work in a graph only flows one way.` })
  }
  return problems
}

// ── Drawing ─────────────────────────────────────────────────────────────────

/** nodeId → layer: 0 for a node nothing leads into, else one past its furthest upstream. Cycle-safe. */
export function graphLayers(graph: Pick<Graph, 'nodes' | 'edges'>): Record<string, number> {
  const layer: Record<string, number> = {}
  const visiting = new Set<string>()
  const layerOf = (id: string): number => {
    if (id in layer) return layer[id]!
    if (visiting.has(id)) return 0
    visiting.add(id)
    const ups = upstreamIds(graph, id)
    const d = ups.length ? 1 + Math.max(...ups.map(layerOf)) : 0
    visiting.delete(id)
    return (layer[id] = d)
  }
  graph.nodes.forEach((n) => layerOf(n.id))
  return layer
}

/** The node ids row by row (a row per layer), in node order within a row. */
export function graphRows(graph: Pick<Graph, 'nodes' | 'edges'>): string[][] {
  const layer = graphLayers(graph)
  const rows: string[][] = []
  for (const n of graph.nodes) (rows[layer[n.id] ?? 0] ??= []).push(n.id)
  return rows.filter(Boolean)
}

/** "Start → End": the titles of the nodes nothing leads into, then of those that lead nowhere. */
export function graphName(graph: Pick<Graph, 'nodes' | 'edges'>, titleOf: (n: GraphNode) => string): string {
  if (!graph.nodes.length) return ''
  const starts = graph.nodes.filter((n) => !upstreamIds(graph, n.id).length)
  const ends = graph.nodes.filter((n) => !downstreamIds(graph, n.id).length)
  const s = (starts.length ? starts : [graph.nodes[0]!]).map(titleOf).join(', ')
  const e = (ends.length ? ends : [graph.nodes.at(-1)!]).map(titleOf).join(', ')
  return s === e ? s : `${s} → ${e}`
}

// ── Node state (informational only — nothing reads it as a gate) ────────────

/**
 * proposed: no project yet. finished: its project's work is done. entered:
 * the human moved on into it. waiting: not entered, and an upstream isn't
 * finished. ready: not entered, and every upstream is finished.
 */
export type GraphNodeState = 'proposed' | 'waiting' | 'ready' | 'entered' | 'finished'

export const NODE_STATE_LABEL: Record<GraphNodeState, string> = {
  proposed: 'Proposed',
  waiting: 'Waiting',
  ready: 'Ready',
  entered: 'Moved on',
  finished: 'Finished',
}

export function nodeStates(graph: Pick<Graph, 'nodes' | 'edges'>, finished: (node: GraphNode) => boolean): Record<string, GraphNodeState> {
  const done = new Map(graph.nodes.map((n) => [n.id, !!n.projectId && finished(n)]))
  const out: Record<string, GraphNodeState> = {}
  for (const n of graph.nodes) {
    if (!n.projectId) out[n.id] = 'proposed'
    else if (done.get(n.id)) out[n.id] = 'finished'
    else if (n.enteredAt) out[n.id] = 'entered'
    else out[n.id] = upstreamIds(graph, n.id).every((u) => done.get(u)) ? 'ready' : 'waiting'
  }
  return out
}

// ── The API's view (GET /api/graphs, /api/graphs/:id) ──────────────────────

export interface GraphNodeView extends Omit<GraphNode, 'enteredBriefing'> {
  /** The project's title once it exists, else the node's. */
  title: string
  type: string
  layer: number
  state: GraphNodeState
  project: { id: string; key: string; title: string; mode: string; url: string; integrationBranch: string } | null
  tickets: { total: number; done: number; inProgress: number }
  running: boolean
  outcomeDoc: string | null
  /** Build nodes, on the single-graph view: the slice's size (undefined on the list). */
  slice?: SliceFact
  /** Build nodes: other projects on the same integration branch (branchSharers) — then `slice` is the branch's, not this build's. */
  sharedWith?: string[]
  /** On the single-graph view: the briefing kept from Move on. */
  enteredBriefing?: unknown | null
}

export interface GraphView extends Omit<Graph, 'nodes'> {
  name: string
  url: string
  nodes: GraphNodeView[]
  problems: GraphProblem[]
}

/**
 * Whether a project's work is done, as a graph sees it: a review once its
 * latest review is back; anything else once it has tickets, all finished,
 * and its auto mode is off.
 */
export function projectWorkFinished(
  project: {
    mode: string
    auto?: { enabled?: boolean } | null
    prReview?: { runs?: Array<{ status: string }> } | null
    planReview?: { runs?: Array<{ status: string }> } | null
  },
  tickets: Array<{ status: string }>,
): boolean {
  if (project.mode === 'prreview') return project.prReview?.runs?.at(-1)?.status === 'done'
  if (project.mode === 'planreview') return project.planReview?.runs?.at(-1)?.status === 'done'
  return !project.auto?.enabled && tickets.length > 0 && tickets.every((t) => t.status === 'done' || t.status === 'merged')
}

/** A project's outcome report — its latest 'outcome'-labelled doc, or null. */
export function outcomeDocOf<D extends { projectId: string | null; labels: string[]; updatedAt: string }>(docs: D[], projectId: string): D | null {
  return (
    docs
      .filter((d) => d.projectId === projectId && d.labels.includes(OUTCOME_LABEL))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0] ?? null
  )
}

/** A node's note as markdown: it is written line by line (**Slice:** / **Size:** / …), so a single newline is a line break. */
export const noteMarkdown = (md: string) => md.replace(/([^\n])\n(?!\n)/g, '$1  \n')

// ── Slice size ──────────────────────────────────────────────────────────────

/**
 * A build's slice is reviewable in one sitting below these: past either, the
 * briefing before its review says it's large. ~800 changed lines is about
 * what a person reads carefully in an hour; 30 files is where a review stops
 * holding the whole change in its head.
 */
export const SLICE_LARGE_LINES = 800
export const SLICE_LARGE_FILES = 30

/** A build's integration branch against its base: unknown (git hasn't answered), none (no diff yet, and why), or its size. */
export type SliceFact =
  | { state: 'unknown' }
  | { state: 'none'; reason: string }
  | { state: 'ok'; files: number; additions: number; deletions: number; base: string }

export const sliceIsLarge = (s: SliceFact) => s.state === 'ok' && (s.files > SLICE_LARGE_FILES || s.additions + s.deletions > SLICE_LARGE_LINES)

/** "12 files · +340 −80", or what stands in for it. */
export function sliceLabel(s: SliceFact): string {
  if (s.state === 'unknown') return 'size unknown'
  if (s.state === 'none') return 'no diff yet'
  return `${s.files} file${s.files === 1 ? '' : 's'} · +${s.additions} −${s.deletions}`
}

/**
 * The keys of the other projects that use the same integration branch in the
 * same codebase. A build sharing its branch has no slice of its own: the
 * branch's diff is everyone's work together, so it must not be shown as this
 * build's size (three builds on one branch would each show the same number).
 */
export function branchSharers(
  projects: ReadonlyArray<{ id: string; key: string; repo: string; integrationBranch: string; mode: string }>,
  project: { id: string; repo: string; integrationBranch: string },
): string[] {
  const branch = project.integrationBranch.trim()
  if (!branch) return []
  const repo = project.repo.trim().replace(/\/+$/, '')
  return projects
    .filter((p) => p.id !== project.id && p.mode === 'standard' && p.integrationBranch.trim() === branch && p.repo.trim().replace(/\/+$/, '') === repo)
    .map((p) => p.key)
}

/** How a build's size reads where it is shown: its own slice, or — on a shared branch — the branch's, said to be shared. */
export function sliceDisplay(s: SliceFact, sharedWith: readonly string[] = []): { text: string; title: string; large: boolean; shared: boolean } {
  const shared = sharedWith.length > 0
  if (!shared) return { text: sliceLabel(s), title: s.state === 'none' ? s.reason : s.state === 'ok' ? `against ${s.base}` : '', large: sliceIsLarge(s), shared }
  const with_ = sharedWith.join(', ')
  return {
    text: `branch shared with ${with_}`,
    title: `Its integration branch is shared with ${with_}, so this build has no slice of its own${s.state === 'ok' ? ` — the branch as a whole: ${sliceLabel(s)} against ${s.base}` : ''}.`,
    large: false,
    shared,
  }
}

// ── The briefing ────────────────────────────────────────────────────────────

/** The roll-up PR as GitHub (through the cache) last said — 'unknown' when it hasn't answered yet. */
export interface RollupFact {
  state: 'no-branch' | 'unknown' | 'none' | 'open' | 'merged' | 'closed'
  number?: number
  url?: string
  base?: string
  ci: 'unknown' | 'none' | 'passed' | 'failed' | 'pending'
  /** state 'unknown' because GitHub couldn't be asked at all (gh failed — e.g. the repo isn't on GitHub), not because it is slow: asking again won't help. */
  error?: string
}

/** The integration branch against its base — "stacking"'s integrationBranchState; known: false without a branch here. null = couldn't count. */
export type BranchFact =
  | { known: false }
  | { known: true; base: string; behind: number | null; ahead: number | null; unpushed: number | null; baseExists: boolean; upstreamMerged: boolean }

/** Everything the briefing reads about one project, already fetched. */
export interface ProjectFacts {
  id: string
  key: string
  title: string
  mode: string
  tickets: { total: number; done: number; open: number; inProgress: string[]; hitlOpen: string[] }
  auto: boolean
  integrationBranch: string
  /** '' = the default branch. */
  integrationBase: string
  outcomeDoc: string | null
  /** Review projects (PR and plan reviews): the latest review's verdict and the findings still open. */
  review: { runs: number; running: boolean; verdict: string; openFindings: number } | null
  /** Plan projects: what its ticket plan holds — drafts, builds (and how many are still proposed), its spec doc — and whether a session is still drafting it. Its drafts are not in `tickets`. */
  plan?: PlanFact | null
  /** Other projects on the same integration branch (branchSharers); [] = the branch is this build's own. */
  sharedWith?: string[]
  /** Open tickets of this project blocked by open tickets outside the graph. */
  blockedOutside: Array<{ ticket: string; blocker: string }>
  rollup: RollupFact
  branch: BranchFact
  slice: SliceFact
}

/** A plan project's ticket plan and spec, as a briefing reads them. */
export interface PlanFact {
  drafts: number
  builds: number
  proposedBuilds: number
  /** The plan's `spec`-labelled doc (DOC-n), or null. */
  specDoc: string | null
  drafting: boolean
}

/** The review modes — the upstreams a briefing reads a verdict and open findings off. */
const REVIEW_MODES = new Set(['prreview', 'planreview'])

export interface BriefingFlag {
  level: 'warning' | 'info'
  /** The node it's about (an upstream, or the node itself); null = the gate as a whole. */
  nodeId: string | null
  message: string
}

export interface BriefingUpstream {
  nodeId: string
  title: string
  mode: string
  type: string
  proposed: boolean
  enteredAt: string | null
  /** Null while proposed. */
  project: ProjectFacts | null
}

export interface Briefing {
  graph: { id: string; key: string; title: string }
  node: { id: string; title: string; mode: string; type: string; proposed: boolean; enteredAt: string | null; stackOn: string | null }
  /** The node's own project, when it has one. */
  project: ProjectFacts | null
  upstreams: BriefingUpstream[]
  /** Build nodes: the base it would start from, and the upstream builds it could stack on. */
  base: { stackOn: string | null; branch: string; label: string; options: Array<{ nodeId: string; title: string; projectKey: string | null; branch: string }> } | null
  flags: BriefingFlag[]
  /** Some GitHub or git fact had no answer yet ('unknown' above) — ask again shortly. */
  incomplete: boolean
  at: string
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`
const BAD_VERDICTS: Record<string, string> = { 'request-changes': 'changes needed', 'needs-discussion': 'needs discussion' }

/**
 * Assemble the briefing in front of a node from facts already fetched.
 * `facts` holds the facts of every node project it may need (keyed by
 * project id); `stackOn` overrides the node's stored choice (the Move on
 * dialog's pick). Never refuses anything — everything odd is a flag.
 */
export function assembleBriefing(input: {
  graph: Graph
  nodeId: string
  facts: Map<string, ProjectFacts>
  titleOf?: (node: GraphNode) => string
  stackOn?: string | null
  at: string
}): Briefing {
  const { graph, facts } = input
  const node = graph.nodes.find((n) => n.id === input.nodeId)
  if (!node) throw new Error(`no node ${input.nodeId} in ${graph.key}`)
  const factsOf = (n: GraphNode) => (n.projectId ? (facts.get(n.projectId) ?? null) : null)
  const titleOf = (n: GraphNode) => factsOf(n)?.title || input.titleOf?.(n) || n.title
  const flags: BriefingFlag[] = []
  const warn = (nodeId: string | null, message: string) => flags.push({ level: 'warning', nodeId, message })
  const info = (nodeId: string | null, message: string) => flags.push({ level: 'info', nodeId, message })
  let incomplete = false

  const ups = upstreamNodes(graph, node.id)
  const upstreams: BriefingUpstream[] = ups.map((u) => ({
    nodeId: u.id,
    title: titleOf(u),
    mode: u.mode,
    type: projectTypeLabel(u.mode),
    proposed: !u.projectId,
    enteredAt: u.enteredAt,
    project: factsOf(u),
  }))
  const self = factsOf(node)

  // ── Every upstream, whatever comes next ──
  for (const u of upstreams) {
    const name = u.project?.key ? `${u.project.key} ${u.title}` : u.title
    if (u.proposed) {
      warn(u.nodeId, `${name} is still proposed — it has no project yet.`)
      continue
    }
    if (!u.project) continue
    const p = u.project
    if (!u.enteredAt) info(u.nodeId, `${name} was never moved on into.`)
    if (p.tickets.inProgress.length) warn(u.nodeId, `${name} still has work running: ${p.tickets.inProgress.join(', ')} in progress.`)
    if (p.auto) warn(u.nodeId, `${name}'s auto mode is still on.`)
    if (REVIEW_MODES.has(u.mode)) {
      if (!p.review?.runs) warn(u.nodeId, `${name} hasn't run a review yet.`)
      else if (p.review.running) warn(u.nodeId, `${name}'s review is still running.`)
      else if (BAD_VERDICTS[p.review.verdict]) warn(u.nodeId, `${name}'s verdict: ${BAD_VERDICTS[p.review.verdict]}.`)
      if (p.review?.openFindings) warn(u.nodeId, `${name} has ${plural(p.review.openFindings, 'finding')} still open.`)
    } else if (p.tickets.open) {
      warn(u.nodeId, `${name} has ${plural(p.tickets.open, 'open ticket')} of ${p.tickets.total}.`)
    } else if (!p.tickets.total) {
      warn(u.nodeId, `${name} has no tickets.`)
    }
  }

  const builds = upstreams.filter((u) => u.mode === 'standard' && u.project)
  const rollupFlags = (u: BriefingUpstream, forReview: boolean) => {
    const p = u.project!
    const name = `${p.key} ${u.title}`
    const r = p.rollup
    if (r.state === 'unknown' && r.error) {
      warn(u.nodeId, `Couldn't ask GitHub about ${name}'s roll-up PR: ${r.error}`)
    } else if (r.state === 'unknown') {
      incomplete = true
      info(u.nodeId, `GitHub hasn't answered yet about ${name}'s roll-up PR.`)
    } else if (r.state === 'no-branch') warn(u.nodeId, `${name} has no integration branch, so no roll-up PR.`)
    else if (r.state === 'none') warn(u.nodeId, forReview ? `${name} has no roll-up PR open on GitHub — the review starts with no PR attached; pick one on its page.` : `${name} has no roll-up PR on GitHub yet.`)
    else if (r.state === 'closed') warn(u.nodeId, `${name}'s roll-up PR #${r.number} was closed without merging.`)
    if (r.state === 'open') {
      if (r.ci === 'failed') warn(u.nodeId, `${name}'s roll-up PR #${r.number} has failing checks.`)
      else if (r.ci === 'pending') info(u.nodeId, `${name}'s roll-up PR #${r.number} still has checks running.`)
      else if (r.ci === 'unknown') incomplete = true
    }
  }

  // ── Before a build ──
  let base: Briefing['base'] = null
  if (node.mode === 'standard') {
    for (const u of builds) rollupFlags(u, false)
    const stackOn = input.stackOn !== undefined ? input.stackOn : node.stackOn
    const on = stackOn ? builds.find((u) => u.nodeId === stackOn) : undefined
    if (stackOn && !on) warn(node.id, 'This build stacks on something that isn\'t a build with a project directly before it — it would start from the default branch.')
    const options = builds.map((u) => ({ nodeId: u.nodeId, title: u.title, projectKey: u.project!.key, branch: u.project!.integrationBranch }))
    base = {
      stackOn: on ? on.nodeId : null,
      branch: on ? on.project!.integrationBranch : '',
      label: on ? on.project!.integrationBranch || `${on.project!.key}'s integration branch (not cut yet)` : 'the default branch',
      options,
    }
    if (on && !on.project!.integrationBranch) {
      warn(on.nodeId, `${on.project!.key} has no integration branch to stack on yet — moving on leaves ${self ? `${self.key}'s` : 'this build\'s'} base at the default branch. Cut ${on.project!.key}'s branch first, or pick the base when you cut this build's.`)
    }
    if (on?.project!.rollup.state === 'merged') info(on.nodeId, `${on.project!.key}'s roll-up PR is already merged — its work is on the default branch, so stacking on it isn't needed.`)
    for (const u of builds) {
      if (u.nodeId === on?.nodeId) continue
      const s = u.project!.rollup.state
      if (s === 'merged' || s === 'unknown') continue
      warn(u.nodeId, on
        ? `This build stacks on ${on.project!.key} while ${u.project!.key} isn't merged — ${u.project!.key}'s work won't be in its base.`
        : `This build starts from the default branch, but ${u.project!.key} isn't merged — its work won't be there.`)
    }
    if (self && !self.integrationBranch && on?.project!.integrationBranch) info(node.id, `Moving on sets ${self.key}'s base to ${on.project!.integrationBranch || on.project!.key}; its integration branch is cut from there.`)
    if (self && self.integrationBranch && on && self.integrationBase !== on.project!.integrationBranch) {
      warn(node.id, `${self.key} already has its integration branch (from ${self.integrationBase || 'the default branch'}) — moving on won't change its base.`)
    }
    if (self) {
      if (!self.tickets.total) warn(node.id, `${self.key} has no tickets yet.`)
      if (self.sharedWith?.length) info(node.id, `${self.key} shares its integration branch ${self.integrationBranch} with ${self.sharedWith.join(', ')} — their work lands in one roll-up PR, not a slice of its own.`)
      if (self.tickets.hitlOpen.length) info(node.id, `${plural(self.tickets.hitlOpen.length, 'HITL ticket')} waiting on you: ${self.tickets.hitlOpen.join(', ')}.`)
      for (const b of self.blockedOutside) warn(node.id, `${b.ticket} is blocked by ${b.blocker}, outside this graph.`)
    }
  }

  // ── Before a review that follows a build ──
  if (node.mode === 'prreview') {
    for (const u of builds) {
      const p = u.project!
      const name = `${p.key} ${u.title}`
      rollupFlags(u, true)
      if (p.branch.known) {
        if (!p.branch.baseExists) warn(u.nodeId, `${name}'s base ${p.branch.base || 'branch'} no longer exists${p.branch.upstreamMerged ? ' — its upstream looks merged; sync it from upstream' : ''}.`)
        if (p.branch.behind) warn(u.nodeId, `${name}'s integration branch is ${plural(p.branch.behind, 'commit')} behind its base.`)
        if (p.branch.unpushed) warn(u.nodeId, `${name} has ${plural(p.branch.unpushed, 'unpushed commit')} — the roll-up PR doesn't show them.`)
      } else if (p.integrationBranch) incomplete = true
      if (!p.outcomeDoc) info(u.nodeId, `${name} has no outcome report yet.`)
      const sharers = p.sharedWith ?? []
      if (sharers.length) {
        warn(u.nodeId, `${name} shares its integration branch ${p.integrationBranch} with ${sharers.join(', ')} — it has no slice of its own: the branch's diff${p.slice.state === 'ok' ? ` (${sliceLabel(p.slice)})` : ''} is their work together, and a review of it reviews all of them.`)
      } else if (p.slice.state === 'unknown') {
        incomplete = true
        info(u.nodeId, `${name}'s slice size isn't known yet.`)
      } else if (p.slice.state === 'none') info(u.nodeId, `${name} has no diff yet (${p.slice.reason}).`)
      else if (sliceIsLarge(p.slice)) {
        warn(u.nodeId, `${name}'s slice is large — ${sliceLabel(p.slice)} (reviewable is under ${SLICE_LARGE_FILES} files and ${SLICE_LARGE_LINES} lines). Consider splitting it into stacked builds.`)
      }
    }
    if (!builds.length) info(node.id, 'No build leads into this review.')
  }

  // ── Before a plan review: what there is to review ──
  if (node.mode === 'planreview') {
    const plans = upstreams.filter((u) => u.mode === 'plan' && u.project)
    for (const u of plans) {
      const p = u.project!
      const name = `${p.key} ${u.title}`
      const plan = p.plan
      if (!plan) continue
      if (plan.drafting) warn(u.nodeId, `A session is still drafting ${name}'s ticket plan — the review would read it half-written.`)
      if (!plan.drafts && !plan.builds) warn(u.nodeId, `${name} has no ticket plan yet — draft it (its Ticket plan tab) before reviewing it.`)
      else {
        if (plan.drafts) info(u.nodeId, `${name}'s ticket plan: ${plural(plan.drafts, 'draft')} across ${plural(plan.builds, 'build')}${plan.proposedBuilds ? ` (${plan.proposedBuilds} still proposed)` : ''}.`)
        if (plan.builds && !plan.drafts) warn(u.nodeId, `${name}'s builds have no draft tickets left on the plan — approved already, so the review reads tickets that are now in the build projects.`)
      }
      if (plan.specDoc) info(u.nodeId, `${name}'s spec is ${plan.specDoc}.`)
      else warn(u.nodeId, `${name} has no spec doc (a doc labelled spec) — the reviewers read only its map and tickets.`)
    }
    if (!plans.length) info(node.id, 'No plan leads into this plan review — pick the plan on its Review tab after moving on.')
  }

  if (!node.projectId) info(node.id, `Moving on creates the ${projectTypeLabel(node.mode).toLowerCase()} project.`)
  if (node.enteredAt) info(node.id, `You moved on into this on ${node.enteredAt.slice(0, 10)}.`)
  if (!upstreams.length) info(node.id, 'Nothing comes before this in the graph.')

  return {
    graph: { id: graph.id, key: graph.key, title: graph.title },
    node: { id: node.id, title: titleOf(node), mode: node.mode, type: projectTypeLabel(node.mode), proposed: !node.projectId, enteredAt: node.enteredAt, stackOn: node.stackOn },
    project: self,
    upstreams,
    base,
    flags,
    incomplete,
    at: input.at,
  }
}

// ── The one-time seed ───────────────────────────────────────────────────────

/**
 * What the Graphs page used to derive and the store now holds: each
 * connected group of non-review projects linked by cross-project ticket
 * blockers, as nodes (entered at their project's creation) and edges (one per
 * linked project pair, blocker's project → blocked's). Run once, when the
 * store has no `graphs` yet; nothing derives graphs after that.
 */
export function seedGraphsFromBlockers(
  projects: Array<{ id: string; title: string; mode: string; repo: string; createdAt: string }>,
  tickets: Array<{ id: string; projectId: string | null; blockedBy: string[] }>,
  mint: () => string,
  at: string,
): Array<Omit<Graph, 'key'>> {
  const byId = new Map(projects.filter((p) => p.mode !== 'prreview').map((p) => [p.id, p]))
  const projectOf = new Map(tickets.map((t) => [t.id, t.projectId]))
  const links = new Map<string, GraphEdge>()
  for (const t of tickets) {
    if (!t.projectId || !byId.has(t.projectId)) continue
    for (const b of t.blockedBy) {
      const from = projectOf.get(b)
      if (from && from !== t.projectId && byId.has(from)) links.set(`${from}>${t.projectId}`, { from, to: t.projectId })
    }
  }
  const adj = new Map<string, Set<string>>()
  const touch = (a: string, b: string) => (adj.get(a) ?? adj.set(a, new Set()).get(a)!).add(b)
  for (const l of links.values()) touch(l.from, l.to), touch(l.to, l.from)
  const byCreated = (a: string, b: string) => byId.get(a)!.createdAt.localeCompare(byId.get(b)!.createdAt) || a.localeCompare(b)
  const seen = new Set<string>()
  const out: Array<Omit<Graph, 'key'>> = []
  for (const start of [...adj.keys()].sort(byCreated)) {
    if (seen.has(start)) continue
    const members: string[] = []
    const queue = [start]
    seen.add(start)
    while (queue.length) {
      const id = queue.shift()!
      members.push(id)
      for (const n of adj.get(id) ?? []) if (!seen.has(n)) seen.add(n), queue.push(n)
    }
    members.sort(byCreated)
    const nodeOf = new Map(members.map((pid) => [pid, mint()]))
    const nodes: GraphNode[] = members.map((pid) => {
      const p = byId.get(pid)!
      return { id: nodeOf.get(pid)!, mode: coerceNodeMode(p.mode), projectId: pid, title: p.title, note: '', enteredAt: p.createdAt, enteredNote: '', enteredBriefing: null, stackOn: null }
    })
    const edges = [...links.values()].filter((l) => nodeOf.has(l.from)).map((l) => ({ from: nodeOf.get(l.from)!, to: nodeOf.get(l.to)! }))
    const shape = { nodes, edges }
    out.push({
      id: mint(),
      title: graphName(shape, (n) => n.title),
      description: 'Made from the cross-project ticket blockers that linked these projects before graphs were stored.',
      repo: byId.get(members[0]!)!.repo,
      ...shape,
      createdAt: at,
      updatedAt: at,
    })
  }
  return out
}

// ── The menu (/graphs) and links to a graph ─────────────────────────────────

/** Where a graph lives: /graphs/G-2, with ?node= to open one node's briefing. */
export function graphUrl(key: string, nodeId?: string | null): string {
  return `/graphs/${encodeURIComponent(key)}${nodeId ? `?node=${encodeURIComponent(nodeId)}` : ''}`
}

/** One step of a graph's type chain: the types of one layer (or a run of layers of one type), with counts. */
export type GraphChainStep = Array<{ mode: string; type: string; count: number }>

type SummaryNode = Pick<GraphNodeView, 'id' | 'mode' | 'title' | 'state' | 'running' | 'enteredAt'> & { project: { key: string } | null }

/** What a card on the menu says about a graph, so the human can pick the right one at a glance. */
export interface GraphSummary {
  total: number
  states: Record<GraphNodeState, number>
  /** Nodes moved on into (finished ones included). */
  entered: number
  finished: number
  proposed: number
  /** Nodes whose project has work in progress or auto mode on. */
  running: number
  /** Every node finished. */
  done: boolean
  /** The project types in the order work flows, layer by layer. */
  chain: GraphChainStep[]
  /** "Plan → Plan review → Build ×3 → Review ×3" */
  chainLabel: string
  /**
   * Where the graph is now: the nodes moved on into and not finished, and the
   * ones ready to move on into. When there are none (and it isn't done), the
   * proposed nodes whose upstreams are all finished — what comes next.
   */
  now: Array<{ nodeId: string; title: string; state: GraphNodeState; projectKey: string | null }>
  /** The latest of the graph's own edits, every Move on, and `activity` (e.g. its projects' and tickets' updatedAt). */
  lastChanged: string
}

const stepLabel = (step: GraphChainStep) => step.map((p) => `${p.type}${p.count > 1 ? ` ×${p.count}` : ''}`).join(' + ')

/**
 * The types a graph chains, layer by layer: each layer's types (with counts,
 * in node order), and a run of layers that are all one type folded into one
 * step — three stacked builds read "Build ×3", not "Build → Build → Build".
 */
export function graphChain(graph: { nodes: Array<Pick<GraphNode, 'id' | 'mode'>>; edges: GraphEdge[] }): GraphChainStep[] {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]))
  const steps: GraphChainStep[] = []
  for (const row of graphRows(graph as Pick<Graph, 'nodes' | 'edges'>)) {
    const step: GraphChainStep = []
    for (const id of row) {
      const mode = byId.get(id)!.mode
      const part = step.find((p) => p.mode === mode)
      if (part) part.count++
      else step.push({ mode, type: projectTypeLabel(mode), count: 1 })
    }
    const prev = steps.at(-1)
    if (prev?.length === 1 && step.length === 1 && prev[0]!.mode === step[0]!.mode) prev[0]!.count += step[0]!.count
    else steps.push(step)
  }
  return steps
}

export function graphSummary(
  graph: { nodes: SummaryNode[]; edges: GraphEdge[]; createdAt: string; updatedAt: string },
  activity: string[] = [],
): GraphSummary {
  const states = { proposed: 0, waiting: 0, ready: 0, entered: 0, finished: 0 } as Record<GraphNodeState, number>
  for (const n of graph.nodes) states[n.state]++
  const layer = graphLayers(graph as unknown as Pick<Graph, 'nodes' | 'edges'>)
  const byFlow = graph.nodes.map((n, i) => ({ n, i })).sort((a, b) => (layer[a.n.id] ?? 0) - (layer[b.n.id] ?? 0) || a.i - b.i).map((x) => x.n)
  const brief = (n: SummaryNode) => ({ nodeId: n.id, title: n.title, state: n.state, projectKey: n.project?.key ?? null })
  const done = graph.nodes.length > 0 && states.finished === graph.nodes.length
  const finished = new Set(graph.nodes.filter((n) => n.state === 'finished').map((n) => n.id))
  let now = byFlow.filter((n) => n.state === 'entered' || n.state === 'ready').map(brief)
  if (!now.length && !done) {
    now = byFlow.filter((n) => n.state === 'proposed' && upstreamIds(graph as unknown as Pick<Graph, 'nodes' | 'edges'>, n.id).every((u) => finished.has(u))).map(brief)
  }
  const chain = graphChain(graph)
  const times = [graph.createdAt, graph.updatedAt, ...graph.nodes.map((n) => n.enteredAt ?? ''), ...activity].filter(Boolean)
  return {
    total: graph.nodes.length,
    states,
    entered: graph.nodes.filter((n) => n.enteredAt).length,
    finished: states.finished,
    proposed: states.proposed,
    running: graph.nodes.filter((n) => n.running).length,
    done,
    chain,
    chainLabel: chain.map(stepLabel).join(' → '),
    now,
    lastChanged: times.reduce((a, b) => (b > a ? b : a), ''),
  }
}

/**
 * A compact drawing of a graph's shape for its card: the same layering as
 * the full drawing (a row per layer, top → bottom, each row centred), in grid
 * units — `cols` wide (the widest row), `rows` tall; a node's x/y is the
 * centre of its cell.
 */
export function graphThumbnail(graph: Pick<Graph, 'nodes' | 'edges'>): {
  cols: number
  rows: number
  nodes: Array<{ id: string; x: number; y: number }>
  edges: Array<{ from: string; to: string; x1: number; y1: number; x2: number; y2: number }>
} {
  const grid = graphRows(graph)
  const cols = Math.max(1, ...grid.map((r) => r.length))
  const pos = new Map<string, { x: number; y: number }>()
  grid.forEach((row, r) => row.forEach((id, i) => pos.set(id, { x: (cols - row.length) / 2 + i + 0.5, y: r + 0.5 })))
  return {
    cols,
    rows: Math.max(1, grid.length),
    nodes: graph.nodes.map((n) => ({ id: n.id, ...pos.get(n.id)! })),
    edges: graph.edges
      .filter((e) => pos.has(e.from) && pos.has(e.to))
      .map((e) => ({ ...e, x1: pos.get(e.from)!.x, y1: pos.get(e.from)!.y, x2: pos.get(e.to)!.x, y2: pos.get(e.to)!.y })),
  }
}
