// PR review projects, server side — making one, keeping its copy of the PR
// head fresh, and starting its review. The shapes are app/utils/prReview.ts.
//
// The project never touches the PR: its integration branch is a LOCAL branch
// (jreview/pr-<n>) fetched from GitHub's refs/pull/<n>/head, never pushed; the
// review reads it. The only thing that ever reaches GitHub is the human's
// Post to PR press (/pr-comments, a COMMENT review — never an approval).
import { basename } from 'node:path'
import {
  prBranchName,
  REVIEW_REVIEWERS_MAX,
  REVIEW_REVIEWERS_MIN,
  REVIEW_RUNNER,
  REVIEW_RUNS_CAP,
  reviewerCount,
  settleRun,
  UNATTACHED_REVIEW_TITLE,
  type PrInfo,
  type PrReview,
  type PrReviewRun,
} from '../../app/utils/prReview'
import type { Project, Store } from './store'
import { findByRef } from './ids'
import { expandHome, isSafeRef, probeRepo, resolveRepoDir, run } from './github'
import { branchOid } from './localPrs'
import { readReview, sanitizeReviewKey } from './reviewStore'
import { createReview } from './reviewActions'

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
 * `n` of `repo`. A new one fetches the PR and makes the project (mode
 * 'prreview', integration branch jreview/pr-<n>); an existing one just has
 * its PR refreshed.
 */
export async function ensurePrReviewProject(repo: string, n: number): Promise<{ project: Project; created: boolean }> {
  const probe = await probeRepo(repo)
  if (!probe.ok) throw createError({ statusCode: 400, statusMessage: `${probe.error}: ${probe.path}` })
  if (!Number.isInteger(n) || n <= 0) throw createError({ statusCode: 400, statusMessage: 'pr must be a pull request number' })
  const pr = await fetchPr(probe.path, n)

  const store = loadStore()
  const existing = findPrReviewProject(store, probe.path, n)
  if (existing) {
    existing.prReview = { runs: [], ...existing.prReview, pr }
    existing.updatedAt = now()
    saveStore(store)
    return { project: existing, created: false }
  }
  const ts = now()
  const project: Project = {
    id: newId('proj'),
    key: nextKey(store, 'project'),
    title: prReviewTitle(pr),
    description: prReviewDescription(probe.path, pr),
    mode: 'prreview',
    repo: probe.path,
    integrationBranch: prBranchName(n),
    integrationBase: '',
    starred: false,
    position: null,
    hidden: false,
    share: null,
    prompts: {},
    prReview: { pr, runs: [] },
    createdAt: ts,
    updatedAt: ts,
  }
  store.projects.push(project)
  rememberRepo(store, { path: probe.path, slug: probe.slug ?? '', defaultBranch: probe.defaultBranch })
  saveStore(store)
  return { project, created: true }
}

const prReviewTitle = (pr: PrInfo) => `PR #${pr.number} · ${pr.title}`.slice(0, 200)

function prReviewDescription(repoDir: string, pr: PrInfo): string {
  const name = repoDir.split('/').filter(Boolean).pop() || repoDir
  return [
    `Review of pull request [#${pr.number} — ${pr.title}](${pr.url}) by @${pr.author || 'unknown'} in \`${name}\` (\`${pr.headRefName}\` → \`${pr.baseRefName}\`).`,
    '',
    'How this project works:',
    '1. **Start review** (Review tab): the PR head is re-fetched, 2–4 reviewers review its diff, and a consensus session keeps only what every one of them raised, has each finding adversarially verified, judges approvability and writes the summary.',
    '2. **Your call** (Review tab): read the verdict, the summary and the findings — each one is a record-only ticket on this board — then post the ones you want to the PR as a COMMENT review under your name, or Rerun after the PR changes. Nothing here ever approves the PR, pushes to it, or comments without your press.',
    '',
    `The integration branch \`${prBranchName(pr.number)}\` is a local mirror of the PR head — never pushed.`,
  ].join('\n')
}

/**
 * POST /api/projects with mode 'prreview' — a review project with no pull
 * request yet (the create modal's Review type). It needs its repo, since that
 * is whose open PRs its picker lists; nothing is fetched and nothing started.
 * The title is optional: left blank, the PR names the project when attached.
 */
