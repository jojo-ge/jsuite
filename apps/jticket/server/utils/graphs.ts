// Graphs on the server: the API's view of a stored graph, the facts a
// briefing reads (tickets, running work, the roll-up PR, the review, the
// slice's size) and the two writes beyond plain edits — creating a proposed
// node's project, and Move on (enter). The rules and the briefing's words are
// app/utils/graphs.ts; this file only fetches and stores.
//
// GitHub and git facts are best-effort and time-boxed: a briefing or a graph
// view never waits on gh past FACT_WAIT_MS. A fact with no answer by then
// reads 'unknown' (and the fetch carries on into the cache, so asking again
// shortly gets it) — never a guess.
import {
  assembleBriefing,
  branchSharers,
  noteMarkdown,
  graphLayers,
  graphName,
  graphUrl,
  graphProblems,
  mergeGraphShape,
  nodeStates,
  outcomeDocOf,
  projectWorkFinished,
  resolveGraph,
  graphOfProject,
  upstreamNodes,
  downstreamNodes,
  type Briefing,
  type BriefingFlag,
  type BranchFact,
  type Graph,
  type GraphNode,
  type GraphProblem,
  type GraphNodeView,
  type GraphView,
  type ProjectFacts,
  type RollupFact,
  type SliceFact,
} from '../../app/utils/graphs'
import { projectTypeLabel } from '../../app/utils/projectType'
import { ghCached, ghKey } from './ghCache'
import { resolveRepoDir, run } from './github'
import { integrationBranchState, type IntegrationBranchState } from './integrationBase'
import { currentId, findByRef } from './ids'
import { attachPrToReviewProject, createUnattachedReviewProject, findPrReviewProject } from './prReview'
import { createPlanReviewProject, findPlanReviewProject, planFactOf } from './planReview'
import { isDraftTicket } from '../../app/utils/ticketPlan'
import { reviewedUpstream, rollupToAttach } from '../../app/utils/reviewHandoff'
import { isFinishedStatus, loadStore, newId, nextKey, now, rememberRepo, saveStore, type Project, type Store } from './store'
import { expandHome } from './github'

/** How long a page waits on any one GitHub or git fact before calling it unknown. */
export const FACT_WAIT_MS = 1500
/** How long Move on into a Review node waits on GitHub for the build's roll-up PR before making the review unattached. */
const ATTACH_WAIT_MS = 10_000

const notFound = (what: string) => createError({ statusCode: 404, statusMessage: what })
const bad = (statusMessage: string) => createError({ statusCode: 400, statusMessage })

/** The promise's answer, or `fallback` once `ms` have passed (the promise runs on, filling its cache). */
function within<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(fallback), ms)
    p.then(
      (v) => (clearTimeout(timer), resolve(v)),
      () => (clearTimeout(timer), resolve(fallback)),
    )
  })
}

// ── Lookups ─────────────────────────────────────────────────────────────────

/** A graph by id, key (G-3) or member project key — 404 when none. */
export function findGraph(store: Store, ref: string | undefined): Graph {
  // currentId: a pre-migration project id still finds its graph.
  const graph = resolveGraph(store.graphs, store.projects, String(currentId(String(ref ?? '')) ?? ''))
  if (!graph) throw notFound('graph not found')
  return graph
}

export function findGraphNode(graph: Graph, nodeId: string | undefined): GraphNode {
  const node = graph.nodes.find((n) => n.id === nodeId)
  if (!node) throw notFound(`no node ${nodeId} in ${graph.key}`)
  return node
}

const projectOfNode = (store: Store, node: GraphNode) => (node.projectId ? store.projects.find((p) => p.id === node.projectId) : undefined)
/** Read defensively: "stacking" owns the field. '' = the default branch. */
export const integrationBaseOf = (p: Project) => String((p as { integrationBase?: string }).integrationBase ?? '')

// ── The view the API and the page read ──────────────────────────────────────

function finishedOf(store: Store) {
  return (n: GraphNode) => {
    const p = projectOfNode(store, n)
    // A plan's ticket-plan drafts aren't work: they neither count nor hold it open.
    return !!p && projectWorkFinished(p, store.tickets.filter((t) => t.projectId === p.id && !isDraftTicket(t)))
  }
}

