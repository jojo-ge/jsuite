// A plan project's ticket plan on the server — the read every caller shares
// (ticketPlanOf: the Ticket plan tab, the /jplan-to-jtickets session, and the
// plan review that reads the drafts and the proposed shape), the plan's graph
// (get-or-create), the button's dispatch / report-back / cancel, and Approve.
// The rules and the view's shape are app/utils/ticketPlan.ts.
//
// The dispatch follows the run plan's Build button (runPlanBuild.ts): one
// session (`ticketplan:build`, prompt layers applied), `project.ticketPlanBuild`
// marks it in progress, POST …/ticket-plan/built clears it, DELETE …/build
// cancels it and closes the pane.
import type { Project, Store, Ticket } from './store'
import { assembleTicketPlan, approvableBuilds, plannedForProblem, type TicketPlanView } from '../../app/utils/ticketPlan'
import { graphOfProject, type Graph, type GraphView } from '../../app/utils/graphs'
import { projectTypeNoun } from '../../app/utils/projectType'
import { createGraph, createNodeProject, graphView, saveGraphShape } from './graphs'
import { findByRef } from './ids'

export interface TicketPlan extends TicketPlanView {
  project: { id: string; key: string; title: string; mode: string; repo: string }
  /** The plan project's graph as the graphs API answers it; null = in no graph yet. */
  graph: GraphView | null
  /** The /jplan-to-jtickets session writing it, while one is. */
  building: { agent: string; paneId: string; startedAt: string } | null
}

/**
 * The ticket plan of a plan project: its graph, the proposed builds with the
 * drafts planned for each (and each node's note — what the slice is, how
 * large), the reviews after them, drafts that lost their node, and the
 * warnings worth reading before approve. Read-only, no git or gh.
 */
export function ticketPlanOf(store: Store, project: Project): TicketPlan {
  const graph = graphOfProject(store.graphs, project.id)?.graph ?? null
  const view = assembleTicketPlan({ project, graph, tickets: store.tickets, projects: store.projects })
  return {
    project: { id: project.id, key: project.key, title: project.title, mode: project.mode, repo: project.repo },
    graph: graph ? graphView(store, graph) : null,
    building: project.ticketPlanBuild ?? null,
    ...view,
  }
}

// ── The plan's graph ────────────────────────────────────────────────────────

/** The graph the plan project sits in — made around it (titled after the plan, in its codebase) when it's in none. Mutates `store`; the caller saves. */
export function ensurePlanGraph(store: Store, project: Project): { graph: Graph; planNodeId: string; created: boolean } {
  const hit = graphOfProject(store.graphs, project.id)
  if (hit) return { graph: hit.graph, planNodeId: hit.node.id, created: false }
  const graph = createGraph(store, { title: project.title, repo: project.repo })
  saveGraphShape(store, graph, { nodes: [{ projectId: project.id, mode: project.mode, title: project.title }], edges: [] })
  // The plan is the graph's start and already being worked: it counts as moved
  // on into, so its page doesn't ask the human to move on into it.
  graph.nodes[0]!.enteredAt = graph.createdAt
  return { graph, planNodeId: graph.nodes[0]!.id, created: true }
}

/**
 * A draft's plannedFor, checked: null/'' clears it; a node id must name a
 * build node in the plan project's graph. 400 otherwise — loud, so the
 * proposer never files a draft that has nowhere to go.
 */
export function resolvePlannedFor(store: Store, projectId: string | null, raw: unknown): string | null {
  if (raw === null || raw === undefined || raw === '') return null
  if (typeof raw !== 'string') throw createError({ statusCode: 400, statusMessage: 'plannedFor is a graph node id, or null' })
  const project = projectId ? store.projects.find((p) => p.id === projectId) : undefined
  const graph = project ? (graphOfProject(store.graphs, project.id)?.graph ?? null) : null
  const problem = plannedForProblem(project, graph, raw)
  if (problem) throw createError({ statusCode: 400, statusMessage: problem })
  return raw
}

// ── The button: dispatch, report back, cancel ───────────────────────────────

/** Why the Ticket plan button can't dispatch — null when it can. */
export function ticketPlanBuildBlocker(project: Pick<Project, 'key' | 'mode' | 'repo' | 'share'>): string | null {
  if (project.mode !== 'plan') return `a ticket plan is drafted from a plan — ${project.key} is a ${projectTypeNoun(project.mode)} project`
  if (!project.repo.trim()) return `${project.key} has no repo — set one first; the session reads the code to size the builds`
  if (project.share && project.share.side !== 'creator') return `${project.key} is shared with you — only its creator's side can draft its ticket plan`
  return null
}

/**
 * POST /api/projects/:id/ticket-plan/build — makes the plan's graph if it has
 * none (so the session only adds proposed nodes to it), then dispatches the
 * session. A build whose session herdr still lists is refused (409); one
 * whose session is gone is replaced.
 */
