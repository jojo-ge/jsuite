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
  reviewPath,
  unticketedFindings,
  type PullRequest,
  type Review,
  type ReviewAgreement,
  type ReviewConsensus,
  type ReviewContext,
  type ReviewEffort,
  type ReviewPass,
  type ReviewSubject,
} from '../../app/utils/reviewTypes'
import { findingsForTickets, reviewProjectProblem } from '../../app/utils/reviewFindings'
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
import { fileAgreementFindings, fileTriageFindings, stampPosted, type AgreementFiling } from './reviewTickets'
import { JTICKET_PUBLIC } from './sandbox'
import { findKnownRepo, loadStore, saveStore } from './store'
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
  subject?: { kind?: unknown; projectKey?: unknown } | null
}

/**
 * Start a review. Body: { repoPath, branch?, base?, title?, reviewers?, consensus?, project?,
 *                         pass?, model?, effort?, context?, pr?, agreement?, verify? }
 *
 * - `pr` — a PR number: the review records that PR (via `gh pr view`, open or
 *   not) instead of looking one up by branch name, and the target defaults to
 *   its base. A PR review project's branch is a local copy of the PR head
 *   (`jreview/pr-<n>`), which no PR names.
 * Every review belongs to a jTicket project — `project`, or a consensus
 * review's `consensus.projectKey` — and that project has to exist: there are
 * no standalone reviews (400 without one). Its findings become tickets on
 * that project's board.
 *
 * - `agreement` — { loop? }: an agreement review (needs `project`): only what
 *   every reviewer raised survives, handed back as findings with an
 *   approvability assessment — and filed on the project as record-only
 *   tickets as they land (fileAgreementTickets). `verify: true` asks the
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
 * - `subject` — { kind: 'plan', projectKey }: a plan review (a plan review
 *   project's) — what is read is that plan project's map, decisions, spec and
 *   ticket plan, not a diff. No branch, base, PR or worktree: `branch`/`base`
 *   are recorded '' and every session runs in the codebase's main checkout,
 *   where the reviewers read the code read-only. Needs `agreement`.
 *
 * - `branch` — what to review (default: whatever is checked out). A branch
 *   that isn't checked out is reviewed in a detached worktree, so the human's
 *   checkout is never touched — under the codebase's worktree root when its
 *   worktree guide names one, else .data/jreview/worktrees/<key>.
 * - `base` — the target / fixed point (default: the branch's open PR's base —
 *   the parent branch, for a stacked PR — else origin's default branch).
 * - `project` — the jTicket project the review belongs to (its Review tab):
 *   its findings are added to it as tickets.
 *
 * Records the review with its queued reviewers — each with a pre-assigned
 * document key in the shared pool — then hands them to herdr in the
 * background (each start takes seconds). The watcher plugin takes it from
 * there. Throws a 400 for a body it can't run.
 */