/** The graph as the API answers it: each node with its project, progress, state and layer. */
export function graphView(store: Store, graph: Graph, opts: { slices?: Map<string, SliceFact>; records?: boolean } = {}): GraphView {
  const layers = graphLayers(graph)
  const states = nodeStates(graph, finishedOf(store))
  const nodes = graph.nodes.map((n): GraphNodeView => {
    const { enteredBriefing, ...rest } = n
    const p = projectOfNode(store, n)
    const mine = p ? store.tickets.filter((t) => t.projectId === p.id && !isDraftTicket(t)) : []
    const inProgress = mine.filter((t) => t.status === 'in_progress').length
    return {
      ...rest,
      title: p?.title || n.title,
      mode: p ? p.mode : n.mode,
      type: projectTypeLabel(p ? p.mode : n.mode),
      layer: layers[n.id] ?? 0,
      state: states[n.id]!,
      project: p ? { id: p.id, key: p.key, title: p.title, mode: p.mode, url: `/projects/${p.key}`, integrationBranch: p.integrationBranch } : null,
      tickets: { total: mine.length, done: mine.filter((t) => isFinishedStatus(t.status)).length, inProgress },
      running: inProgress > 0 || !!p?.auto?.enabled,
      outcomeDoc: p ? (outcomeDocOf(store.docs, p.id)?.key ?? null) : null,
      ...(opts.slices && n.projectId && opts.slices.has(n.projectId) ? { slice: opts.slices.get(n.projectId) } : {}),
      ...(p?.mode === 'standard' ? { sharedWith: branchSharers(store.projects, p) } : {}),
      ...(opts.records ? { enteredBriefing } : {}),
    }
  })
  return {
    ...graph,
    name: graph.title || graphName(graph, (n) => projectOfNode(store, n)?.title || n.title),
    url: graphUrl(graph.key),
    nodes,
    problems: problemsOf(store, graph),
  }
}

export function problemsOf(store: Store, graph: Graph): GraphProblem[] {
  return graphProblems(graph, { projects: store.projects, otherGraphs: store.graphs.filter((g) => g.id !== graph.id) })
}

/** Every build node's slice size, time-boxed — for the drawing. */
export async function graphSlices(store: Store, graph: Graph): Promise<Map<string, SliceFact>> {
  const builds = graph.nodes.map((n) => projectOfNode(store, n)).filter((p): p is Project => !!p && p.mode === 'standard')
  const sizes = await Promise.all(builds.map((p) => within(readSlice(store, p), FACT_WAIT_MS, { state: 'unknown' } as SliceFact)))
  return new Map(builds.map((p, i) => [p.id, sizes[i]!]))
}

// ── Writes: create, shape, delete ───────────────────────────────────────────

/** A new, empty graph for a codebase (POST /api/graphs). Its shape, if sent, goes through saveGraphShape. */
export function createGraph(store: Store, input: { title?: unknown; description?: unknown; repo?: unknown }): Graph {
  const ts = now()
  const repo = typeof input.repo === 'string' ? expandHome(input.repo) : ''
  const graph: Graph = {
    id: newId('graph'),
    key: nextKey(store, 'graph'),
    title: String(input.title ?? '').trim().slice(0, 200),
    description: String(input.description ?? '').trim(),
    repo,
    nodes: [],
    edges: [],
    createdAt: ts,
    updatedAt: ts,
  }
  store.graphs.push(graph)
  if (repo) rememberRepo(store, { path: repo }, { touch: false })
  return graph
}

/**
 * The whole-shape save (PUT /api/graphs/:id {nodes, edges, title?, description?}):
 * stored as sent — a draft may be half-built — with every problem in it
 * answered beside it, like a run plan. A real node's mode follows its project.
 */
export function saveGraphShape(store: Store, graph: Graph, raw: any): GraphProblem[] {
  const { nodes, edges, notes } = mergeGraphShape(graph, raw ?? {}, () => newId('gnode'))
  for (const n of nodes) {
    const p = n.projectId ? findByRef(store.projects, n.projectId) : undefined
    if (p) {
      n.projectId = p.id
      n.mode = p.mode
    }
  }
  graph.nodes = nodes
  graph.edges = edges
  if (typeof raw?.title === 'string') graph.title = raw.title.trim().slice(0, 200)
  if (typeof raw?.description === 'string') graph.description = raw.description.trim()
  graph.updatedAt = now()
  return [...notes, ...problemsOf(store, graph)]
}

