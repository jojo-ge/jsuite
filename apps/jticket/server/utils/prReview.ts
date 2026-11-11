// PR review projects, server side — making one, keeping its copy of the PR
// head fresh, dispatching the Fable assessor, and the human's run controls.
// The shapes and the runner's decisions are app/utils/reviewPlan.ts; the
// runner itself is server/utils/reviewRun.ts.
//
// The project never touches the PR: its integration branch is a LOCAL branch
// (jreview/pr-<n>) fetched from GitHub's refs/pull/<n>/head, never pushed;
// checks run in throwaway worktrees of it; the review reads it. The only
// thing that ever reaches GitHub is the human's Post to PR press (jReview's
// /pr-comments, a COMMENT review — never an approval).
import {
  CHECK_LABEL,
  coercePrReview,
  newReviewRun,
  planChecks,
  prBranchName,
  retryReviewRun,
  reviewPlanProblems,
  reviewRunRecord,
  REVIEW_RUNS_CAP,
  type PrAssessment,
  type PrInfo,
  type PrReview,
  type ReviewPlan,
  type ReviewPlanProblem,
} from '../../app/utils/reviewPlan'
import type { Project, Store } from './store'
import { expandHome, isSafeRef, probeRepo, resolveRepoDir, run } from './github'
import { branchOid } from './localPrs'

/** The assessor: one Fable 5.2 session at high effort. */
export const ASSESS_MODEL = 'claude-fable-5-2'
export const ASSESS_EFFORT = 'high'

/** `gh pr view` for PR `n` of the repo's GitHub remote. 400 with gh's message when it can't. */
export async function ghPrInfo(repoDir: string, n: number): Promise<Omit<PrInfo, 'fetchedAt'>> {
  let raw: any
  try {
    raw = JSON.parse(
      await run('gh', ['pr', 'view', String(n), '--json', 'number,title,url,author,headRefName,baseRefName,isDraft,state,headRefOid'], repoDir),
    )
  } catch (err: any) {
    throw createError({ statusCode: 400, statusMessage: `gh could not read PR #${n}: ${String(err?.statusMessage ?? err?.message ?? err).slice(0, 300)}` })
  }
  return {
    number: Number(raw.number),
    title: String(raw.title ?? ''),
    url: String(raw.url ?? ''),
    author: String(raw.author?.login ?? ''),
    headRefName: String(raw.headRefName ?? ''),
    baseRefName: String(raw.baseRefName ?? ''),
    isDraft: raw.isDraft === true,
    state: String(raw.state ?? 'OPEN'),
    headSha: String(raw.headRefOid ?? ''),
  }
}

/**
 * Fetch the PR head into the project's local branch and the base into
 * origin's — works for PRs from forks too (GitHub serves every PR's head at
 * refs/pull/<n>/head). Forced: the PR may have been force-pushed, and the
 * branch is a mirror, never anyone's work. Returns the PR as fetched.
 */
export async function fetchPr(repoDir: string, n: number): Promise<PrInfo> {
  const info = await ghPrInfo(repoDir, n)
  if (!isSafeRef(info.baseRefName)) throw createError({ statusCode: 400, statusMessage: `PR #${n}'s base is not a usable ref: ${info.baseRefName}` })
  await run('git', ['fetch', '--quiet', 'origin', `+refs/pull/${n}/head:refs/heads/${prBranchName(n)}`, `+refs/heads/${info.baseRefName}:refs/remotes/origin/${info.baseRefName}`], repoDir)
  const headSha = (await branchOid(repoDir, prBranchName(n))) ?? info.headSha
  return { ...info, headSha, fetchedAt: now() }
}

/** The fixed point a PR review reads its diff from: origin's copy of the base (fetchPr keeps it fresh). */
export const prReviewBase = (pr: PrInfo) => `origin/${pr.baseRefName}`

