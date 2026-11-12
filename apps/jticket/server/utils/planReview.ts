// Plan review projects, server side — making one, pointing it at its plan, and
// starting its review. The shapes and rules are app/utils/planReview.ts.
//
// The review is the PR review's agreement review with the subject set to the
// plan (createReview's `subject`): no fetch, no branch, no worktree — the
// sessions run in the codebase's main checkout and read the plan through
// jTicket. Nothing here touches the plan: only the human's Send back press
// files anything on it (server/utils/reviewHandoff.ts).
import { basename } from 'node:path'
import {
  coercePlanReview,
  planReviewDescription,
  planReviewStartProblem,
  planReviewTitle,
  type PlanReview,
  type PlanReviewRun,
  type PlanUnderReview,
} from '../../app/utils/planReview'
import { REVIEW_RUNNER, REVIEW_RUNS_CAP, reviewerCount } from '../../app/utils/prReview'
import { graphOfProject, type PlanFact } from '../../app/utils/graphs'
import { isDraftTicket } from '../../app/utils/ticketPlan'
import { findByRef } from './ids'
import { modelIdFor } from './models'
import { readReview, sanitizeReviewKey } from './reviewStore'
import { createReview } from './reviewActions'
import { settlePrReviewRun } from './prReview'
import { expandHome, resolveRepoDir } from './github'
import { loadStore, newId, nextKey, now, rememberRepo, saveStore, type Project, type Store } from './store'

/** The label the plan's spec doc carries (jplan-to-jtickets writes it). */
export const SPEC_LABEL = 'spec'

/** The plan's spec doc — its newest `spec`-labelled doc — or undefined. */
export function specDocOf(store: Store, planId: string) {
  return store.docs.filter((d) => d.projectId === planId && d.labels.includes(SPEC_LABEL)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0]
}

/** What a plan's ticket plan and spec hold — for the briefing before a plan review, and the start decision. */
export function planFactOf(store: Store, plan: Project): PlanFact {
  const graph = graphOfProject(store.graphs, plan.id)?.graph ?? null
  // Every build in the plan's graph, approved ones included: an approved build
  // has left the ticket plan's draft list, not the plan.
  const builds = (graph?.nodes ?? []).filter((n) => n.mode === 'standard')
  return {
    drafts: store.tickets.filter((t) => t.projectId === plan.id && isDraftTicket(t)).length,
    builds: builds.length,
    proposedBuilds: builds.filter((n) => !n.projectId).length,
    specDoc: specDocOf(store, plan.id)?.key ?? null,
    drafting: !!plan.ticketPlanBuild,
  }
}

/** The plan a plan review project points at, as the start decision reads it — null when it names none or the plan is gone. */
export function planUnderReview(store: Store, project: Project): PlanUnderReview | null {
  const id = project.planReview?.planProjectId
  const plan = id ? store.projects.find((p) => p.id === id) : undefined
  if (!plan) return null
  const fact = planFactOf(store, plan)
  return {
    key: plan.key,
    title: plan.title,
    mode: plan.mode,
    repo: plan.repo,
    drafts: fact.drafts,
    builds: fact.builds,
    docs: store.docs.filter((d) => d.projectId === plan.id).length,
    drafting: fact.drafting,
  }
}

/** The newest plan review project of `planId`, if any. */
export function findPlanReviewProject(store: Store, planId: string): Project | undefined {
  return store.projects
    .filter((p) => p.mode === 'planreview' && p.planReview?.planProjectId === planId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]
}

/** The plan `ref` names (id or key), or a 404/409 — a plan review reads only a plan project. */
export function planProjectRef(store: Store, ref: unknown): Project {
  const plan = typeof ref === 'string' && ref.trim() ? findByRef(store.projects, ref.trim()) : undefined
  if (!plan) throw createError({ statusCode: typeof ref === 'string' && ref.trim() ? 404 : 400, statusMessage: typeof ref === 'string' && ref.trim() ? `plan ${ref} not found` : 'send plan: the plan project to review (PROJ-n)' })
  if (plan.mode !== 'plan') throw createError({ statusCode: 409, statusMessage: `${plan.key} is not a plan project — a plan review reads a plan's spec and ticket plan` })
  return plan
}

/**
 * A new plan review project on `store` (the caller saves): pointed at `plan`
 * (or at none yet — a graph node with no plan before it), in the plan's
 * codebase (`repo` when it has none, or there is no plan). Starts nothing.
 */
export function createPlanReviewProject(store: Store, input: { plan: Project | null; repo?: string; title?: string; description?: string; note?: string }): Project {
  const { plan } = input
  const repo = plan?.repo.trim() || (input.repo ?? '').trim()
  const ts = now()
  const project: Project = {
    id: newId('proj'),
    key: nextKey(store, 'project'),
    title: (input.title ?? '').trim().slice(0, 200) || (plan ? planReviewTitle(plan) : 'Plan review'),
    description: (input.description ?? '').trim() || planReviewDescription(plan, input.note),
    mode: 'planreview',
    repo,
    integrationBranch: '',
    integrationBase: '',
    starred: false,
    position: null,
    hidden: false,
    share: null,
    prompts: {},
    planReview: { planProjectId: plan?.id ?? '', runs: [] },
    createdAt: ts,
    updatedAt: ts,
  }
  store.projects.push(project)
  if (repo) rememberRepo(store, { path: expandHome(repo) })
  return project
}