/** Add one node (POST /api/graphs/:id/nodes): an existing project ({projectId}) or a proposed one ({mode, title, note?}). */
export function addGraphNode(store: Store, graph: Graph, raw: any): { node: GraphNode; problems: GraphProblem[] } {
  const p = raw?.projectId ? findByRef(store.projects, raw.projectId) : undefined
  if (raw?.projectId && !p) throw notFound(`project ${raw.projectId} not found`)
  if (!p && !String(raw?.title ?? '').trim()) throw bad('send {projectId} for an existing project, or {mode, title} for a proposed one')
  const id = newId('gnode')
  const problems = saveGraphShape(store, graph, {
    nodes: [...graph.nodes, { id, mode: p?.mode ?? raw.mode, projectId: p?.id ?? null, title: p ? p.title : String(raw.title), note: String(raw.note ?? ''), stackOn: raw.stackOn ?? null }],
    edges: [...graph.edges, ...(Array.isArray(raw?.after) ? raw.after.map((from: string) => ({ from, to: id })) : [])],
  })
  return { node: graph.nodes.find((n) => n.id === id)!, problems }
}

/** A deleted project leaves its node proposed again, under the project's last title. */
export function detachProjectFromGraphs(store: Store, project: Pick<Project, 'id' | 'title'>): void {
  for (const g of store.graphs) {
    for (const n of g.nodes) {
      if (n.projectId !== project.id) continue
      n.projectId = null
      n.title = project.title
      n.enteredAt = null
      n.enteredNote = ''
      n.enteredBriefing = null
      g.updatedAt = now()
    }
  }
}

// ── Facts ───────────────────────────────────────────────────────────────────

type Check = { conclusion?: string; status?: string; state?: string }
function ciOf(checks: Check[]): RollupFact['ci'] {
  const outcome = (c: Check) => (c.conclusion || c.state || c.status || '').toUpperCase()
  if (!checks.length) return 'none'
  if (checks.some((c) => ['FAILURE', 'ERROR', 'TIMED_OUT', 'CANCELLED', 'ACTION_REQUIRED'].includes(outcome(c)))) return 'failed'
  if (checks.some((c) => ['', 'PENDING', 'QUEUED', 'IN_PROGRESS', 'EXPECTED', 'WAITING'].includes(outcome(c)))) return 'pending'
  return 'passed'
}

/**
 * The project's roll-up PR — the one whose head is its integration branch —
 * open first, else the latest merged, else closed. Through the gh cache under
 * the repo's 'prs' keys, so a push or a new PR (forgetRepoGithub) drops it.
 */
async function readRollup(project: Project, force = false): Promise<RollupFact> {
  const branch = project.integrationBranch.trim()
  if (!project.repo.trim() || !branch) return { state: 'no-branch', ci: 'none' }
  const repoDir = resolveRepoDir(project.repo)
  const hit = await ghCached(
    ghKey('prs', repoDir, 'rollup', branch),
    async () =>
      JSON.parse(await run('gh', ['pr', 'list', '--head', branch, '--state', 'all', '--limit', '5', '--json', 'number,state,url,baseRefName,statusCheckRollup'], repoDir)) as Array<{
        number: number
        state: string
        url: string
        baseRefName: string
        statusCheckRollup?: Check[]
      }>,
    { force },
  )
  const list = hit.value
  const pr = list.find((p) => p.state === 'OPEN') ?? list.find((p) => p.state === 'MERGED') ?? list[0]
  if (!pr) return { state: 'none', ci: 'none' }
  return {
    state: pr.state === 'OPEN' ? 'open' : pr.state === 'MERGED' ? 'merged' : 'closed',
    number: pr.number,
    url: pr.url,
    base: pr.baseRefName,
    ci: ciOf(pr.statusCheckRollup ?? []),
  }
}

