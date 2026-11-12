// The ticket plan of a plan project — the step from a resolved plan to the
// builds that carry it out, cut into reviewable slices.
//
// A plan project's Ticket plan button dispatches one `/jplan-to-jtickets`
// session (prompt kind `ticketplan:build`). It writes the spec as a doc on the
// plan, drafts the build tickets ON THE PLAN PROJECT, and proposes the graph's
// shape: proposed build nodes (each with a `note` saying what the slice is and
// how large its diff should be), a Review node after each build, and a plan
// review first when the plan is large or risky. A draft is a ticket with
// `plannedFor` = the graph node id of the build it will move into.
//
// A draft is not work yet: it is off every frontier and refused by every
// dispatch path (it is record-only — isRecordOnly in reviewFindings.ts reads
// isDraftTicket). Approve (POST …/ticket-plan/approve) gives each build node
// that has drafts its project and moves the drafts in, clearing plannedFor;
// it starts nothing and enters nothing. Review and plan review nodes stay
// proposed until the human moves on into them.
//
// Pure: no Nuxt, no I/O — tests/ticketPlan.test.ts. The store side is
// server/utils/ticketPlan.ts (ticketPlanOf is the one read every caller uses).
import { graphLayers, upstreamNodes, downstreamNodes, type Graph, type GraphNode } from './graphs'
import { projectTypeLabel, projectTypeNoun } from './projectType'

/** A ticket that is a draft of the ticket plan: planned for a build, not work yet. */
export const isDraftTicket = (t: { plannedFor?: string | null }): boolean => !!t.plannedFor

/** Why a draft can't be dispatched. */
export function draftError(ticket: { key: string }, project: { key: string } | null | undefined): string {
  return `${ticket.key} is a draft in ${project?.key ?? 'its plan'}'s ticket plan — it isn't work until the plan is approved and it moves into its build project; it is never dispatched from the plan`
}

/** A node's type as shown. */
export const nodeTypeLabel = (mode: string) => projectTypeLabel(mode)

/** The node modes a ticket plan proposes after its builds. */
export const REVIEW_NODE_MODES = ['prreview', 'planreview'] as const

/**
 * Why `nodeId` can't be a draft's plannedFor on this project, or '' when it
 * can: drafts live on a plan project that sits in a graph, and name a build
 * node of that graph (proposed, or already given its project by an earlier
 * approve). `graph` is the plan project's graph (graphOfProject), or null.
 */
export function plannedForProblem(
  project: { key: string; mode: string } | null | undefined,
  graph: Pick<Graph, 'key' | 'nodes'> | null,
  nodeId: string,
): string {
  if (!project) return 'a draft lives on a plan project — send projectId'
  if (project.mode !== 'plan') return `${project.key} is a ${projectTypeNoun(project.mode)} project — drafts of a ticket plan live on its plan project`
  if (!graph) return `${project.key} is in no graph yet — POST /api/projects/${project.key}/ticket-plan/graph first`
  const node = graph.nodes.find((n) => n.id === nodeId)
  if (!node) return `${graph.key} has no node ${nodeId}`
  if (node.mode !== 'standard') return `plannedFor names a ${nodeTypeLabel(node.mode).toLowerCase()} node in ${graph.key} — drafts are planned for build nodes`
  return ''
}

// ── The view ────────────────────────────────────────────────────────────────

export interface DraftTicketLike {
  id: string
  key: string
  title: string
  type: string
  status: string
  labels: readonly string[]
  blockedBy: readonly string[]
  acceptanceCriteria?: readonly string[]
  projectId: string | null
  plannedFor?: string | null
}

/** One blocker of a draft, and where it sits. */
export interface DraftBlocker {
  key: string
  title: string
  /** The build node a draft blocker is planned for; 'plan' = an open plan ticket; 'outside' = any other ticket; 'done' = finished. */
  where: string
}

export interface DraftView {
  id: string
  key: string
  title: string
  type: string
  hitl: boolean
  criteria: number
  blockedBy: DraftBlocker[]
}

export interface TicketPlanBuild {
  nodeId: string
  title: string
  note: string
  /** False once approve (or Move on) gave the node its project. */
  proposed: boolean
  project: { id: string; key: string; title: string } | null
  /** Direct upstream node ids — where the build's work comes from. */
  after: string[]
  /** Review nodes directly after it. */
  reviews: string[]
  layer: number
  drafts: DraftView[]
}

