// The review engine's operations — jReview's routes, run inside jTicket since
// TICK-942. The /api/reviews/** routes are thin wrappers over these, and
// jTicket's own callers (the auto loop's and run plan's consensus and
// architecture reviews, the PR review runner, the project Review tab) call
// them in-process instead of over HTTP.
//
// Store: reviewStore.ts. Git/gh: reviewGit.ts, reviewGithub.ts. herdr:
// reviewHerdr.ts. The watcher that sees reports land and fires triage:
// server/plugins/reviewWatcher.ts.
import { existsSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, resolve } from 'node:path'
import {
  DEFAULT_REVIEWERS,
  MAX_REVIEWERS,
  PROJECT_KEY_SHAPE,
  REVIEW_EFFORTS,
  unticketedFindings,
  type Finding,
  type PullRequest,
  type Review,
  type ReviewAgreement,
  type ReviewConsensus,
  type ReviewContext,
  type ReviewEffort,
  type ReviewPass,
} from '../../app/utils/reviewTypes'
import { readReview, uniqueReviewKey, updateReview, writeReview } from './reviewStore'
import {
  addReviewWorktree,
  assertGitRepo,
  commitOf,
  currentBranch,
  defaultBase,
  mainCheckout,
  prByNumber,
  prForBranch,
  requireRef,
  resolveBranchName,
} from './reviewGit'
import { dispatchQueuedReviewers, dispatchReviewer, dispatchTriage } from './reviewHerdr'
import { postPrReview } from './reviewGithub'
import { JTICKET_PUBLIC } from './sandbox'
import { findKnownRepo, loadStore } from './store'
// The guide's URL as every prompt names it; sessionPrompt points it at a sandbox.
import { worktreeGuideUrl } from '../../app/utils/prompts'

/**
 * How the codebase does worktrees (see worktrees.ts) — or null when it has no
 * guide. Read straight off the store: a review must still start without it.
 */
export function codebaseWorktreeGuide(repoPath: string): { root: string; url: string } | null {
  try {
    const guide = findKnownRepo(loadStore(), repoPath)?.worktreeGuide
    return guide ? { root: guide.root ?? '', url: worktreeGuideUrl(repoPath) } : null
  } catch {
    return null
  }
}