/** gh failed outright (not slow): say so, so the briefing stops waiting for an answer that won't come. */
const rollupError = (err: any): RollupFact => ({ state: 'unknown', ci: 'unknown', error: String(err?.statusMessage ?? err?.message ?? err).replace(/\s+/g, ' ').trim().slice(0, 200) })

// The slice and the branch state both come from "stacking"'s
// integrationBranchState — the integration branch against its slice base (the
// commit its own work starts from, so a stacked build counts only its own
// work), the same base the Diff tab measures from. Local git plus two cached
// network reads; held for a few seconds so one briefing or drawing asks once
// per project.
const STATE_TTL_MS = 3000
const states = new Map<string, { at: number; state: Promise<IntegrationBranchState> }>()
function branchStateOf(store: Store, project: Project): Promise<IntegrationBranchState> {
  const key = `${project.id}\n${project.integrationBranch}\n${integrationBaseOf(project)}`
  const hit = states.get(key)
  if (hit && Date.now() - hit.at < STATE_TTL_MS) return hit.state
  const state = integrationBranchState(store, project)
  states.set(key, { at: Date.now(), state })
  if (states.size > 64) states.delete(states.keys().next().value!)
  return state
}

/** The build's slice size against its base. No branch, or nothing on it yet, is 'none' with the reason — never zeros. */
export async function readSlice(store: Store, project: Project): Promise<SliceFact> {
  if (!project.repo.trim()) return { state: 'none', reason: 'the project has no repo' }
  if (!project.integrationBranch.trim()) return { state: 'none', reason: 'no integration branch yet' }
  const s = await branchStateOf(store, project)
  if (!s.configured) return { state: 'none', reason: s.error ?? `${project.integrationBranch} isn't in this clone` }
  if (!s.slice || !s.slice.files) return { state: 'none', reason: `no commits on ${project.integrationBranch} beyond ${s.baseBranch || 'its base'} yet` }
  return { state: 'ok', files: s.slice.files, additions: s.slice.additions, deletions: s.slice.deletions, base: s.baseBranch }
}

/** The integration branch against its base: behind/ahead, unpushed, whether the base exists and the upstream looks merged. */
async function readBranch(store: Store, project: Project): Promise<BranchFact> {
  if (!project.repo.trim() || !project.integrationBranch.trim()) return { known: false }
  const s = await branchStateOf(store, project)
  if (!s.configured) return { known: false }
  return { known: true, base: s.baseBranch, behind: s.behind, ahead: s.ahead, unpushed: s.unpushed, baseExists: s.baseExists, upstreamMerged: s.upstreamMerged }
}

/** Every fact the briefing reads about one project. GitHub/git facts only when `deep`. */
export async function projectFacts(store: Store, graph: Graph, project: Project, deep: { github: boolean; git: boolean }): Promise<ProjectFacts> {
  // A plan's ticket-plan drafts aren't its tickets (they are counted in `plan`).
  const mine = store.tickets.filter((t) => t.projectId === project.id && !isDraftTicket(t))
  const open = mine.filter((t) => !isFinishedStatus(t.status))
  const inGraph = new Set(graph.nodes.map((n) => n.projectId).filter(Boolean))
  const byId = new Map(store.tickets.map((t) => [t.id, t]))
  const blockedOutside = open.flatMap((t) =>
    t.blockedBy
      .map((id) => byId.get(id))
      .filter((b) => !!b && !isFinishedStatus(b.status) && (!b.projectId || !inGraph.has(b.projectId)))
      .map((b) => ({ ticket: t.key, blocker: b!.key })),
  )
  const reviewRuns = project.mode === 'prreview' ? project.prReview?.runs : project.mode === 'planreview' ? project.planReview?.runs : undefined
  const lastRun = reviewRuns?.at(-1)
  const [rollup, branch, slice] = await Promise.all([
    deep.github ? within(readRollup(project).catch(rollupError), FACT_WAIT_MS, { state: 'unknown', ci: 'unknown' } as RollupFact) : Promise.resolve({ state: 'unknown', ci: 'unknown' } as RollupFact),
    deep.git ? within(readBranch(store, project), FACT_WAIT_MS, { known: false } as BranchFact) : Promise.resolve({ known: false } as BranchFact),
    deep.git ? within(readSlice(store, project), FACT_WAIT_MS, { state: 'unknown' } as SliceFact) : Promise.resolve({ state: 'unknown' } as SliceFact),
  ])
  return {
    id: project.id,
    key: project.key,
    title: project.title,
    mode: project.mode,
    tickets: {
      total: mine.length,
      done: mine.length - open.length,
      open: open.length,
      inProgress: open.filter((t) => t.status === 'in_progress').map((t) => t.key),
      hitlOpen: open.filter((t) => t.labels.includes('hitl')).map((t) => t.key),
    },
    auto: !!project.auto?.enabled,
    integrationBranch: project.integrationBranch,
    integrationBase: integrationBaseOf(project),
    outcomeDoc: outcomeDocOf(store.docs, project.id)?.key ?? null,
    review:
      project.mode === 'prreview' || project.mode === 'planreview'
        ? { runs: reviewRuns?.length ?? 0, running: lastRun?.status === 'running', verdict: lastRun?.verdict ?? '', openFindings: open.length }
        : null,
    plan: project.mode === 'plan' ? planFactOf(store, project) : null,
    sharedWith: project.mode === 'standard' ? branchSharers(store.projects, project) : [],
    blockedOutside,
    rollup,
    branch,
    slice,
  }
}