export async function createUnattachedReviewProject(input: { repo?: string; title?: string; description?: string }): Promise<Project> {
  const probe = await probeRepo(String(input.repo ?? ''))
  if (!probe.ok) {
    throw createError({ statusCode: 400, statusMessage: probe.path ? `${probe.error}: ${probe.path}` : 'a review project needs a repo — its pull request is picked from that repo\'s open PRs' })
  }
  const store = loadStore()
  const ts = now()
  const project: Project = {
    id: newId('proj'),
    key: nextKey(store, 'project'),
    title: String(input.title ?? '').trim().slice(0, 200) || UNATTACHED_REVIEW_TITLE,
    description: String(input.description ?? '').trim(),
    mode: 'prreview',
    repo: probe.path,
    integrationBranch: '',
    integrationBase: '',
    starred: false,
    position: null,
    hidden: false,
    share: null,
    prompts: {},
    prReview: null,
    createdAt: ts,
    updatedAt: ts,
  }
  store.projects.push(project)
  rememberRepo(store, { path: probe.path, slug: probe.slug ?? '', defaultBranch: probe.defaultBranch })
  saveStore(store)
  return project
}

/**
 * POST /api/projects/:id/pr-review {pr} — give a review project that has no
 * pull request PR `n` of its repo: the head is fetched onto jreview/pr-<n>,
 * which becomes the integration branch. A title or description the human
 * wrote is kept; blank ones become the PR's. Refused once a PR is attached (a
 * review project keeps its pull request) and for a PR another project
 * already reviews.
 */
export async function attachPrToReviewProject(projectId: string | undefined, n: number): Promise<Project> {
  const unattached = (store: Store) => {
    const project = findByRef(store.projects, projectId)
    if (!project) throw createError({ statusCode: 404, statusMessage: 'project not found' })
    if (project.mode !== 'prreview') throw createError({ statusCode: 409, statusMessage: `${project.key} is not a review project` })
    if (project.share && project.share.side !== 'creator') throw createError({ statusCode: 409, statusMessage: `${project.key} is shared with you — only its creator's side picks its pull request` })
    if (project.prReview) throw createError({ statusCode: 409, statusMessage: `${project.key} already reviews PR #${project.prReview.pr.number} — a review project keeps its pull request` })
    const repoDir = resolveRepoDir(project.repo)
    const other = findPrReviewProject(store, repoDir, n)
    if (other) throw createError({ statusCode: 409, statusMessage: `${other.key} already reviews PR #${n}` })
    return { project, repoDir }
  }
  if (!Number.isInteger(n) || n <= 0) throw createError({ statusCode: 400, statusMessage: 'pr must be a pull request number' })
  const pr = await fetchPr(unattached(loadStore()).repoDir, n)
  // The fetch takes seconds: read the store again rather than write a stale copy over it.
  const store = loadStore()
  const { project, repoDir } = unattached(store)
  project.prReview = { pr, runs: [] }
  project.integrationBranch = prBranchName(n)
  if (!project.title.trim() || project.title === UNATTACHED_REVIEW_TITLE) project.title = prReviewTitle(pr)
  if (!project.description.trim()) project.description = prReviewDescription(repoDir, pr)
  project.updatedAt = now()
  saveStore(store)
  return project
}

/** The PR review project `id`, or a 404/409. */
export function prReviewProject(store: Store, id: string | undefined): Project & { prReview: PrReview } {
  const project = findByRef(store.projects, id)
  if (!project) throw createError({ statusCode: 404, statusMessage: 'project not found' })
  if (project.mode !== 'prreview') throw createError({ statusCode: 409, statusMessage: `${project.key} is not a review project` })
  if (!project.prReview) throw createError({ statusCode: 409, statusMessage: `${project.key} has no pull request yet — pick one on its page (POST /api/projects/${project.key}/pr-review {pr})` })
  if (project.share && project.share.side !== 'creator') throw createError({ statusCode: 409, statusMessage: `${project.key} is shared with you — only its creator's side runs its review` })
  return project as Project & { prReview: PrReview }
}

// ── The review ──────────────────────────────────────────────────────────────