/** The PR review project for (repo, PR) — the newest, if several. */
export function findPrReviewProject(store: Store, repoDir: string, n: number): Project | undefined {
  return store.projects
    .filter((p) => p.mode === 'prreview' && p.prReview?.pr.number === n && expandHome(p.repo) === repoDir)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]
}

/**
 * POST /api/projects/pr-review — get-or-create the PR review project for PR
 * `n` of `repo`. A new one fetches the PR, makes the project (mode
 * 'prreview', integration branch jreview/pr-<n>) with an empty plan; an
 * existing one just has its PR refreshed.
 */
export async function ensurePrReviewProject(repo: string, n: number): Promise<{ project: Project; created: boolean }> {
  const probe = await probeRepo(repo)
  if (!probe.ok) throw createError({ statusCode: 400, statusMessage: `${probe.error}: ${probe.path}` })
  if (!Number.isInteger(n) || n <= 0) throw createError({ statusCode: 400, statusMessage: 'pr must be a pull request number' })
  const pr = await fetchPr(probe.path, n)

  const store = loadStore()
  const existing = findPrReviewProject(store, probe.path, n)
  if (existing) {
    existing.prReview = { ...(existing.prReview ?? emptyPrReview(pr)), pr }
    existing.updatedAt = now()
    saveStore(store)
    return { project: existing, created: false }
  }
  const ts = now()
  const name = probe.path.split('/').filter(Boolean).pop() || probe.path
  const project: Project = {
    id: newId('proj'),
    key: nextKey(store, 'project'),
    title: `PR #${n} · ${pr.title}`.slice(0, 200),
    description: [
      `Review of pull request [#${n} — ${pr.title}](${pr.url}) by @${pr.author || 'unknown'} in \`${name}\` (\`${pr.headRefName}\` → \`${pr.baseRefName}\`).`,
      '',
      'How this project works:',
      `1. **Assess** (Review setup tab): one Fable 5.2 session (\`/jreview-assess\`) reads the PR, decides how many reviewers it needs (2–4) and what they focus on, writes the brief every reviewer reads, adds \`${CHECK_LABEL}\` check tickets when running something proves more than reading, and saves the review plan.`,
      '2. **Run the plan**: checks run against the PR head in throwaway worktrees (`/jpr-check`, read-only); then the reviewers review the PR on the same brief, a consensus session keeps what every one of them raised, has each finding adversarially verified, and judges approvability.',
      '3. **Your call** (Review tab): read the findings and the verdict, post the ones you want to the PR as a COMMENT review under your name, or Rerun after the PR changes. Nothing here ever approves the PR, pushes to it, or comments without your press.',
      '',
      `The integration branch \`${prBranchName(n)}\` is a local mirror of the PR head — never pushed.`,
    ].join('\n'),
    mode: 'prreview',
    repo: probe.path,
    integrationBranch: prBranchName(n),
    starred: false,
    position: null,
    hidden: false,
    share: null,
    prompts: {},
    prReview: emptyPrReview(pr),
    createdAt: ts,
    updatedAt: ts,
  }
  store.projects.push(project)
  rememberRepo(store, { path: probe.path, slug: probe.slug ?? '', defaultBranch: probe.defaultBranch })
  saveStore(store)
  return { project, created: true }
}

function emptyPrReview(pr: PrInfo): PrReview {
  return { pr, assessment: null, assessing: null, plan: null, run: null, runs: [] }
}

/** The PR review project `id`, or a 404/409. */
export function prReviewProject(store: Store, id: string | undefined): Project & { prReview: PrReview } {
  const project = store.projects.find((p) => p.id === id || p.key === id)
  if (!project) throw createError({ statusCode: 404, statusMessage: 'project not found' })
  if (project.mode !== 'prreview' || !project.prReview) throw createError({ statusCode: 409, statusMessage: `${project.key} is not a PR review project` })
  if (project.share && project.share.side !== 'creator') throw createError({ statusCode: 409, statusMessage: `${project.key} is shared with you — only its creator's side runs its review` })
  return project as Project & { prReview: PrReview }
}