/**
 * The briefing in front of a node (GET …/nodes/:nodeId/briefing): the facts
 * about every upstream and the node's own project, then the flags. GitHub is
 * asked about upstream builds only (their roll-up PRs); git about upstream
 * builds before a review (the slice and branch state).
 */
export async function graphBriefing(store: Store, graph: Graph, nodeId: string, opts: { stackOn?: string | null } = {}): Promise<Briefing> {
  const node = findGraphNode(graph, nodeId)
  const ups = upstreamNodes(graph, node.id)
  const wanted = [...ups.map((u) => ({ n: u, upstream: true })), { n: node, upstream: false }]
  const facts = new Map<string, ProjectFacts>()
  await Promise.all(
    wanted.map(async ({ n, upstream }) => {
      const p = projectOfNode(store, n)
      if (!p) return
      const build = p.mode === 'standard'
      const deep = { github: upstream && build, git: upstream && build && node.mode === 'prreview' }
      facts.set(p.id, await projectFacts(store, graph, p, deep))
    }),
  )
  return assembleBriefing({ graph, nodeId: node.id, facts, stackOn: opts.stackOn, at: now() })
}

// ── Creating a proposed node's project ──────────────────────────────────────

function newPlainProject(store: Store, input: { title: string; description: string; mode: Project['mode']; repo: string }): Project {
  const ts = now()
  const project = {
    id: newId('proj'),
    key: nextKey(store, 'project'),
    title: input.title.slice(0, 200),
    description: input.description,
    mode: input.mode,
    repo: input.repo,
    integrationBranch: '',
    integrationBase: '',
    starred: false,
    position: null,
    hidden: false,
    share: null,
    prompts: {},
    createdAt: ts,
    updatedAt: ts,
  } as Project
  store.projects.push(project)
  if (project.repo) rememberRepo(store, { path: expandHome(project.repo) })
  return project
}

/**
 * Give a proposed node its project, and link it — what Move on does for a
 * proposed node, and what an approve step that creates the projects of
 * proposed nodes (without entering them) should call. Starts nothing.
 *
 *  - build / plan / predeploy: a plain project in the graph's codebase, titled
 *    and described from the node.
 *  - review: a review project titled from the node, with the reviewed build's
 *    roll-up PR attached when one is open on GitHub (attachPrToReviewProject —
 *    fetches the PR head onto jreview/pr-<n>), else with no PR yet (its page
 *    is the PR picker) and a note saying why. A review of that PR already made
 *    by hand, in no graph, is linked instead of a second one.
 *  - planreview: a plan review project pointed at the plan directly before
 *    the node (reviewHandoff.ts's pick, upstream mode 'plan'), or at none
 *    yet — its Review tab asks for the plan — with a note saying why. A plan
 *    review of that plan already made by hand, in no graph, is linked instead.
 *
 * Returns the project, plus notes on what was chosen. Already-real nodes are
 * answered as they are.
 */