const startsInFlight = new Set<string>()

/**
 * The Review tab's Start / Rerun review on a PR review project (POST
 * /api/projects/:id/reviews): re-fetch the PR head, then start ONE agreement
 * review of its diff — `reviewers` (2…4, default 3) on Opus 5.5, every agreed
 * finding adversarially verified. The consensus session hands the findings,
 * the verdict and the summary back; the server files the findings on this
 * project as record-only tickets (a rerun matches the open ones).
 *
 * 409 while the project's last review is still out — a stuck reviewer is
 * retried from the Review tab, not by starting a second review beside it.
 */
export async function startPrReview(projectId: string, reviewers?: unknown): Promise<{ key: string; path: string; run: PrReviewRun }> {
  let store = loadStore()
  let project = prReviewProject(store, projectId)
  const count = reviewerCount(reviewers)
  if (count === null) throw createError({ statusCode: 400, statusMessage: `reviewers must be ${REVIEW_REVIEWERS_MIN}…${REVIEW_REVIEWERS_MAX} — an agreement review needs at least two to agree` })
  const id = project.id
  if (startsInFlight.has(id)) throw createError({ statusCode: 409, statusMessage: `${project.key}'s review is already starting` })
  startsInFlight.add(id)
  try {
    const last = project.prReview.runs.at(-1)
    if (last?.status === 'running') {
      // The record says a review is out — ask the review itself.
      const review = last.reviewKey ? await readReview(sanitizeReviewKey(last.reviewKey)) : null
      if (review && (review.status === 'reviewing' || review.status === 'triaging')) {
        throw createError({ statusCode: 409, statusMessage: `${project.key}'s review ${review.key} is still ${review.status} — wait for it, or retry a stuck reviewer from the Review tab` })
      }
      if (review) settlePrReviewRun(review.key, 'done', review.assessment?.verdict)
      else if (last.reviewKey) settlePrReviewRun(last.reviewKey, 'stopped')
    }
    // Review the PR as it is now.
    const pr = await fetchPr(resolveRepoDir(project.repo), project.prReview.pr.number)
    store = loadStore()
    project = prReviewProject(store, id)
    project.prReview.pr = pr
    project.updatedAt = now()
    saveStore(store)

    const n = (project.prReview.runs.at(-1)?.n ?? 0) + 1
    const res = await createReview({
      repoPath: resolveRepoDir(project.repo),
      branch: project.integrationBranch,
      base: prReviewBase(pr),
      pr: pr.number,
      title: `${project.key} · PR #${pr.number} · review ${n} · ${basename(project.repo.trim()) || project.title}`,
      reviewers: count,
      project: project.key,
      agreement: { loop: n },
      verify: true,
      model: modelIdFor(REVIEW_RUNNER.model),
      effort: REVIEW_RUNNER.effort,
    })

    const at = now()
    const started: PrReviewRun = { n, status: 'running', headSha: pr.headSha, reviewKey: res.key, startedAt: at, endedAt: '' }
    store = loadStore()
    project = prReviewProject(store, id)
    project.prReview.runs = [...project.prReview.runs, started].slice(-REVIEW_RUNS_CAP)
    project.updatedAt = at
    saveStore(store)
    return { ...res, run: started }
  } finally {
    startsInFlight.delete(id)
  }
}

/**
 * A review came back (`done`, with the consensus session's verdict) or was
 * forgotten (`stopped`): settle the run that started it, on whichever PR
 * review — or plan review — project that is. A review no project started is
 * nobody's run.
 */
export function settlePrReviewRun(reviewKey: string, to: 'done' | 'stopped', verdict?: string): void {
  const store = loadStore()
  for (const project of store.projects) {
    const record = project.prReview ?? project.planReview
    const runs = record?.runs as Array<PrReviewRun | NonNullable<Project['planReview']>['runs'][number]> | undefined
    if (!record || !runs?.some((r) => r.reviewKey === reviewKey)) continue
    const at = now()
    const next = settleRun(runs, reviewKey, to, at, verdict)
    if (next === runs) return
    ;(record as { runs: typeof next }).runs = next
    project.updatedAt = at
    saveStore(store)
    return
  }
}