/** The plan review project `ref`, or a 404/409. */
function planReviewProject(store: Store, ref: string | undefined): Project & { planReview: PlanReview } {
  const project = findByRef(store.projects, ref)
  if (!project) throw createError({ statusCode: 404, statusMessage: 'project not found' })
  if (project.mode !== 'planreview') throw createError({ statusCode: 409, statusMessage: `${project.key} is not a plan review project` })
  project.planReview ??= coercePlanReview({})!
  return project as Project & { planReview: PlanReview }
}

/**
 * POST /api/projects/:id/plan-review {plan} — point a plan review project at
 * its plan: one made by a graph node with no single plan before it, or one
 * whose plan was deleted. Refused once it has run a review of another plan
 * (its findings are about that plan), and on the peer's side of a share. Its
 * title and description follow the plan when they were the defaults.
 */
export function attachPlanToReview(store: Store, projectRef: string | undefined, planRef: unknown): Project {
  const project = planReviewProject(store, projectRef)
  if (project.share && project.share.side !== 'creator') throw createError({ statusCode: 409, statusMessage: `${project.key} is shared with you — only its creator's side picks its plan` })
  const plan = planProjectRef(store, planRef)
  const was = project.planReview.planProjectId
  const wasAlive = !!was && store.projects.some((p) => p.id === was)
  if (wasAlive && was !== plan.id && project.planReview.runs.length) {
    throw createError({ statusCode: 409, statusMessage: `${project.key} has already reviewed another plan — make a new plan review for ${plan.key}` })
  }
  if (project.title === 'Plan review' || !project.title.trim()) project.title = planReviewTitle(plan)
  if (!project.description.trim() || project.description.includes('Pick the plan on the Review tab.')) {
    project.description = planReviewDescription(plan)
  }
  if (!project.repo.trim() && plan.repo) project.repo = plan.repo
  project.planReview = { ...project.planReview, planProjectId: plan.id }
  project.updatedAt = now()
  return project
}

// ── The review ──────────────────────────────────────────────────────────────

const startsInFlight = new Set<string>()

/**
 * The Review tab's Start / Rerun review on a plan review project (POST
 * /api/projects/:id/reviews): ONE agreement review of the plan —
 * `reviewers` (2…4, default 3) on Opus 5.5 high, every agreed finding
 * adversarially verified, no diff. The consensus session hands the findings
 * and the verdict back; the server files them here as record-only tickets (a
 * rerun matches the open ones). 409 while the last review is still out.
 */
export async function startPlanReview(projectId: string, reviewers?: unknown): Promise<{ key: string; path: string; run: PlanReviewRun }> {
  let store = loadStore()
  let project = planReviewProject(store, projectId)
  const refused = planReviewStartProblem({ project, plan: planUnderReview(store, project), reviewers })
  if (refused) throw createError({ statusCode: refused.status, statusMessage: refused.message })
  const count = reviewerCount(reviewers)!
  const id = project.id
  if (startsInFlight.has(id)) throw createError({ statusCode: 409, statusMessage: `${project.key}'s review is already starting` })
  startsInFlight.add(id)
  try {
    const last = project.planReview.runs.at(-1)
    if (last?.status === 'running') {
      // The record says a review is out — ask the review itself.
      const review = last.reviewKey ? await readReview(sanitizeReviewKey(last.reviewKey)) : null
      if (review && (review.status === 'reviewing' || review.status === 'triaging')) {
        throw createError({ statusCode: 409, statusMessage: `${project.key}'s review ${review.key} is still ${review.status} — wait for it, or retry a stuck reviewer from the Review tab` })
      }
      if (review) settlePrReviewRun(review.key, 'done', review.assessment?.verdict)
      else if (last.reviewKey) settlePrReviewRun(last.reviewKey, 'stopped')
      store = loadStore()
      project = planReviewProject(store, id)
    }
    const plan = store.projects.find((p) => p.id === project.planReview.planProjectId)!
    const fact = planFactOf(store, plan)
    const n = (project.planReview.runs.at(-1)?.n ?? 0) + 1
    const res = await createReview({
      repoPath: resolveRepoDir(plan.repo),
      subject: { kind: 'plan', projectKey: plan.key },
      title: `${project.key} · plan ${plan.key} · review ${n} · ${basename(plan.repo.trim()) || plan.title}`,
      reviewers: count,
      project: project.key,
      agreement: { loop: n },
      verify: true,
      model: modelIdFor(REVIEW_RUNNER.model),
      effort: REVIEW_RUNNER.effort,
    })

    const at = now()
    const started: PlanReviewRun = { n, status: 'running', reviewKey: res.key, drafts: fact.drafts, builds: fact.builds, startedAt: at, endedAt: '' }
    store = loadStore()
    project = planReviewProject(store, id)
    project.planReview.runs = [...project.planReview.runs, started].slice(-REVIEW_RUNS_CAP)
    project.updatedAt = at
    saveStore(store)
    return { ...res, run: started }
  } finally {
    startsInFlight.delete(id)
  }
}