export async function createReview(body: CreateReviewInput): Promise<{ key: string; path: string }> {
  // No standalone reviews: the project comes first, before any git or gh work.
  const orphan = reviewProjectProblem(body, (key) => loadStore().projects.some((p) => p.key === key))
  if (orphan) throw createError({ statusCode: 400, message: orphan })

  const rawRepo = String(body.repoPath ?? '').trim()
  if (!rawRepo) throw createError({ statusCode: 400, message: 'missing `repoPath` — nothing to review' })

  const repoPath = resolve(rawRepo.replace(/^~(?=$|\/)/, homedir()))
  if (!existsSync(repoPath) || !statSync(repoPath).isDirectory()) {
    throw createError({ statusCode: 400, message: `repoPath is not a directory: ${repoPath}` })
  }
  await assertGitRepo(repoPath)

  // A plan review reads a plan, not a diff: nothing below about branches applies.
  let subject: ReviewSubject | undefined
  if (body.subject !== undefined && body.subject !== null) {
    const projectKey = String(body.subject?.projectKey ?? '').trim()
    if (body.subject?.kind !== 'plan' || !PROJECT_KEY_SHAPE.test(projectKey)) {
      throw createError({ statusCode: 400, message: "subject must be { kind: 'plan', projectKey: PROJ-n } — the plan project under review" })
    }
    const plan = loadStore().projects.find((p) => p.key === projectKey)
    if (!plan) throw createError({ statusCode: 400, message: `plan project ${projectKey} not found` })
    if (plan.mode !== 'plan') throw createError({ statusCode: 400, message: `${projectKey} is not a plan project — a plan review reads a plan` })
    if (body.branch || body.base || body.pr) throw createError({ statusCode: 400, message: 'a plan review reads no diff — drop branch, base and pr' })
    subject = { kind: 'plan', projectKey, title: plan.title.slice(0, 200) }
  }

  const checkedOut = subject ? '' : await currentBranch(repoPath)
  const branch = subject ? '' : await requireRef(repoPath, String(body.branch ?? '').trim() || checkedOut || 'HEAD', 'branch')
  const prNumber = body.pr === undefined || body.pr === null || body.pr === '' ? 0 : Number(body.pr)
  if (prNumber && !(Number.isInteger(prNumber) && prNumber > 0)) throw createError({ statusCode: 400, message: 'pr must be a PR number' })
  const pr: PullRequest | null = subject ? null : prNumber ? await prByNumber(repoPath, prNumber) : await prForBranch(repoPath, branch)

  let base = subject ? '' : String(body.base ?? '').trim()
  if (subject) {
    // no target: there is no diff
  } else if (base) {
    await requireRef(repoPath, base, 'target')
  } else {
    base = (pr && (await resolveBranchName(repoPath, pr.baseRefName))) || (await defaultBase(repoPath))
    if (!base) throw createError({ statusCode: 400, message: `could not pick a target in ${repoPath} — choose one` })
  }
  if (!subject && base === branch) throw createError({ statusCode: 400, message: `branch and target are both ${branch}` })

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
  if (subject && !agreement) throw createError({ statusCode: 400, message: 'a plan review is an agreement review — send agreement too' })
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
  const title = String(body.title ?? '').trim() || (subject ? `${repoName} · plan ${subject.projectKey}` : `${repoName} · ${pr ? `#${pr.number} ` : ''}${branch}`)
  const key = await uniqueReviewKey(title)

  // A plan review's sessions read the code where the codebase is checked out
  // — no worktree to cut (and none for the watcher to remove).
  const inPlace = !!subject || branch === 'HEAD' || branch === checkedOut
  const guide = inPlace ? null : codebaseWorktreeGuide(await mainCheckout(repoPath))
  const workdir = subject ? await mainCheckout(repoPath) : inPlace ? repoPath : await addReviewWorktree(repoPath, key, branch, guide?.root)

  const headSha = subject ? '' : await commitOf(repoPath, branch)
  const now = new Date().toISOString()
  const review: Review = {
    format: 'j-review',
    version: 1,
    key,
    title,
    repoPath,
    branch,
    pr,
    ...(subject ? { subject } : {}),
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
  return { key, path: reviewPath(key) }
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

const ticketsInFlight = new Set<string>()

/**
 * The human's button for a TRIAGE review: turn triaged findings into jTicket
 * tickets on the review's own project. Body: { findingIds?: string[],
 * projectKey?: string } — the findings to ticket (default: all of them).
 *
 * The target is never a new project: it is the project the findings already
 * went to, else the project the review belongs to (`review.project`). Only a
 * review that predates the every-review-has-a-project rule has neither — for
 * that one `projectKey` names an existing project to file into. A
 * `projectKey` that disagrees with where the review belongs is refused.
 *
 * One AFK bug ticket per finding, each carrying its finding record. Findings
 * that already became tickets are skipped, so the button can be pressed again
 * for the ones left over. Each finding records its `ticketKey`; the review
 * flips to `ticketed`.
 *
 * Refused for a consensus review (its session files its own tickets) and for
 * an agreement review (its findings are filed as they are handed back —
 * fileAgreementTickets — so there is nothing to add by hand).
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
  if (review.agreement) {
    throw createError({ statusCode: 409, message: `review ${key} is an agreement review — its findings are filed on ${review.project} as they are handed back; there is nothing to add by hand` })
  }
  if (review.status !== 'triaged' && review.status !== 'ticketed') {
    throw createError({ statusCode: 409, message: `review is still ${review.status} — tickets come after triage` })
  }

  const asked = String(body.projectKey ?? '').trim()
  if (asked && !PROJECT_KEY_SHAPE.test(asked)) {
    throw createError({ statusCode: 400, message: 'projectKey must be a jTicket project key (PROJ-n)' })
  }
  const home = review.tickets?.projectKey || review.project || ''
  if (asked && home && asked !== home) {
    throw createError({
      statusCode: 409,
      message: review.tickets?.projectKey
        ? `this review's findings already went to ${home} — add the rest there`
        : `this review belongs to ${home} — its findings are tickets there`,
    })
  }
  const projectKey = home || asked
  if (!projectKey) {
    throw createError({ statusCode: 409, message: `review ${key} predates projects and belongs to none — send projectKey to file its findings into an existing project` })
  }

  const wanted = Array.isArray(body.findingIds) ? new Set(body.findingIds.map(String)) : null
  const findings = unticketedFindings(review).filter((f) => !wanted || wanted.has(f.id))
  if (!findings.length) {
    throw createError({ statusCode: 400, message: wanted ? 'the selected findings are already tickets' : 'every finding is already a ticket' })
  }

  if (ticketsInFlight.has(key)) throw createError({ statusCode: 409, message: 'already creating tickets for this review' })
  ticketsInFlight.add(key)
  try {
    const store = loadStore()
    const project = store.projects.find((p) => p.key === projectKey)
    if (!project) throw createError({ statusCode: 404, message: `project ${projectKey} not found` })
    const at = new Date().toISOString()
    const byFinding = fileTriageFindings(store, project, review, findings, at, JTICKET_PUBLIC)
    saveStore(store)

    const added = [...byFinding.values()]
    const updated = await updateReview(key, (r) => {
      for (const f of r.findings) {
        const ticketKey = byFinding.get(f.id)
        if (ticketKey) f.ticketKey = ticketKey
      }
      r.tickets = {
        projectKey,
        ticketKeys: [...(r.tickets?.ticketKeys ?? []), ...added],
        createdAt: r.tickets?.createdAt ?? at,
      }
      r.status = 'ticketed'
    })
    return { ...updated.tickets!, added, url: `${JTICKET_PUBLIC}/projects/${projectKey}` }
  } finally {
    ticketsInFlight.delete(key)
  }
}

/**
 * An agreement review's hand-back: file `review.findings` on its project as
 * record-only tickets — or match the project's open finding tickets (a rerun,
 * a re-POST) rather than filing duplicates — and write each ticket's key (and
 * its posted stamp, when an earlier run posted it) onto its finding. Called
 * inside the hand-back's updateReview, so it mutates `review` in place.
 *
 * A project that has since been deleted files nothing: the findings stay on
 * the review. Returns what it filed, or null.
 */
export function fileAgreementTickets(review: Review): AgreementFiling | null {
  if (!review.agreement || !review.project) return null
  const store = loadStore()
  const project = store.projects.find((p) => p.key === review.project)
  if (!project) {
    console.error(`[jticket] review ${review.key}: project ${review.project} is gone — its findings were not filed as tickets`)
    return null
  }
  const at = new Date().toISOString()
  const filing = fileAgreementFindings(store, project, review, review.findings, at, JTICKET_PUBLIC)
  saveStore(store)
  const tickets = new Map(store.tickets.map((t) => [t.key, t]))
  for (const f of review.findings) {
    const ticketKey = filing.byFinding.get(f.id)
    if (!ticketKey) continue
    f.ticketKey = ticketKey
    const postedAt = tickets.get(ticketKey)?.finding?.postedAt
    if (postedAt) f.postedAt = postedAt
    else delete f.postedAt
  }
  review.tickets = {
    projectKey: project.key,
    ticketKeys: [...new Set(filing.byFinding.values())],
    createdAt: review.tickets?.createdAt ?? at,
  }
  return filing
}

const postsInFlight = new Set<string>()

/**
 * The human's "Post to PR" button. Body: { ticketKeys?: string[], body?: string }
 * — the FINDING TICKETS to post (default: none) and the review's summary
 * text, which the human edits before pressing. A finding is posted through
 * its ticket: one that is not a ticket yet cannot be picked.
 *
 * Posts ONE GitHub pull-request review with the human's gh auth — event
 * COMMENT, always (reviewGithub.ts hard-codes it; there is no way to approve
 * or request changes through here). Each picked ticket's finding goes inline
 * when its file and line are a line the PR changes, else into the body.
 * "Posted" is stamped on the ticket (`finding.postedAt`, the `pr:posted`
 * label) and mirrored on the review's finding; the press is logged on
 * `review.prPosts`. A ticket can be posted again (a rerun, a second push) —
 * the page says it was.
 *
 * Human-only, like the ticket split: no skill or session may call it.
 */
export async function postReviewToPr(
  key: string,
  body: { ticketKeys?: unknown; findingIds?: unknown; body?: unknown },
): Promise<{ url: string; inline: number; posted: number; ticketKeys: string[]; review: Review }> {
  const review = await readReview(key)
  if (!review) throw createError({ statusCode: 404, message: `No such review: ${key}` })
  if (review.status !== 'triaged' && review.status !== 'ticketed') {
    throw createError({ statusCode: 409, message: `review is still ${review.status} — findings come first` })
  }
  // The body this took before findings were posted by ticket: refuse it, or
  // its picks would be dropped and a summary-only review posted in their place.
  if (Array.isArray(body.findingIds) && body.findingIds.length) {
    throw createError({ statusCode: 400, message: 'findings are posted through their tickets — send `ticketKeys` (each finding\'s `ticketKey`), not `findingIds`' })
  }
  const asked = Array.isArray(body.ticketKeys) ? [...new Set(body.ticketKeys.map((k) => String(k).trim()).filter(Boolean))] : []
  const { findings, missing } = findingsForTickets(review, asked)
  if (missing.length) {
    throw createError({ statusCode: 400, message: `not finding tickets of this review: ${missing.join(', ')} — a finding is posted through its ticket` })
  }
  const summary = typeof body.body === 'string' ? body.body.slice(0, 60_000) : ''

  if (postsInFlight.has(key)) throw createError({ statusCode: 409, message: 'already posting this review to GitHub' })
  postsInFlight.add(key)
  try {
    const { url, inline } = await postPrReview(review, findings, summary)
    const at = new Date().toISOString()
    const store = loadStore()
    const ticketKeys = stampPosted(store, review.key, findings, at, url)
    if (ticketKeys.length) saveStore(store)
    const ids = new Set(findings.map((f) => f.id))
    const updated = await updateReview(key, (r) => {
      for (const f of r.findings) if (ids.has(f.id)) f.postedAt = at
      r.prPosts = [...(r.prPosts ?? []), { at, url, findingIds: [...ids], ticketKeys: findings.map((f) => f.ticketKey!), inline }]
    })
    return { url, inline, posted: findings.length, ticketKeys, review: updated }
  } finally {
    postsInFlight.delete(key)
  }
}
