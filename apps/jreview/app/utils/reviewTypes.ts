// The j-review format — shared by the server store and the UI (the jMap
// app/utils pattern: server files import these relatively).
//
// A review is one run over one repo: up to MAX_REVIEWERS herdr claude sessions
// each run the global /code-review skill and publish their report as a
// jExplain document at a pre-assigned key in the shared pool. jReview watches
// those keys; when every reviewer's document has landed it dispatches one
// triage session, which dedupes the findings, publishes a triage document and
// POSTs the merged findings back here. Turning findings into jTicket tickets
// is the human's button — no agent does it.
//
// A CONSENSUS review (jTicket's auto loop) skips all of that: once every
// reviewer is in, a consensus session keeps only the findings every reviewer
// raised and files each straight into the caller's jTicket project as a ticket.
// jReview records just the ticket keys — no triage document, no findings.

export const MAX_REVIEWERS = 4
/** The reviewer count when the caller doesn't ask for one. */
export const DEFAULT_REVIEWERS = 4

export type ReviewStatus =
  /** Reviewers dispatched or running; waiting on their documents. */
  | 'reviewing'
  /** Every reviewer is finished; the triage (or consensus) session is running. */
  | 'triaging'
  /** Merged findings are in; waiting on the human's to-jTicket button. */
  | 'triaged'
  /** Findings were split into a jTicket project (or, for a consensus review, filed into the caller's). */
  | 'ticketed'

export type ReviewerStatus =
  /** Not yet handed to herdr (dispatch is sequential, a few seconds each). */
  | 'queued'
  /** claude is running in its herdr pane. */
  | 'running'
  /** Its jExplain document is in the pool. */
  | 'done'
  /** Dispatch failed — `error` says why, the page offers a retry. */
  | 'failed'
  /** The human gave up on it; triage goes ahead without it. */
  | 'skipped'

export interface Reviewer {
  /** 1-based slot. */
  n: number
  /** Pre-assigned key in the shared document pool — its appearance means done. */
  docKey: string
  status: ReviewerStatus
  agent?: string
  tabId?: string
  paneId?: string
  error?: string
  dispatchedAt?: string
  doneAt?: string
}

export type TriageStatus = 'waiting' | 'running' | 'done' | 'failed'

export interface Triage {
  docKey: string
  status: TriageStatus
  agent?: string
  tabId?: string
  error?: string
  dispatchedAt?: string
  doneAt?: string
}

export type Severity = 'critical' | 'high' | 'medium' | 'low'
export const SEVERITIES: Severity[] = ['critical', 'high', 'medium', 'low']

/** One deduplicated finding, as the triage session POSTs it. */
export interface Finding {
  /** Stable within the review: f1, f2, … */
  id: string
  title: string
  severity: Severity
  /** Short kebab-case slug: correctness, standards, spec, security, … */
  category: string
  file?: string
  line?: number
  /** One-sentence statement of the defect. */
  summary: string
  /** Markdown: what's wrong, the failure scenario, the suggested fix. */
  detail: string
  /** Reviewer slots that raised it — more than one means it was a duplicate. */
  reviewers: number[]
}

export interface ReviewTickets {
  projectKey: string
  ticketKeys: string[]
  createdAt: string
}

/**
 * Set when another app (jTicket's auto loop) asked for a consensus review: only
 * findings every reviewer raised become tickets, filed straight into
 * `projectKey` by the consensus session.
 */
export interface ReviewConsensus {
  projectKey: string
  /** The auto-loop iteration that asked, for ticket labels and titles. */
  loop?: number
  /** Distinct findings the consensus session weighed — `kept` of them agreed. */
  considered?: number
  kept?: number
}

/** An open pull request, as `gh pr list` reports it. */
export interface PullRequest {
  number: number
  title: string
  url: string
  /** The PR's target branch — for a stacked PR, its parent branch. */
  baseRefName: string
  headRefName: string
  isDraft: boolean
}

export interface Review {
  format: 'j-review'
  version: 1
  key: string
  title: string
  /** Absolute path of the reviewed repo (the codebase jTicket files tickets under). */
  repoPath: string
  /** The branch under review — `HEAD` in `workdir`. */
  branch: string
  /** The open PR for `branch` when the review started, if any. */
  pr: PullRequest | null
  /** The code-review skill's fixed point (the target): the diff is `<base>...HEAD`. */
  base: string
  /**
   * Every herdr session's cwd: the repo itself when `branch` is what's checked
   * out there, else a detached worktree — under the codebase's worktree root
   * (its jTicket worktree guide) or .data/jreview/worktrees/<key>.
   */
  workdir: string
  /** True when `workdir` is a worktree jReview made (and removes on delete). */
  worktree: boolean
  /**
   * The codebase's worktree guide URL on jTicket, when it had one as the
   * worktree was made — reviewers set the checkout up from it if they need to
   * run anything.
   */
  worktreeGuide?: string
  status: ReviewStatus
  workspaceId?: string
  reviewers: Reviewer[]
  triage: Triage
  findings: Finding[]
  tickets: ReviewTickets | null
  consensus?: ReviewConsensus
  createdAt: string
  updatedAt: string
}

export interface ReviewMeta {
  key: string
  title: string
  repoPath: string
  branch: string
  prNumber?: number
  base: string
  status: ReviewStatus
  findingCount: number
  projectKey?: string
  consensus?: boolean
  createdAt: string
  updatedAt: string
}

/** Reviewers that no longer hold up triage. */
export const reviewerSettled = (r: Reviewer) => r.status === 'done' || r.status === 'skipped'

/**
 * Whether a review's reviewers are all in and its triage (or consensus) can
 * start. A consensus needs every reviewer's report — a skipped reviewer can't
 * agree with anything — so there a skip holds it up.
 */
export function readyForTriage(review: Pick<Review, 'reviewers' | 'consensus'>): boolean {
  if (review.consensus) return review.reviewers.every((r) => r.status === 'done')
  return review.reviewers.every(reviewerSettled) && review.reviewers.some((r) => r.status === 'done')
}

/** A codebase jReview (or jTicket) has been pointed at before. */
export interface KnownRepo {
  path: string
  name: string
  lastUsedAt: string | null
}

export interface BranchInfo {
  /** What to pass back as `branch` / `base`: `feature-x`, or `origin/feature-x` for remote-only. */
  name: string
  remote: boolean
  current: boolean
  committedAt: string
  pr: PullRequest | null
}

export interface BranchList {
  current: string
  /** origin's default branch (or main/master) — the target when there's no PR. */
  defaultBase: string
  branches: BranchInfo[]
  /** Why PR detection is unavailable (no gh, no GitHub remote, …). */
  prError?: string
}