/** The project's tickets as the plan validator reads them. */
export function reviewPlanTickets(store: Store, project: Project) {
  return store.tickets.filter((t) => t.projectId === project.id).map((t) => ({ key: t.key, status: t.status, labels: t.labels }))
}

/** PUT /api/projects/:id/review-plan — save it (refused while a run is going). */
export function saveReviewPlan(store: Store, project: Project & { prReview: PrReview }, plan: ReviewPlan): { plan: ReviewPlan; problems: ReviewPlanProblem[] } {
  if (project.prReview.run?.status === 'running' || project.prReview.run?.status === 'paused') {
    throw createError({ statusCode: 409, statusMessage: `${project.key}'s review is running — Stop it first, then the plan can change` })
  }
  project.prReview.plan = plan
  project.updatedAt = now()
  return { plan, problems: reviewPlanProblems(plan, reviewPlanTickets(store, project)) }
}

// ── The assessor ────────────────────────────────────────────────────────────

/** POST …/pr-review/assess — dispatch /jreview-assess. A live one is refused; a lost one is replaced. */
export async function startAssessment(projectId: string, autoStart: boolean): Promise<{ agent: string; paneId: string }> {
  let store = loadStore()
  let project = prReviewProject(store, projectId)
  if (project.prReview.run?.status === 'running') throw createError({ statusCode: 409, statusMessage: `${project.key}'s review is running — stop it before reassessing` })
  if (project.prReview.assessing) {
    const agents = await herdrAgents()
    if (agents?.has(project.prReview.assessing.agent) ?? true) {
      throw createError({ statusCode: 409, statusMessage: `Fable 5.2 is already assessing ${project.key} (since ${project.prReview.assessing.startedAt}) — cancel it first to start over` })
    }
  }
  // Assess the PR as it is now.
  const pr = await fetchPr(resolveRepoDir(project.repo), project.prReview.pr.number)
  store = loadStore()
  project = prReviewProject(store, projectId)
  project.prReview.pr = pr
  saveStore(store)

  const prompt = assessPrompt(store, project)
  const { agent, paneId } = await dispatchProjectSession(project, 'pr assess', prompt, { model: ASSESS_MODEL, effort: ASSESS_EFFORT, session: { role: 'pr-assess' } })
  store = loadStore()
  project = prReviewProject(store, projectId)
  project.prReview.assessing = { agent, paneId, startedAt: now(), autoStart }
  project.updatedAt = now()
  saveStore(store)
  return { agent, paneId }
}

/** DELETE …/pr-review/assess — close the assessor's pane (best-effort) and clear the mark. */
export async function cancelAssessment(projectId: string): Promise<boolean> {
  const store = loadStore()
  const project = prReviewProject(store, projectId)
  const was = project.prReview.assessing
  project.prReview.assessing = null
  project.updatedAt = now()
  saveStore(store)
  if (was?.paneId) {
    try {
      await herdrJson(['pane', 'close', was.paneId])
      invalidateHerdrState()
    } catch { /* gone already */ }
  }
  return !!was
}

/**
 * POST …/pr-review/assessed — the assessor's report-back. Records the
 * assessment and, when the Assess button asked for it and the plan it saved
 * has no problems, starts the run.
 */
export async function recordAssessment(projectId: string, body: any): Promise<{ assessment: PrAssessment; problems: ReviewPlanProblem[]; started: boolean }> {
  const store = loadStore()
  const project = prReviewProject(store, projectId)
  const parsed = coercePrReview({ pr: project.prReview.pr, assessment: { ...body, assessedAt: now() } })!.assessment!
  if (!parsed.briefDoc) throw createError({ statusCode: 400, statusMessage: 'briefDoc must be the DOC-n of the brief you published' })
  if (!store.docs.some((d) => d.key === parsed.briefDoc)) throw createError({ statusCode: 400, statusMessage: `${parsed.briefDoc} is not a jTicket doc` })
  if (!project.prReview.plan) throw createError({ statusCode: 409, statusMessage: `${project.key} has no review plan — PUT /api/projects/${project.key}/review-plan first` })
  const problems = reviewPlanProblems(project.prReview.plan, reviewPlanTickets(store, project))
  const autoStart = project.prReview.assessing?.autoStart ?? false
  project.prReview.assessment = parsed
  project.prReview.assessing = null
  project.updatedAt = now()
  saveStore(store)
  let started = false
  if (autoStart && !problems.length) {
    await controlReviewRun(projectId, 'start')
    started = true
  }
  return { assessment: parsed, problems, started }
}