export interface TicketPlanReview {
  nodeId: string
  mode: string
  type: string
  title: string
  note: string
  proposed: boolean
  project: { id: string; key: string; title: string } | null
  after: string[]
  layer: number
}

export interface TicketPlanProblem {
  level: 'warning' | 'info'
  nodeId: string
  ticket: string
  message: string
}

export interface TicketPlanView {
  /** The plan project's node in its graph (null = in no graph). */
  planNodeId: string | null
  /** Builds in graph order (layer, then node order). Only those with drafts, or still proposed. */
  builds: TicketPlanBuild[]
  /** Review and plan review nodes in the plan's graph. */
  reviews: TicketPlanReview[]
  /** Drafts whose plannedFor names no build node of the graph (the node was removed). */
  unplaced: DraftView[]
  /** Every draft, placed or not. */
  drafts: number
  problems: TicketPlanProblem[]
}

const FINISHED = new Set(['done', 'merged'])

/**
 * The plan project's ticket plan, read off its graph and its drafts. `tickets`
 * is every ticket in the store (a draft's blockers may be anywhere);
 * `projects` names the real nodes.
 */
export function assembleTicketPlan(input: {
  project: { id: string }
  graph: Pick<Graph, 'nodes' | 'edges'> | null
  tickets: DraftTicketLike[]
  projects: Array<{ id: string; key: string; title: string }>
}): TicketPlanView {
  const { project, graph } = input
  const drafts = input.tickets.filter((t) => t.projectId === project.id && isDraftTicket(t))
  const byId = new Map(input.tickets.map((t) => [t.id, t]))
  const projectsById = new Map(input.projects.map((p) => [p.id, p]))
  const planNode = graph?.nodes.find((n) => n.projectId === project.id) ?? null
  const nodes = graph?.nodes ?? []
  const buildIds = new Set(nodes.filter((n) => n.mode === 'standard').map((n) => n.id))
  const layers = graph ? graphLayers(graph) : {}
  const order = new Map(nodes.map((n, i) => [n.id, i]))
  const byGraphOrder = (a: string, b: string) => (layers[a] ?? 0) - (layers[b] ?? 0) || (order.get(a) ?? 0) - (order.get(b) ?? 0)
  const projectOf = (n: GraphNode) => {
    const p = n.projectId ? projectsById.get(n.projectId) : undefined
    return p ? { id: p.id, key: p.key, title: p.title } : null
  }

  const where = (b: DraftTicketLike): string => {
    if (FINISHED.has(b.status)) return 'done'
    if (b.projectId === project.id && isDraftTicket(b)) return b.plannedFor!
    if (b.projectId === project.id) return 'plan'
    return 'outside'
  }
  const viewOf = (t: DraftTicketLike): DraftView => ({
    id: t.id,
    key: t.key,
    title: t.title,
    type: t.type,
    hitl: t.labels.includes('hitl'),
    criteria: t.acceptanceCriteria?.length ?? 0,
    blockedBy: t.blockedBy
      .map((id) => byId.get(id))
      .filter((b): b is DraftTicketLike => !!b)
      .map((b) => ({ key: b.key, title: b.title, where: where(b) })),
  })
  const byKeyNumber = (a: { key: string }, b: { key: string }) => Number(a.key.split('-')[1] ?? 0) - Number(b.key.split('-')[1] ?? 0)

  const draftsOf = new Map<string, DraftTicketLike[]>()
  const unplaced: DraftTicketLike[] = []
  for (const t of drafts) {
    if (buildIds.has(t.plannedFor!)) (draftsOf.get(t.plannedFor!) ?? draftsOf.set(t.plannedFor!, []).get(t.plannedFor!)!).push(t)
    else unplaced.push(t)
  }

  const isReview = (n: GraphNode) => (REVIEW_NODE_MODES as readonly string[]).includes(n.mode)
  const builds: TicketPlanBuild[] = nodes
    .filter((n) => n.mode === 'standard' && (!n.projectId || draftsOf.has(n.id)))
    .map((n) => n.id)
    .sort(byGraphOrder)
    .map((id) => {
      const n = nodes.find((x) => x.id === id)!
      return {
        nodeId: n.id,
        title: projectOf(n)?.title || n.title,
        note: n.note,
        proposed: !n.projectId,
        project: projectOf(n),
        after: graph ? upstreamNodes(graph, n.id).map((u) => u.id) : [],
        reviews: graph ? downstreamNodes(graph, n.id).filter(isReview).map((d) => d.id) : [],
        layer: layers[n.id] ?? 0,
        drafts: (draftsOf.get(n.id) ?? []).sort(byKeyNumber).map(viewOf),
      }
    })
  const reviews: TicketPlanReview[] = nodes
    .filter(isReview)
    .map((n) => n.id)
    .sort(byGraphOrder)
    .map((id) => {
      const n = nodes.find((x) => x.id === id)!
      return {
        nodeId: n.id,
        mode: n.mode,
        type: nodeTypeLabel(n.mode),
        title: projectOf(n)?.title || n.title,
        note: n.note,
        proposed: !n.projectId,
        project: projectOf(n),
        after: graph ? upstreamNodes(graph, n.id).map((u) => u.id) : [],
        layer: layers[n.id] ?? 0,
      }
    })

  return {
    planNodeId: planNode?.id ?? null,
    builds,
    reviews,
    unplaced: unplaced.sort(byKeyNumber).map(viewOf),
    drafts: drafts.length,
    problems: graph ? ticketPlanProblems(graph, builds, unplaced.map(viewOf), drafts.length) : drafts.length ? [{ level: 'warning', nodeId: '', ticket: '', message: 'The plan is in no graph, so its drafts have no build to go to.' }] : [],
  }
}

