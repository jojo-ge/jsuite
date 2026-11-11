// The review plan's runner — PR review projects' own engine, separate from
// auto mode's (server/utils/autoLoop.ts), which never sees a prreview project.
// Every tick it gathers what reviewRunStep (app/utils/reviewPlan.ts) needs,
// asks it, and does what it says: dispatch checks (/jpr-check, their own
// sessions), ask jReview for the agreement review, move the cursor on,
// finish. All state is on project.prReview.run, so a restart picks it up.
import { basename } from 'node:path'
import {
  advanceReviewRun,
  CHECK_RUNNER,
  planChecks,
  reviewRunRecord,
  reviewRunStep,
  REVIEW_RUNS_CAP,
  type ReviewRun,
  type ReviewRunWorld,
} from '../../app/utils/reviewPlan'
import type { Project } from './store'

/** Change the run in place, under a fresh store read. `fn` returning false = nothing to save. */
function updateRun(projectId: string, fn: (run: ReviewRun, project: Project) => void | boolean): ReviewRun | null {
  const store = loadStore()
  const project = store.projects.find((p) => p.id === projectId)
  const run = project?.prReview?.run
  if (!project || !run) return null
  if (fn(run, project) === false) return run
  project.updatedAt = now()
  saveStore(store)
  return run
}

async function reviewWorld(project: Project, run: ReviewRun): Promise<ReviewRunWorld> {
  const store = loadStore()
  const tickets = store.tickets.filter((t) => t.projectId === project.id).map((t) => ({ key: t.key, status: t.status }))
  let review: ReviewRunWorld['review'] = null
  if (run.reviewKey) {
    try {
      const r = await jreviewFetch<{ status: 'reviewing' | 'triaging' | 'triaged' | 'ticketed'; assessment?: { verdict?: string } }>(`/api/reviews/${encodeURIComponent(run.reviewKey)}`)
      review = { status: r.status, verdict: r.assessment?.verdict }
    } catch (err: any) {
      review = err?.statusCode === 404 ? 'missing' : 'unreachable'
    }
  }
  return { now: Date.now(), tickets, review }
}

/** One project's tick. Never throws. */
async function tickReviewRun(projectId: string): Promise<void> {
  try {
    const store = loadStore()
    const project = store.projects.find((p) => p.id === projectId)
    const run = project?.prReview?.run
    if (!project || !run || run.status !== 'running') return
    const step = reviewRunStep(run, await reviewWorld(project, run))
    switch (step.kind) {
      case 'none':
      case 'wait':
        return
      case 'pause':
        updateRun(projectId, (r) => {
          r.status = 'paused'
          r.pausedFor = step.detail
        })
        return
      case 'advance':
        updateRun(projectId, (r, p) => {
          Object.assign(r, advanceReviewRun(r, now()))
          p.prReview!.run = r
        })
        return
      case 'finish':
        updateRun(projectId, (r, p) => {
          r.status = 'done'
          r.endedAt = now()
          p.prReview!.runs = [...p.prReview!.runs, reviewRunRecord(r, step.verdict)].slice(-REVIEW_RUNS_CAP)
        })
        return
      case 'dispatchChecks':
        await dispatchChecks(projectId, step.keys)
        return
      case 'startReview':
        await startRunReview(projectId)
        return
    }
  } catch (err) {
    console.error(`[jticket] review run tick failed for ${projectId}:`, err)
  }
}

/** Each check in its own session, claimed before the dispatch so a restart never sends it twice. */
async function dispatchChecks(projectId: string, keys: string[]) {
  for (const key of keys) {
    let claimed = false as boolean
    updateRun(projectId, (r) => {
      if (r.status !== 'running' || r.dispatched[key]) return false
      r.dispatched[key] = now()
      claimed = true
    })
    if (!claimed) continue
    try {
      const store = loadStore()
      const ticket = store.tickets.find((t) => t.key === key)
      const project = store.projects.find((p) => p.id === projectId)
      if (!ticket || !project) throw new Error(`${key} no longer exists`)
      const step = project.prReview!.run!.plan.steps[project.prReview!.run!.cursor]
      const runner = step?.runners[key] ?? CHECK_RUNNER
      const prompt = `${modeTicketPrompt(store, project, ticket)} — run ${project.prReview!.run!.n} of ${project.key}'s review plan: nobody is watching this pane, so decide rather than ask, and finish by marking ${key} done with its verdict.`
      await dispatchTicketSession(store, ticket, prompt, { model: modelIdFor(runner.model), effort: runner.effort })
    } catch (err: any) {
      updateRun(projectId, (r) => {
        delete r.dispatched[key]
        r.status = 'paused'
        r.pausedFor = `could not dispatch ${key}: ${String(err?.statusMessage ?? err?.message ?? err).slice(0, 300)}`
      })
      return
    }
  }
}

/** Ask jReview for the run's agreement review of the PR's diff. */
async function startRunReview(projectId: string) {
  let body = null as Record<string, unknown> | null
  updateRun(projectId, (r, project) => {
    if (r.status !== 'running' || r.reviewRequestedAt) return false
    const step = r.plan.steps[r.cursor]
    const pr = project.prReview!.pr
    if (step?.kind !== 'review') return false
    body = {
      repoPath: resolveRepoDir(project.repo),
      branch: project.integrationBranch,
      base: prReviewBase(pr),
      pr: pr.number,
      title: `${project.key} · PR #${pr.number} · run ${r.n} · ${basename(project.repo.trim()) || project.title}`,
      reviewers: step.reviewers,
      project: project.key,
      agreement: { loop: r.n },
      verify: step.verify,
      model: modelIdFor(step.model),
      effort: step.effort,
      context: {
        ...(project.prReview!.assessment?.briefDoc ? { brief: project.prReview!.assessment.briefDoc } : {}),
        ...(planChecks(r.plan).length ? { checks: planChecks(r.plan) } : {}),
      },
    }
    r.reviewRequestedAt = now()
  })
  if (!body) return
  try {
    const res = await jreviewFetch<{ key: string }>('/api/reviews', { method: 'POST', body, timeout: 60_000 })
    updateRun(projectId, (r) => {
      r.reviewKey = res.key
    })
  } catch (err: any) {
    updateRun(projectId, (r) => {
      r.reviewRequestedAt = ''
      r.status = 'paused'
      r.pausedFor = `jReview: ${String(err?.message ?? err).slice(0, 300)}`
    })
  }
}

let ticking = false
/** Tick every running review plan, one project at a time (herdr dispatches must not overlap). */
export async function tickReviewRuns(): Promise<void> {
  if (ticking) return
  ticking = true
  try {
    const ids = loadStore().projects.filter((p) => p.prReview?.run?.status === 'running').map((p) => p.id)
    for (const id of ids) await tickReviewRun(id)
  } finally {
    ticking = false
  }
}

/** Kick a tick now (a start, a retry) rather than waiting for the timer. */
export function nudgeReviewRuns(): Promise<void> {
  return tickReviewRuns().catch(() => {})
}