/** What POST /api/reviews takes. */
export interface CreateReviewInput {
  repoPath?: unknown
  branch?: unknown
  base?: unknown
  title?: unknown
  reviewers?: unknown
  consensus?: { projectKey?: unknown; loop?: unknown } | null
  project?: unknown
  pass?: unknown
  model?: unknown
  effort?: unknown
  context?: { docs?: unknown; review?: unknown; brief?: unknown; checks?: unknown } | null
  pr?: unknown
  agreement?: { loop?: unknown } | null
  verify?: unknown
}

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
 *   worktree guide names one, else .data/jreview/worktrees/<key>.
 * - `base` — the target / fixed point (default: the branch's open PR's base —
 *   the parent branch, for a stacked PR — else origin's default branch).
 * - `project` — the jTicket project the review belongs to (its Review tab):
 *   findings are later added to it as tickets instead of a new project.
 *
 * Records the review with its queued reviewers — each with a pre-assigned
 * document key in the shared pool — then hands them to herdr in the
 * background (each start takes seconds). The watcher plugin takes it from
 * there. Throws a 400 for a body it can't run.
 */
export async function createReview(body: CreateReviewInput): Promise<{ key: string; path: string }> {
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
    if (!(REVIEW_EFFORTS as readonly unknown[]).includes(body.effort)) throw createError({ statusCode: 400, message: `effort must be one of ${REVIEW_EFFORTS.join(', ')}` })
    effort = body.effort as ReviewEffort
  }
  let context: ReviewContext | undefined
  const ctx = body.context
  if (ctx && typeof ctx === 'object') {
    const docs = Array.isArray(ctx.docs) ? ctx.docs.filter((d: unknown): d is string => typeof d === 'string' && /^[A-Za-z]+-\d+$/.test(d)) : []
    const prior = typeof ctx.review === 'string' ? ctx.review.trim() : ''
    const brief = typeof ctx.brief === 'string' && /^[A-Za-z]+-\d+$/.test(ctx.brief.trim()) ? ctx.brief.trim() : ''
    const checks = Array.isArray(ctx.checks) ? ctx.checks.filter((d: unknown): d is string => typeof d === 'string' && /^[A-Za-z][A-Za-z0-9]*-\d+$/.test(d)).slice(0, 20) : []
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
  const guide = inPlace ? null : codebaseWorktreeGuide(await mainCheckout(repoPath))
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

  void dispatchQueuedReviewers(key)
  return { key, path: `/r/${key}` }
}

/**
 * (Re-)dispatch one reviewer — the retry after a failed herdr hand-off, or a
 * fresh session for one that stalled. Blocks until claude is up in its pane.
 */
export async function retryReviewer(key: string, n: number): Promise<Review | null> {
  await updateReview(key, (r) => {
    if (r.status !== 'reviewing') {
      throw createError({ statusCode: 409, message: `review is ${r.status} — reviewers are finished` })
    }
    const reviewer = r.reviewers.find((x) => x.n === n)
    if (!reviewer) throw createError({ statusCode: 404, message: `No reviewer ${n}` })
    if (reviewer.status === 'done') throw createError({ statusCode: 409, message: `reviewer ${n} already reported` })
    reviewer.status = 'queued'
    reviewer.error = undefined
  })
  await dispatchReviewer(key, n)
  return readReview(key)
}

/**
 * Give up on one reviewer so triage can go ahead without it. The watcher
 * dispatches triage on its next tick if everyone else is in. Its herdr pane
 * is left alone — close it by hand. Refused for a consensus review, where a
 * missing reviewer can't agree with anything.
 */
export function skipReviewer(key: string, n: number): Promise<Review> {
  return updateReview(key, (r) => {
    if (r.status !== 'reviewing') {
      throw createError({ statusCode: 409, message: `review is ${r.status} — reviewers are finished` })
    }
    if (r.consensus) {
      throw createError({ statusCode: 409, message: 'a consensus review needs every reviewer — retry this one instead of skipping it' })
    }
    const reviewer = r.reviewers.find((x) => x.n === n)
    if (!reviewer) throw createError({ statusCode: 404, message: `No reviewer ${n}` })
    if (reviewer.status === 'done') throw createError({ statusCode: 409, message: `reviewer ${n} already reported` })
    reviewer.status = 'skipped'
  })
}

/**
 * Re-dispatch the triage session — the retry after a failed herdr hand-off,
 * or a fresh one for a triager that stalled before POSTing findings. Only
 * valid while the review is `triaging`.
 */
export async function retryTriage(key: string): Promise<Review | null> {
  await updateReview(key, (r) => {
    if (r.status !== 'triaging') {
      throw createError({ statusCode: 409, message: `review is ${r.status} — nothing to triage` })
    }
    r.triage.status = 'waiting'
    r.triage.error = undefined
  })
  await dispatchTriage(key)
  return readReview(key)
}

/**
 * jTicket's own API, called in-process (Nitro's $fetch with a relative path
 * never leaves the server): the ticket split reuses project creation and
 * /api/import rather than re-implementing them.
 */
async function jticketLocal<T>(path: string, opts: Record<string, unknown>): Promise<T> {
  try {
    return (await $fetch(path, opts as any)) as T
  } catch (err: any) {
    const status = err?.statusCode ?? err?.response?.status ?? 500
    throw createError({
      statusCode: status,
      message: `${path} said ${status}: ${String(err?.data?.statusMessage ?? err?.data?.message ?? err?.message ?? '').slice(0, 300)}`,
    })
  }
}

const ticketsInFlight = new Set<string>()

/**
 * The human's button: turn triaged findings into jTicket tickets. Body:
 * { findingIds?: string[], projectKey?: string } — the findings to ticket
 * (default: all of them) and the project to add them to.
 *
 * The target is `projectKey`, else the project the findings already went to,
 * else the project the review belongs to (`review.project` — jTicket's Review
 * tab), else a NEW project (repo = the reviewed repo's main checkout — a
 * review started from a worktree still lands in the codebase's own project
 * list — so the tickets are dispatchable from jTicket like any other).
 * One AFK bug ticket per finding is imported into it by key — never by title,
 * which could match an older project of the same name.
 *
 * Findings that already became tickets are skipped, so the button can be
 * pressed again for the ones left over — but only into the same project.
 * Each finding records its `ticketKey`; the review flips to `ticketed`.
 */
export async function fileReviewTickets(
  key: string,
  body: { findingIds?: unknown; projectKey?: unknown },
): Promise<{ projectKey: string; ticketKeys: string[]; createdAt: string; added: string[]; url: string }> {
  const review = await readReview(key)
  if (!review) throw createError({ statusCode: 404, message: `No such review: ${key}` })
  if (review.consensus) {
    throw createError({ statusCode: 409, message: `review ${key} is a consensus review — its session files its own tickets` })
  }
  if (review.status !== 'triaged' && review.status !== 'ticketed') {
    throw createError({ statusCode: 409, message: `review is still ${review.status} — tickets come after triage` })
  }

  const asked = String(body.projectKey ?? '').trim()
  if (asked && !PROJECT_KEY_SHAPE.test(asked)) {
    throw createError({ statusCode: 400, message: 'projectKey must be a jTicket project key (PROJ-n)' })
  }
  const filedInto = review.tickets?.projectKey
  if (asked && filedInto && asked !== filedInto) {
    throw createError({ statusCode: 409, message: `this review's findings already went to ${filedInto} — add the rest there` })
  }
  const target = asked || filedInto || review.project || ''

  const wanted = Array.isArray(body.findingIds) ? new Set(body.findingIds.map(String)) : null
  const findings = unticketedFindings(review).filter((f) => !wanted || wanted.has(f.id))
  if (!findings.length) {
    throw createError({ statusCode: 400, message: wanted ? 'the selected findings are already tickets' : 'every finding is already a ticket' })
  }

  if (ticketsInFlight.has(key)) throw createError({ statusCode: 409, message: 'already creating tickets for this review' })
  ticketsInFlight.add(key)
  try {
    let projectKey = target
    if (projectKey) {
      if (!loadStore().projects.some((p) => p.key === projectKey)) {
        throw createError({ statusCode: 404, message: `project ${projectKey} not found` })
      }
    } else {
      const project = await jticketLocal<{ key: string }>('/api/projects', {
        method: 'POST',
        body: {
          title: `Review: ${review.title}`,
          repo: await mainCheckout(review.repoPath),
          description: projectDescription(review, findings.length),
        },
      })
      projectKey = project.key
    }
    const imported = await jticketLocal<{ tickets: { key: string }[] }>('/api/import', {
      method: 'POST',
      body: {
        tickets: findings.map((f) => ({
          title: f.title,
          description: ticketDescription(review, f),
          type: 'bug',
          project: projectKey,
          labels: ['afk', 'jreview', 'review:finding', `severity:${f.severity}`, `category:${f.category}`],
          acceptanceCriteria: ['The failure scenario described above no longer occurs, and a test covers it'],
        })),
      },
    })
    // Import answers in the order it was sent — finding i became ticket i.
    const byFinding = new Map(findings.map((f, i) => [f.id, imported.tickets[i]?.key]))
    const updated = await updateReview(key, (r) => {
      for (const f of r.findings) {
        const ticketKey = byFinding.get(f.id)
        if (ticketKey) f.ticketKey = ticketKey
      }
      const added = [...byFinding.values()].filter((k): k is string => !!k)
      r.tickets = {
        projectKey,
        ticketKeys: [...(r.tickets?.ticketKeys ?? []), ...added],
        createdAt: r.tickets?.createdAt ?? new Date().toISOString(),
      }
      r.status = 'ticketed'
    })
    return {
      ...updated.tickets!,
      added: imported.tickets.map((t) => t.key),
      url: `${JTICKET_PUBLIC}/projects/${projectKey}`,
    }
  } finally {
    ticketsInFlight.delete(key)
  }
}

const reviewUrl = (r: Review) => `https://jreview.local/r/${r.key}`
// Reports are pool documents, read in jTicket's reader (jExplain retired).
const docUrl = (docKey: string) => `${JTICKET_PUBLIC}/e/${docKey}`

function projectDescription(r: Review, count: number): string {
  const reports = r.reviewers
    .filter((x) => x.status === 'done')
    .map((x) => `[reviewer ${x.n}](${docUrl(x.docKey)})`)
    .join(' · ')
  return [
    `${count} finding${count === 1 ? '' : 's'} from the jReview run [${r.title}](${reviewUrl(r)}) over \`${r.repoPath}\` (\`${r.base}...${r.branch}\`${r.pr ? `, [PR #${r.pr.number}](${r.pr.url})` : ''}).`,
    '',
    `Deduplicated in the [triage report](${docUrl(r.triage.docKey)}). Raw reports: ${reports || 'none'}.`,
    '',
    'One ticket per finding, labelled `severity:*` and `category:*`.',
  ].join('\n')
}

function ticketDescription(r: Review, f: Finding): string {
  const where = f.file ? `\`${f.file}${f.line ? `:${f.line}` : ''}\`` : 'not pinned to a file'
  const by = f.reviewers.length
    ? `reviewer${f.reviewers.length === 1 ? '' : 's'} ${f.reviewers.join(', ')}`
    : 'the triager'
  return [
    `**Severity:** ${f.severity} · **Category:** ${f.category} · **Where:** ${where}`,
    '',
    f.summary,
    '',
    f.detail,
    '',
    '---',
    `Raised by ${by} in jReview [${r.title}](${reviewUrl(r)}) — see the [triage report](${docUrl(r.triage.docKey)}).`,
  ].join('\n')
}

const postsInFlight = new Set<string>()

/**
 * The human's "Post to PR" button. Body: { findingIds?: string[], body?: string }
 * — the findings to post (default: none) and the review's summary text, which
 * the human edits before pressing.
 *
 * Posts ONE GitHub pull-request review with the human's gh auth — event
 * COMMENT, always (reviewGithub.ts hard-codes it; there is no way to approve
 * or request changes through here). Findings on a line the PR changes go
 * inline, the rest into the body. Each posted finding records `postedAt`, and
 * the press is logged on `review.prPosts`; a finding can be posted again (a
 * rerun's comments, a second push) — the page says it was.
 *
 * Human-only, like the ticket split: no skill or session may call it.
 */
export async function postReviewToPr(
  key: string,
  body: { findingIds?: unknown; body?: unknown },
): Promise<{ url: string; inline: number; posted: number; review: Review }> {
  const review = await readReview(key)
  if (!review) throw createError({ statusCode: 404, message: `No such review: ${key}` })
  if (review.status !== 'triaged' && review.status !== 'ticketed') {
    throw createError({ statusCode: 409, message: `review is still ${review.status} — findings come first` })
  }
  const ids = Array.isArray(body.findingIds) ? new Set(body.findingIds.map(String)) : new Set<string>()
  const findings = review.findings.filter((f) => ids.has(f.id))
  if (ids.size && findings.length !== ids.size) throw createError({ statusCode: 400, message: 'some of those findings are not in this review' })
  const summary = typeof body.body === 'string' ? body.body.slice(0, 60_000) : ''

  if (postsInFlight.has(key)) throw createError({ statusCode: 409, message: 'already posting this review to GitHub' })
  postsInFlight.add(key)
  try {
    const { url, inline } = await postPrReview(review, findings, summary)
    const at = new Date().toISOString()
    const updated = await updateReview(key, (r) => {
      for (const f of r.findings) if (ids.has(f.id)) f.postedAt = at
      r.prPosts = [...(r.prPosts ?? []), { at, url, findingIds: findings.map((f) => f.id), inline }]
    })
    return { url, inline, posted: findings.length, review: updated }
  } finally {
    postsInFlight.delete(key)
  }
}