export async function startTicketPlanBuild(projectId: string): Promise<{ agent: string; paneId: string; graph: string }> {
  let store = loadStore()
  let project = store.projects.find((p) => p.id === projectId)
  if (!project) throw createError({ statusCode: 404, statusMessage: 'project not found' })
  const blocked = ticketPlanBuildBlocker(project)
  if (blocked) throw createError({ statusCode: 409, statusMessage: blocked })
  if (project.ticketPlanBuild) {
    const agents = await herdrAgents()
    const live = agents?.has(project.ticketPlanBuild.agent) ?? true
    if (live) throw createError({ statusCode: 409, statusMessage: `a session is already drafting ${project.key}'s ticket plan (since ${project.ticketPlanBuild.startedAt}) — cancel it first to start over` })
  }
  const { graph, created } = ensurePlanGraph(store, project)
  if (created) saveStore(store)
  const prompt = ticketPlanPrompt(store, project)
  const { agent, paneId } = await dispatchProjectSession(project, 'ticket plan', prompt, { model: TICKETPLAN_MODEL, effort: TICKETPLAN_EFFORT, session: { role: 'ticketplan-build' } })
  // Re-read: the dispatch took seconds and the store may have moved on.
  store = loadStore()
  project = store.projects.find((p) => p.id === projectId)
  if (project) {
    project.ticketPlanBuild = { agent, paneId, startedAt: now() }
    project.updatedAt = now()
    saveStore(store)
  }
  return { agent, paneId, graph: graph.key }
}

/** The session reported back, or was cancelled — the mark comes off. Returns what was there. */
export function clearTicketPlanBuild(project: Project) {
  const was = project.ticketPlanBuild ?? null
  project.ticketPlanBuild = null
  project.updatedAt = now()
  return was
}

/** DELETE …/ticket-plan/build — close the session's pane (best-effort) and clear the mark. What it drafted stays. */
export async function cancelTicketPlanBuild(projectId: string): Promise<boolean> {
  const store = loadStore()
  const project = store.projects.find((p) => p.id === projectId)
  if (!project) throw createError({ statusCode: 404, statusMessage: 'project not found' })
  const was = clearTicketPlanBuild(project)
  saveStore(store)
  if (was?.paneId) {
    try {
      await herdrJson(['pane', 'close', was.paneId])
      invalidateHerdrState()
    } catch {
      /* already gone, or herdr down — the mark is off either way */
    }
  }
  return !!was
}

// ── Approve ─────────────────────────────────────────────────────────────────

export interface ApprovedBuild {
  nodeId: string
  project: { id: string; key: string; title: string }
  created: boolean
  moved: string[]
  notes: string[]
}

/**
 * POST /api/projects/:id/ticket-plan/approve {nodes?: [nodeId]} — for each
 * build node with drafts (all of them, or only those named), give the node
 * its project (createNodeProject: a plain build in the graph's codebase,
 * described by the node's note) and move its drafts in: projectId ← the
 * build, plannedFor ← null. Ids don't change, so blockers carry over as they
 * are. One build at a time, saved as each lands, so a failure part-way
 * leaves every build either fully moved or untouched. Review and plan review
 * nodes stay proposed; nothing is entered, nothing started.
 */
export async function approveTicketPlan(projectRef: string, body: { nodes?: unknown }): Promise<{ approved: ApprovedBuild[]; plan: TicketPlan }> {
  let store = loadStore()
  let project = findByRef(store.projects, projectRef)
  if (!project) throw createError({ statusCode: 404, statusMessage: 'project not found' })
  if (project.mode !== 'plan') throw createError({ statusCode: 409, statusMessage: `${project.key} is a ${projectTypeNoun(project.mode)} project — only a plan has a ticket plan` })
  if (project.share) throw createError({ statusCode: 409, statusMessage: `${project.key} is shared — its drafts can't move into local build projects across the share` })
  if (project.ticketPlanBuild) throw createError({ statusCode: 409, statusMessage: `a session is still drafting ${project.key}'s ticket plan — wait for it to report back, or cancel it` })
  const only = Array.isArray(body.nodes) ? body.nodes.filter((n): n is string => typeof n === 'string' && !!n) : null
  const plan = ticketPlanOf(store, project)
  if (!plan.graph) throw createError({ statusCode: 409, statusMessage: `${project.key} is in no graph — there are no builds to approve` })
  const builds = approvableBuilds(plan, only)
  if (only?.length) {
    const unknown = only.filter((id) => !plan.builds.some((b) => b.nodeId === id))
    if (unknown.length) throw createError({ statusCode: 400, statusMessage: `not a build of ${project.key}'s ticket plan: ${unknown.join(', ')}` })
  }
  if (!builds.length) throw createError({ statusCode: 409, statusMessage: `${project.key}'s ticket plan has no drafts to approve${only?.length ? ' in those builds' : ''}` })

  const graphId = plan.graph.id
  const approved: ApprovedBuild[] = []
  for (const b of builds) {
    const made = await createNodeProject(graphId, b.nodeId)
    store = loadStore()
    const ids = new Set(b.drafts.map((d) => d.id))
    const moved: Ticket[] = store.tickets.filter((t) => ids.has(t.id) && t.plannedFor === b.nodeId && t.projectId === project!.id)
    const ts = now()
    for (const t of moved) {
      t.projectId = made.project.id
      t.plannedFor = null
      t.updatedAt = ts
    }
    saveStore(store)
    approved.push({ nodeId: b.nodeId, project: { id: made.project.id, key: made.project.key, title: made.project.title }, created: made.created, moved: moved.map((t) => t.key), notes: made.notes })
  }
  store = loadStore()
  project = store.projects.find((p) => p.id === project!.id)!
  return { approved, plan: ticketPlanOf(store, project) }
}