export async function createNodeProject(graphRef: string, nodeId: string): Promise<{ project: Project; created: boolean; notes: string[] }> {
  let store = loadStore()
  let graph = findGraph(store, graphRef)
  let node = findGraphNode(graph, nodeId)
  const existing = projectOfNode(store, node)
  if (existing) return { project: existing, created: false, notes: [] }
  const title = node.title.trim() || `${graph.title || graph.key} · ${projectTypeLabel(node.mode)}`
  const notes: string[] = []
  let projectId: string

  if (node.mode === 'prreview') {
    if (!graph.repo) throw bad(`${graph.key} has no codebase — a review project needs the repo its pull request lives in`)
    // The build it reviews (reviewHandoff.ts — the same pick Send back makes),
    // and that build's roll-up PR, read fresh: a stale "none" would leave the
    // review unattached for nothing.
    const up = reviewedUpstream({ graph, nodeId: node.id, projects: store.projects, upstreamMode: 'standard' })
    const rollup = up.target?.integrationBranch.trim()
      ? await within(readRollup(up.target, true), ATTACH_WAIT_MS, { state: 'unknown', ci: 'unknown' } as RollupFact)
      : null
    const decision = rollupToAttach(up.target, rollup, up.candidates.length ? up.why : '')
    const repoDir = resolveRepoDir(graph.repo)
    const already = decision.pr ? findPrReviewProject(store, repoDir, decision.pr) : undefined
    if (already && !graphOfProject(store.graphs, already.id)) {
      // A review of that PR made by hand, in no graph: it becomes this node's project, not a second review of the same PR.
      projectId = already.id
      notes.push(`Linked ${already.key}, which already reviews ${up.target!.key}'s roll-up PR #${decision.pr}.`)
    } else {
      projectId = (await createUnattachedReviewProject({ repo: graph.repo, title, description: noteMarkdown(node.note) })).id
      if (decision.pr && already) {
        notes.push(`${already.key} already reviews ${up.target!.key}'s roll-up PR #${decision.pr} (in another graph) — this review was made with no PR yet.`)
      } else if (decision.pr) {
        // The attach fetches the PR head onto jreview/pr-<n> — a git write, so
        // the sandbox guard on run() applies; a refusal or a failed fetch
        // leaves the project unattached, said in the note.
        try {
          await attachPrToReviewProject(projectId, decision.pr)
          notes.push(`Attached ${up.target!.key}'s roll-up PR #${decision.pr}.`)
        } catch (err: any) {
          const why = String(err?.statusMessage ?? err?.message ?? err).slice(0, 300)
          notes.push(`${up.target!.key}'s roll-up PR #${decision.pr} is open, but attaching it failed (${why}) — pick the PR on the review's page.`)
        }
      } else if (decision.note) notes.push(decision.note)
    }
    store = loadStore()
  } else if (node.mode === 'planreview') {
    const up = reviewedUpstream({ graph, nodeId: node.id, projects: store.projects, upstreamMode: 'plan' })
    const already = up.target ? findPlanReviewProject(store, up.target.id) : undefined
    if (already && !graphOfProject(store.graphs, already.id)) {
      projectId = already.id
      notes.push(`Linked ${already.key}, which already reviews ${up.target!.key}.`)
    } else {
      projectId = createPlanReviewProject(store, { plan: up.target, repo: graph.repo, title: /^plan review$/i.test(node.title.trim()) ? '' : node.title.trim(), note: node.note }).id
      if (up.target) notes.push(`Reviews ${up.target.key}, the plan before it.`)
      else notes.push(`No plan to review yet: ${up.candidates.length ? up.why : 'no plan project sits directly before this node'} — pick it on the plan review's Review tab.`)
    }
  } else if (node.mode === 'standard' || node.mode === 'plan' || node.mode === 'predeploy') {
    projectId = newPlainProject(store, { title, description: noteMarkdown(node.note), mode: node.mode, repo: graph.repo }).id
  } else {
    throw bad(`a ${projectTypeLabel(node.mode)} node can't make its project here yet`)
  }

  // The helpers above save on their own: link against a fresh copy.
  graph = findGraph(store, graph.id)
  node = findGraphNode(graph, node.id)
  const project = store.projects.find((p) => p.id === projectId)!
  node.projectId = project.id
  node.mode = project.mode
  node.title = project.title
  graph.updatedAt = now()
  saveStore(store)
  return { project, created: true, notes }
}