/**
 * What the human should know before approving — never a gate: approve works
 * whatever this says. Warnings are things approve can't carry over as meant;
 * info is advice the proposer weighed (a build with no review after it).
 */
export function ticketPlanProblems(
  graph: Pick<Graph, 'nodes' | 'edges'>,
  builds: TicketPlanBuild[],
  unplaced: DraftView[],
  drafts: number,
): TicketPlanProblem[] {
  const out: TicketPlanProblem[] = []
  const name = new Map(builds.map((b) => [b.nodeId, b.title]))
  for (const t of unplaced) out.push({ level: 'warning', nodeId: '', ticket: t.key, message: `${t.key} ${t.title} is planned for a build that is no longer in the graph — move it to one, or delete it.` })
  for (const b of builds) {
    if (b.proposed && !b.drafts.length) out.push({ level: 'warning', nodeId: b.nodeId, ticket: '', message: `${b.title} has no draft tickets — approve leaves it proposed.` })
    if (b.drafts.length && !b.reviews.length) out.push({ level: 'info', nodeId: b.nodeId, ticket: '', message: `${b.title} has no review after it.` })
    // A draft waiting on a draft of another build: that build has to come
    // first, so it must be upstream in the graph — or the build projects
    // would wait on each other with nothing in the graph saying so.
    const ancestors = new Set(upstreamNodes(graph, b.nodeId, { transitive: true }).map((n) => n.id))
    for (const t of b.drafts) {
      for (const blk of t.blockedBy) {
        if (blk.where === 'plan') out.push({ level: 'info', nodeId: b.nodeId, ticket: t.key, message: `${t.key} waits on ${blk.key} ${blk.title}, a plan ticket still open.` })
        else if (name.has(blk.where) && blk.where !== b.nodeId && !ancestors.has(blk.where)) {
          out.push({ level: 'warning', nodeId: b.nodeId, ticket: t.key, message: `${t.key} in ${b.title} waits on ${blk.key} in ${name.get(blk.where)}, which isn't upstream of it in the graph — add the edge, or move one of them.` })
        }
      }
    }
  }
  // Once approve has moved every draft into its build there are none left — that isn't "not drafted yet".
  const buildNodes = graph.nodes.filter((n) => n.mode === 'standard')
  const allApproved = buildNodes.length > 0 && buildNodes.every((n) => n.projectId)
  if (!drafts && !allApproved) out.push({ level: 'info', nodeId: '', ticket: '', message: 'No draft tickets yet.' })
  return out
}

/**
 * The build nodes approve acts on: those with drafts, in graph order —
 * every one, or only those named. Proposed review and plan review nodes are
 * never among them; they get their projects when the human moves on.
 */
export function approvableBuilds(plan: Pick<TicketPlanView, 'builds'>, only?: readonly string[] | null): TicketPlanBuild[] {
  const want = only?.length ? new Set(only) : null
  return plan.builds.filter((b) => b.drafts.length && (!want || want.has(b.nodeId)))
}
