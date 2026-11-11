import { existsSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, resolve } from 'node:path'
import {
  DEFAULT_REVIEWERS,
  MAX_REVIEWERS,
  PROJECT_KEY_SHAPE,
  REVIEW_EFFORTS,
  type Review,
  type ReviewConsensus,
  type ReviewContext,
  type ReviewEffort,
  type ReviewPass,
  type ReviewAgreement,
  type PullRequest,
} from '../../../app/utils/reviewTypes'

/**
 * Start a review. Body: { repoPath, branch?, base?, title?, reviewers?, consensus?, project?,
 *                         pass?, model?, effort?, context?, pr?, agreement?, verify? }
 *
 * - `pr` — a PR number: the review records that PR (via `gh pr view`, open or
 *   not) instead of looking one up by branch name, and the target defaults to
 *   its base. A PR review project's branch is a local copy of the PR head
 *   (`jreview/pr-<n>`), which no PR names.
 * - `agreement` — { loop? }: an agreement review (needs `project`): only what
 *   every reviewer raised survives, handed back as findings with an
 *   approvability assessment — never filed as tickets. `verify: true` asks the
 *   consensus session to have every agreed finding adversarially verified
 *   first. `context.brief` (DOC-n) and `context.checks` ([TICK-n]) are what
 *   the reviewers read before the diff.
 *
 * - `pass` — a consensus review's kind: 'consensus' (default) or 'architecture'
 *   (one architectural & technical reviewer; its architectural findings are
 *   mandatory fixes). `model` (a claude model id) and `effort` pin the
 *   reviewers' sessions. `context` = { docs?: [DOC-n…], review?: <key> } —
 *   what the reviewers read first: jTicket docs, and an earlier review of the
 *   same diff whose findings are already fixed.
 *
 * - `branch` — what to review (default: whatever is checked out). A branch
 *   that isn't checked out is reviewed in a detached worktree, so the human's
 *   checkout is never touched — under the codebase's worktree root when its
 *   jTicket worktree guide names one, else .data/jreview/worktrees/<key>.
 * - `base` — the target / fixed point (default: the branch's open PR's base —
 *   the parent branch, for a stacked PR — else origin's default branch).
 * - `project` — the jTicket project the review belongs to (its Review tab):
 *   findings are later added to it as tickets instead of a new project.
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
  const prNumber = body.pr === undefined || body.pr === null || body.pr === '' ? 0 : Number(body.pr)
  if (prNumber && !(Number.isInteger(prNumber) && prNumber > 0)) throw createError({ statusCode: 400, message: 'pr must be a PR number' })
  const pr: PullRequest | null = prNumber ? await prByNumber(repoPath, prNumber) : await prForBranch(repoPath, branch)

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
    if (!PROJECT_KEY_SHAPE.test(projectKey)) {
      throw createError({ statusCode: 400, message: 'consensus.projectKey must be a jTicket project key (PROJ-n)' })
    }
    const loop = Number(body.consensus?.loop)
    consensus = { projectKey, ...(Number.isInteger(loop) && loop > 0 ? { loop } : {}) }
  }

  let project: string | undefined
  if (body.project !== undefined && body.project !== null && body.project !== '') {
    project = String(body.project).trim()
    if (!PROJECT_KEY_SHAPE.test(project)) {
      throw createError({ statusCode: 400, message: 'project must be a jTicket project key (PROJ-n)' })
    }
    if (consensus) {
      throw createError({ statusCode: 400, message: 'a consensus review files into consensus.projectKey — drop `project`' })
    }
  }

  let agreement: ReviewAgreement | undefined
  if (body.agreement !== undefined && body.agreement !== null) {
    if (!project) throw createError({ statusCode: 400, message: 'an agreement review hands its findings to a jTicket project — send `project` too' })
    if (consensus) throw createError({ statusCode: 400, message: 'agreement and consensus are two different reviews — send one' })
    if (count < 2) throw createError({ statusCode: 400, message: 'an agreement review needs at least 2 reviewers' })
    const loop = Number(body.agreement?.loop)
    agreement = Number.isInteger(loop) && loop > 0 ? { loop } : {}
  }
  const verify = body.verify === true && !!(consensus || agreement)

  let pass: ReviewPass | undefined
  if (body.pass !== undefined && body.pass !== null && body.pass !== '') {
    if (body.pass !== 'consensus' && body.pass !== 'architecture') throw createError({ statusCode: 400, message: 'pass must be consensus or architecture' })
    if (!consensus) throw createError({ statusCode: 400, message: 'pass belongs to a consensus review — send consensus too' })
    pass = body.pass
    if (pass === 'architecture' && count !== 1) throw createError({ statusCode: 400, message: 'an architecture pass is one reviewer' })
  }
  const model = typeof body.model === 'string' && body.model.trim() ? body.model.trim().slice(0, 80) : undefined
  let effort: ReviewEffort | undefined
  if (body.effort !== undefined && body.effort !== null && body.effort !== '') {
    if (!(REVIEW_EFFORTS as readonly string[]).includes(body.effort)) throw createError({ statusCode: 400, message: `effort must be one of ${REVIEW_EFFORTS.join(', ')}` })
    effort = body.effort
  }
  let context: ReviewContext | undefined
  if (body.context && typeof body.context === 'object') {
    const docs = Array.isArray(body.context.docs) ? body.context.docs.filter((d: unknown): d is string => typeof d === 'string' && /^[A-Za-z]+-\d+$/.test(d)) : []
    const prior = typeof body.context.review === 'string' ? body.context.review.trim() : ''
    const brief = typeof body.context.brief === 'string' && /^[A-Za-z]+-\d+$/.test(body.context.brief.trim()) ? body.context.brief.trim() : ''
    const checks = Array.isArray(body.context.checks) ? body.context.checks.filter((d: unknown): d is string => typeof d === 'string' && /^[A-Za-z][A-Za-z0-9]*-\d+$/.test(d)).slice(0, 20) : []
    if (docs.length || prior || brief || checks.length) {
      context = {
        ...(docs.length ? { docs } : {}),
        ...(prior ? { review: prior } : {}),
        ...(brief ? { brief } : {}),
        ...(checks.length ? { checks } : {}),
      }
    }
  }

  const repoName = basename(repoPath)
  const title = String(body.title ?? '').trim() || `${repoName} · ${pr ? `#${pr.number} ` : ''}${branch}`
  const key = await uniqueReviewKey(title)

  const inPlace = branch === 'HEAD' || branch === checkedOut
  const guide = inPlace ? null : await codebaseWorktreeGuide(await mainCheckout(repoPath))
  const workdir = inPlace ? repoPath : await addReviewWorktree(repoPath, key, branch, guide?.root)

  const headSha = await commitOf(repoPath, branch)
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
    ...(agreement ? { agreement } : {}),
    ...(verify ? { verify } : {}),
    ...(headSha ? { headSha } : {}),
    ...(pass ? { pass } : {}),
    ...(model ? { model } : {}),
    ...(effort ? { effort } : {}),
    ...(context ? { context } : {}),
    ...(project ? { project } : {}),
    createdAt: now,
    updatedAt: now,
  }
  await writeReview(review)
  await rememberReviewRepo(repoPath)

  void dispatchQueuedReviewers(key)
  return { key, path: `/r/${key}` }
})