// ── The human's controls (POST …/review-run) ────────────────────────────────

export type ReviewRunAction = 'start' | 'rerun' | 'stop' | 'continue' | 'retry'

/**
 * start  — run the plan against the PR as it is now (its head is re-fetched)
 * rerun  — the same, after reopening every check so it runs against the new head
 * stop   — end the run now (sessions already in herdr carry on)
 * continue — pass the gate in progress
 * retry  — clear a pause and run the step it stopped on again
 */
export async function controlReviewRun(projectId: string, action: ReviewRunAction): Promise<PrReview> {
  let store = loadStore()
  let project = prReviewProject(store, projectId)
  const live = project.prReview.run?.status === 'running' || project.prReview.run?.status === 'paused'

  if (action === 'start' || action === 'rerun') {
    if (live) throw createError({ statusCode: 409, statusMessage: `${project.key}'s review is already running` })
    if (project.prReview.assessing) throw createError({ statusCode: 409, statusMessage: `Fable 5.2 is still assessing ${project.key} — wait for it, or cancel it` })
    const plan = project.prReview.plan
    if (!plan) throw createError({ statusCode: 409, statusMessage: `${project.key} has no review plan — Assess the PR first` })
    const problems = reviewPlanProblems(plan, reviewPlanTickets(store, project))
    if (problems.length) throw createError({ statusCode: 409, statusMessage: `the review plan can't run: ${problems.map((p) => p.message).join(' ')}` })
    const pr = await fetchPr(resolveRepoDir(project.repo), project.prReview.pr.number)
    store = loadStore()
    project = prReviewProject(store, projectId)
    const at = now()
    // A rerun reviews the new head, so every check runs again.
    if (action === 'rerun') {
      const checks = new Set(planChecks(plan))
      for (const t of store.tickets) {
        if (t.projectId !== project.id || !checks.has(t.key) || t.status === 'todo') continue
        t.status = 'todo'
        t.completedAt = null
        t.assignee = ''
        t.updatedAt = at
      }
    }
    const n = (project.prReview.runs.at(-1)?.n ?? project.prReview.run?.n ?? 0) + 1
    project.prReview.pr = pr
    project.prReview.run = newReviewRun(n, plan, pr.headSha, at)
    project.updatedAt = at
    saveStore(store)
    void nudgeReviewRuns()
    return project.prReview
  }

  const run = project.prReview.run
  if (!run || !live) throw createError({ statusCode: 409, statusMessage: `${project.key} has no review running` })
  const at = now()
  if (action === 'stop') {
    const ended = { ...run, status: 'stopped' as const, endedAt: at }
    project.prReview.run = ended
    project.prReview.runs = [...project.prReview.runs, reviewRunRecord(ended)].slice(-REVIEW_RUNS_CAP)
  } else if (action === 'continue') {
    project.prReview.run = { ...run, gatePassed: true }
  } else if (action === 'retry') {
    const step = run.plan.steps[run.cursor]
    const open = step?.kind === 'checks' ? step.tickets.filter((k) => !store.tickets.some((t) => t.key === k && (t.status === 'done' || t.status === 'merged'))) : []
    project.prReview.run = retryReviewRun(run, at, open)
  } else {
    throw createError({ statusCode: 400, statusMessage: `unknown action: ${action}` })
  }
  project.updatedAt = at
  saveStore(store)
  if (action !== 'stop') void nudgeReviewRuns()
  return project.prReview
}
