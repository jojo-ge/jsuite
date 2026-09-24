import { existsSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, resolve } from 'node:path'
import { DEFAULT_REVIEWERS, MAX_REVIEWERS, type Review, type ReviewConsensus } from '../../../app/utils/reviewTypes'

/**
 * Start a review. Body: { repoPath, branch?, base?, title?, reviewers?, consensus? }
 *
 * - `branch` — what to review (default: whatever is checked out). A branch
 *   that isn't checked out is reviewed in a detached worktree, so the human's
 *   checkout is never touched — under the codebase's worktree root when its
 *   jTicket worktree guide names one, else .data/jreview/worktrees/<key>.
 * - `base` — the target / fixed point (default: the branch's open PR's base —
 *   the parent branch, for a stacked PR — else origin's default branch).
 *
 * Records the review with REVIEWER_COUNT queued reviewers — each with a
 * pre-assigned document key in the shared pool — then hands them to herdr in
 * the background (each start takes seconds). The page follows along over
 * /watch; the watcher plugin takes it from there.
 *
 * Returns { key, path: "/r/<key>" }.
 */
export default defineEventHandler(async (event) => {
  const body = (await readBody(event)) ?? {}
  const rawRepo = String(body.repoPath ?? '').trim()
  if (!rawRepo) throw createError({ statusCode: 400, message: 'missing `repoPath` — nothing to review' })

  const repoPath = resolve(rawRepo.replace(/^~(?=$|\/)/, homedir()))
  if (!existsSync(repoPath) || !statSync(repoPath).isDirectory()) {
    throw createError({ statusCode: 400, message: `repoPath is not a directory: ${repoPath}` })
  }
  await assertGitRepo(repoPath)

  const checkedOut = await currentBranch(repoPath)
  const branch = await requireRef(repoPath, String(body.branch ?? '').trim() || checkedOut || 'HEAD', 'branch')
  const pr = await prForBranch(repoPath, branch)

  let base = String(body.base ?? '').trim()
  if (base) {
    await requireRef(repoPath, base, 'target')
  } else {
    base = (pr && (await resolveBranchName(repoPath, pr.baseRefName))) || (await defaultBase(repoPath))
    if (!base) throw createError({ statusCode: 400, message: `could not pick a target in ${repoPath} — choose one` })
  }
  if (base === branch) throw createError({ statusCode: 400, message: `branch and target are both ${branch}` })

  const count = body.reviewers === undefined ? DEFAULT_REVIEWERS : Number(body.reviewers)
  if (!Number.isInteger(count) || count < 1 || count > MAX_REVIEWERS) {
    throw createError({ statusCode: 400, message: `reviewers must be 1…${MAX_REVIEWERS}` })
  }

  let consensus: ReviewConsensus | undefined
  if (body.consensus !== undefined && body.consensus !== null) {
    const projectKey = String(body.consensus?.projectKey ?? '').trim()
    if (!/^[A-Za-z][A-Za-z0-9]*-\d+$/.test(projectKey)) {
      throw createError({ statusCode: 400, message: 'consensus.projectKey must be a jTicket project key (PROJ-n)' })
    }
    const loop = Number(body.consensus?.loop)
    consensus = { projectKey, ...(Number.isInteger(loop) && loop > 0 ? { loop } : {}) }
  }

  const repoName = basename(repoPath)
  const title = String(body.title ?? '').trim() || `${repoName} · ${pr ? `#${pr.number} ` : ''}${branch}`
  const key = await uniqueReviewKey(title)

  const inPlace = branch === 'HEAD' || branch === checkedOut
  const guide = inPlace ? null : await codebaseWorktreeGuide(repoPath)
  const workdir = inPlace ? repoPath : await addReviewWorktree(repoPath, key, branch, guide?.root)

  const now = new Date().toISOString()
  const review: Review = {
    format: 'j-review',
    version: 1,
    key,
    title,
    repoPath,
    branch,
    pr,
    base,
    workdir,
    worktree: !inPlace,
    worktreeGuide: guide?.url,
    status: 'reviewing',
    reviewers: Array.from({ length: count }, (_, i) => ({
      n: i + 1,
      docKey: `jreview-${key}-r${i + 1}`,
      status: 'queued' as const,
    })),
    triage: { docKey: `jreview-${key}-triage`, status: 'waiting' },
    findings: [],
    tickets: null,
    ...(consensus ? { consensus } : {}),
    createdAt: now,
    updatedAt: now,
  }
  await writeReview(review)
  await rememberReviewRepo(repoPath)

  void dispatchQueuedReviewers(key)
  return { key, path: `/r/${key}` }
})
