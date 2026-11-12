// Send back, on the store: a review project's picked findings become tickets
// on the upstream project its graph puts before it. The rules — which
// upstream, what a finding becomes, what was already sent — are
// app/utils/reviewHandoff.ts; this file looks things up, mints and saves.
//
// Explicit imports, no Nitro globals beyond createError: tests run these over
// a plain Store object.
import { graphOfProject } from '../../app/utils/graphs'
import { projectTypeLabel } from '../../app/utils/projectType'
import { planSendBack, reviewedUpstream, SEND_BACK_RULES, sendBackDraft, type SendBackRule } from '../../app/utils/reviewHandoff'
import { findByRef } from './ids'
import { peerWriteError } from './ownership'
import { mintTicket } from './reviewTickets'
import { cleanLabels, type Project, type Store, type Ticket } from './store'

const brief = (p: Project) => ({ id: p.id, key: p.key, title: p.title, mode: p.mode, url: `/projects/${p.key}` })

export interface SendBackPlace {
  /** Whether the Review tab offers Send back at all: a review in a graph with a project of the right type directly before it. */
  offered: boolean
  /** Why it isn't offered, or why there is no target yet — '' otherwise. */
  why: string
  graph: { key: string; url: string } | null
  /** Where the findings go, and what they become. */
  target: ReturnType<typeof brief> | null
  candidates: ReturnType<typeof brief>[]
  ticketType: string
}

/**
 * Where a review project's findings go back to (GET
 * /api/projects/:id/findings/send-back). `prefer` is the human's pick when
 * several projects lead into the review.
 */
export function sendBackPlace(store: Store, project: Project, prefer?: string): SendBackPlace & { rule: SendBackRule | null } {
  const rule = SEND_BACK_RULES[project.mode] ?? null
  const off = (why: string, graph: SendBackPlace['graph'] = null) => ({ offered: false, why, graph, target: null, candidates: [], ticketType: rule?.type ?? '', rule })
  if (!rule) return off(`${project.key} is a ${projectTypeLabel(project.mode)} project — only a review sends findings back`)
  const hit = graphOfProject(store.graphs, project.id)
  // A plan review records the plan it read, so its findings go back there —
  // in a graph or not. (A PR review knows only its PR, so the graph says which build.)
  if (project.mode === 'planreview') {
    const graph = hit ? { key: hit.graph.key, url: `/graphs/${hit.graph.key}` } : null
    const planId = project.planReview?.planProjectId
    const plan = planId ? store.projects.find((p) => p.id === planId && p.mode === rule.upstreamMode) : undefined
    if (!plan) return off(planId ? `the plan ${project.key} reviewed is gone` : `${project.key} has no plan picked yet`, graph)
    return { offered: true, why: '', graph, target: brief(plan), candidates: [brief(plan)], ticketType: rule.type, rule }
  }
  if (!hit) return off(`${project.key} is not in a graph — Send back files its findings on the ${projectTypeLabel(rule.upstreamMode).toLowerCase()} before it in one`)
  const graph = { key: hit.graph.key, url: `/graphs/${hit.graph.key}` }
  const up = reviewedUpstream({
    graph: hit.graph,
    nodeId: hit.node.id,
    projects: store.projects,
    upstreamMode: rule.upstreamMode,
    prHead: project.prReview?.pr.headRefName,
    prefer,
  })
  if (!up.candidates.length) return off(`no ${projectTypeLabel(rule.upstreamMode).toLowerCase()} project sits directly before ${project.key} in ${hit.graph.key}`, graph)
  return { offered: true, why: up.why, graph, target: up.target && brief(up.target), candidates: up.candidates.map(brief), ticketType: rule.type, rule }
}

export interface SendBackResult {
  target: ReturnType<typeof brief>
  /** Each finding sent now, and the ticket it became. */
  sent: Array<{ key: string; ticketKey: string }>
  /** Findings sent before — nothing new filed. */
  already: Array<{ key: string; ticketKey: string }>
  refused: Array<{ key: string; why: string }>
}

/**
 * POST /api/projects/:id/findings/send-back {ticketKeys, to?} on a store the
 * caller loaded (and saves): each picked finding ticket becomes a ticket on
 * the upstream project — for a PR review, an AFK bug on the build; for a plan
 * review, a HITL decision ticket on the plan it reviewed — and
 * records it (`sentBack`). One already sent, whose ticket still exists, files
 * nothing. 409 when the project is in no graph after such a project, or the
 * target is ambiguous and `to` doesn't pick one.
 */
export function sendBackFindings(store: Store, projectRef: string | undefined, body: { ticketKeys?: unknown; to?: unknown }, ts: string, base: string): SendBackResult {
  const project = findByRef(store.projects, projectRef)
  if (!project) throw createError({ statusCode: 404, statusMessage: 'project not found' })
  const keys = Array.isArray(body.ticketKeys) ? body.ticketKeys.map(String) : []
  if (!keys.length) throw createError({ statusCode: 400, statusMessage: 'send {ticketKeys: [...]} — the finding tickets to send back' })
  const place = sendBackPlace(store, project, typeof body.to === 'string' ? body.to : undefined)
  if (!place.offered || !place.rule) throw createError({ statusCode: 409, statusMessage: place.why })
  if (!place.target) throw createError({ statusCode: 409, statusMessage: place.why })
  const target = store.projects.find((p) => p.id === place.target!.id)!
  const rule = place.rule

  const ids = new Set(store.tickets.map((t) => t.id))
  const plan = planSendBack({
    keys,
    tickets: store.tickets.filter((t) => t.projectId === project.id),
    ticketExists: (id) => ids.has(id),
    projectKey: project.key,
  })
  const sent: SendBackResult['sent'] = []
  const refused = [...plan.refused]
  for (const finding of plan.send) {
    // Recording the send is a write to the finding ticket: not on the peer's half of a shared review.
    const peer = peerWriteError(finding, project.share)
    if (peer) {
      refused.push({ key: finding.key, why: peer })
      continue
    }
    const draft = sendBackDraft(finding, { rule, review: { key: project.key, title: project.title }, base })
    const ticket = mintTicket(store, target, { ...draft, type: draft.type as Ticket['type'], labels: cleanLabels(draft.labels) }, ts)
    finding.sentBack = { ticketId: ticket.id, ticketKey: ticket.key, projectId: target.id, at: ts }
    finding.updatedAt = ts
    sent.push({ key: finding.key, ticketKey: ticket.key })
  }
  return { target: brief(target), sent, already: plan.already, refused }
}
