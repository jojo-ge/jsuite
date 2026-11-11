// The Diff tab's guided tours: which tour a target has, Build tour (one
// `/jdiff-tour` session in herdr), cancel, and the session's hand-back. The
// endpoints under server/api/projects/[id]/diff/tour/ are thin wrappers.
//
// Ported from jDiff's tour-dispatch / review-artifact / review-complete /
// ai-job-cancel, detail tours only. Unlike jDiff, the dispatch never takes
// focus: the session opens --no-focus in its own 'PROJ-n · tour …' tab, like
// every other jTicket hand-off.
//
// Tours are for the human reading the diff. Nothing hands them to reviewers.
import { diffTargetParams, parseDiffTarget, type DiffTargetQuery } from '../../app/utils/diffTarget'
import { tourKeyFor, type TourView } from '../../app/utils/tour'
import type { Project, Store } from './store'
import { cleanTour } from './tourArtifact'
import { clearTourFailure, clearTourJob, getTourJob, recordTourFailure, registerTourJob, tourFailure, type TourJob } from './tourJobs'
import { loadTour, saveTour } from './tourStore'

export interface TourContext {
  store: Store
  project: Project
  repoDir: string
  target: DiffTargetQuery
  /** The tour store key (app/utils/tour.ts tourKeyFor). */
  key: string
}

/** A project ref + a target query/body → everything a tour call needs. 404/400 on a bad ref or target. */
export function tourContext(projectRef: string | undefined, raw: Record<string, unknown>): TourContext {
  const store = loadStore()
  const project = store.projects.find((p) => p.id === projectRef || p.key === projectRef)
  if (!project) throw createError({ statusCode: 404, statusMessage: 'project not found' })
  const repoDir = resolveRepoDir(project.repo)
  const target = parseDiffTarget(raw)
  let prKey = ''
  if (target.pr) {
    const pr = findPrRef(store, target.pr)
    if (!pr || pr.projectId !== project.id) throw createError({ statusCode: 404, statusMessage: `no local PR ${target.pr} in ${project.key}` })
    prKey = pr.key
  }
  const key = tourKeyFor(target, project, prKey)
  if (!key) throw createError({ statusCode: 400, statusMessage: 'this project has no integration branch — cut or set one on the Overview tab' })
  return { store, project, repoDir, target, key }
}

/** What the Diff tab shows: the target's detail tour (never an overview or chain tour jDiff left) and its build state. */
export function tourView(ctx: TourContext): TourView {
  const saved = loadTour(ctx.repoDir, ctx.key, 'detail')
  const job = getTourJob(ctx.repoDir, ctx.key)
  const failure = tourFailure(ctx.repoDir, ctx.key)
  return {
    key: ctx.key,
    tour: saved?.tour ?? null,
    createdAt: saved?.createdAt ?? '',
    job: job ? { startedAt: job.startedAt, agent: job.agent } : null,
    failure: job ? '' : failure,
  }
}

/** The `/jdiff-tour` invocation: who to post back to, the target, and the exact commits to read. */
export function tourPrompt(projectKey: string, target: DiffTargetQuery, baseOid: string, headOid: string): string {
  return `/jdiff-tour project=${projectKey} target=${JSON.stringify(diffTargetParams(target))} range=${baseOid}...${headOid} head=${headOid}`
}

/** herdr agent names: the key with anything but [A-Za-z0-9-] folded to '-'. */
const agentSlug = (s: string) => s.replace(/[^A-Za-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60)

/**
 * Build tour: one Opus `/jdiff-tour` session over the target's exact commits,
 * in a new --no-focus tab. A run already live for the target is attached to,
 * never doubled.
 */
export async function buildTour(ctx: TourContext): Promise<{ job: TourJob; attached: boolean }> {
  const live = getTourJob(ctx.repoDir, ctx.key)
  if (live) return { job: live, attached: true }
  // A second Build while the first is still resolving the diff and starting
  // its session attaches to that one rather than dispatching twice.
  const flightKey = `${ctx.repoDir}\n${ctx.key}`
  const pending = starting.get(flightKey)
  if (pending) return { job: await pending, attached: true }
  const start = startTour(ctx)
  starting.set(flightKey, start)
  try {
    return { job: await start, attached: false }
  } finally {
    starting.delete(flightKey)
  }
}

const starting = new Map<string, Promise<TourJob>>()

async function startTour(ctx: TourContext): Promise<TourJob> {
  const resolved = await resolveDiffTarget(ctx.store, ctx.project, ctx.repoDir, ctx.target)
  const diff = await loadProjectDiff(ctx.repoDir, resolved)
  if (!diff.files.length) throw createError({ statusCode: 400, statusMessage: `${resolved.head} has no changes against ${resolved.base} — nothing to tour` })

  const prompt = tourPrompt(ctx.project.key, ctx.target, diff.target.baseOid, diff.target.headOid)
  const startedAt = Date.now()
  const label = `tour · ${ctx.key.replace(/^branch\//, '')}`
  const { agent, tabId } = await dispatchProjectSession(ctx.project, label, prompt, {
    model: TOUR_MODEL,
    agent: `tour-${ctx.project.key}-${agentSlug(ctx.key)}`,
    session: { role: 'tour' },
  })
  return registerTourJob({ repo: ctx.repoDir, key: ctx.key, startedAt, agent, tabId })
}

/**
 * Stop tracking a run. The session is herdr's, so this can't kill it: it sends
 * esc twice (best-effort) and clears the job so the tab settles. The pane stays
 * for the human to read or close.
 */
export async function cancelTour(ctx: TourContext): Promise<{ cancelled: boolean }> {
  const job = clearTourJob(ctx.repoDir, ctx.key)
  if (job) {
    for (let i = 0; i < 2; i++) await herdrJson(['agent', 'send-keys', job.agent, 'esc']).catch(() => {})
  }
  return { cancelled: !!job }
}

/** The session's tour: cleaned, saved as the target's detail tour, and the run settled. */
export function saveTourArtifact(ctx: TourContext, artifact: unknown): { saved: 'tour'; key: string; stops: number; createdAt: string } {
  if (!artifact || typeof artifact !== 'object') throw createError({ statusCode: 400, statusMessage: 'missing artifact' })
  const tour = cleanTour(artifact)
  const createdAt = new Date().toISOString()
  saveTour({ repo: ctx.repoDir, number: ctx.key, variant: 'detail', tour, createdAt })
  clearTourJob(ctx.repoDir, ctx.key)
  clearTourFailure(ctx.repoDir, ctx.key)
  return { saved: 'tour', key: ctx.key, stops: tour.stops.length, createdAt }
}

/** The session's sign-off: records why it failed (when it did) and settles the run. */
export function completeTour(ctx: TourContext, failures: unknown): { done: true; wasTracked: boolean } {
  const messages = (Array.isArray(failures) ? failures : [])
    .map((f: any) => (typeof f?.message === 'string' ? f.message.trim() : ''))
    .filter(Boolean)
  if (messages.length) {
    recordTourFailure(ctx.repoDir, ctx.key, messages.join('; '))
    console.error(`[jticket] tour ${ctx.project.key} ${ctx.key} failed: ${messages.join('; ')}`)
  }
  return { done: true, wasTracked: !!clearTourJob(ctx.repoDir, ctx.key) }
}