// ── Move on ─────────────────────────────────────────────────────────────────

/**
 * POST /api/graphs/:id/nodes/:nodeId/enter {note?, stackOn?} — always works:
 * creates the node's project if it is still proposed, records the stacking
 * choice (a build whose project has no integration branch yet gets its base
 * set to the upstream build's integration branch; one that already has a
 * branch is left alone and flagged), and stamps enteredAt with the briefing
 * shown. Starts nothing. `stackOn` omitted keeps the node's stored choice;
 * null or '' means the default branch.
 */
export async function enterGraphNode(graphRef: string, nodeId: string, body: { note?: unknown; stackOn?: unknown }) {
  let store = loadStore()
  let graph = findGraph(store, graphRef)
  let node = findGraphNode(graph, nodeId)
  const stackOn = body.stackOn === undefined ? node.stackOn : typeof body.stackOn === 'string' && body.stackOn ? body.stackOn : null
  if (stackOn) {
    const on = graph.nodes.find((n) => n.id === stackOn)
    if (node.mode !== 'standard') throw bad('only a build stacks on an upstream')
    if (!on || on.mode !== 'standard' || !upstreamNodes(graph, node.id).some((u) => u.id === on.id)) throw bad('stackOn must name a build directly upstream of this node')
  }
  const briefing = await graphBriefing(store, graph, node.id, { stackOn })

  const made = node.projectId ? null : await createNodeProject(graph.id, node.id)
  store = loadStore()
  graph = findGraph(store, graph.id)
  node = findGraphNode(graph, node.id)
  const project = projectOfNode(store, node)!
  const flags: BriefingFlag[] = (made?.notes ?? []).map((message) => ({ level: 'info', nodeId: node.id, message }))

  if (node.mode === 'standard' && stackOn) {
    const up = projectOfNode(store, graph.nodes.find((n) => n.id === stackOn)!)
    const upBranch = up?.integrationBranch.trim() ?? ''
    if (!upBranch) flags.push({ level: 'warning', nodeId: stackOn, message: `${up?.key ?? 'The upstream build'} has no integration branch yet — ${project.key}'s base was left at the default branch.` })
    else if (!project.integrationBranch.trim()) {
      ;(project as { integrationBase?: string }).integrationBase = upBranch
      project.updatedAt = now()
      flags.push({ level: 'info', nodeId: node.id, message: `${project.key}'s base is now ${upBranch}: its integration branch is cut from there.` })
    } else if (integrationBaseOf(project) !== upBranch) {
      flags.push({ level: 'warning', nodeId: node.id, message: `${project.key} already has its integration branch ${project.integrationBranch} (from ${integrationBaseOf(project) || 'the default branch'}) — its base was left alone.` })
    }
  }
  node.stackOn = node.mode === 'standard' ? stackOn : null
  node.enteredAt = now()
  node.enteredNote = String(body.note ?? '').trim()
  node.enteredBriefing = briefing
  graph.updatedAt = node.enteredAt
  saveStore(store)
  return { graph: graphView(store, graph), node: graphView(store, graph).nodes.find((n) => n.id === node.id)!, project, created: !!made?.created, briefing, flags }
}

// ── A project's place in its graph (the project page's strip) ───────────────

export function projectGraphPlace(store: Store, project: Project) {
  const hit = graphOfProject(store.graphs, project.id)
  if (!hit) return { graph: null }
  const { graph, node } = hit
  const view = graphView(store, graph)
  const nodeView = view.nodes.find((n) => n.id === node.id)!
  const link = (n: GraphNode) => view.nodes.find((x) => x.id === n.id)!
  const brief = (n: GraphNodeView) => ({ nodeId: n.id, title: n.title, type: n.type, state: n.state, project: n.project && { key: n.project.key, url: n.project.url } })
  return {
    graph: { id: graph.id, key: graph.key, name: view.name, url: view.url },
    node: nodeView,
    upstream: upstreamNodes(graph, node.id).map(link).map(brief),
    downstream: downstreamNodes(graph, node.id).map(link).map(brief),
  }
}
