import { basename } from 'node:path'
import {
  ensureHerdrWorkspace,
  acquirePackedPane,
  createJobTab,
  renamePane,
  startClaudeIn,
  herdrJson,
} from '@jsuite/herdr'
import type { Review } from '../../app/utils/reviewTypes'

// Driving Herdr (the terminal workspace manager) from jReview.
//
// jReview runs NO claude of its own. Every session is an interactive claude in
// a herdr pane, one workspace per reviewed repo (`jreview · <dir>`), every
// pane's cwd the review's workdir (the repo, or the branch's worktree):
//   - REVIEWERS — packed 2×2 into a `review <key>` tab, one pane each. The
//     prompt runs the target repo's code-review skill (the global one when the
//     repo has none), then `/jreview-report` publishes the report as a jExplain
//     document at the reviewer's pre-assigned key. That document landing in
//     the pool IS the completion signal — the watcher plugin sees it.
//   - the TRIAGER — one job tab, dispatched by the watcher once every reviewer
//     is settled. `/jreview-triage <key>` dedupes the reports, publishes the
//     triage document, and POSTs the merged findings to /api/reviews/:key/findings.

/** Every session is pinned to Opus 5.5; JREVIEW_MODEL overrides it. */
export const REVIEW_MODEL = process.env.JREVIEW_MODEL?.trim() || 'claude-opus-5-5'

export function reviewerPrompt(review: Review, n: number): string {
  const r = review.reviewers.find((x) => x.n === n)!
  // One line: herdr submits the prompt as typed input, and a newline would
  // submit it early.
  return [
    "Run the target codebase's code review skill. If it does not exist, run the default code review skill.",
    "(The target codebase's skills live in this repo's .claude/skills; the default is the global /code-review.)",
    `HEAD in this checkout is ${review.branch}${review.pr ? ` (PR #${review.pr.number}, "${review.pr.title.replace(/[\r\n]+/g, ' ')}")` : ''}.`,
    `The fixed point is ${review.base} — review \`git diff ${review.base}...HEAD\`.`,
    ...(review.worktree && review.worktreeGuide
      ? [`This checkout is a fresh worktree: if you need to install or run anything, set it up the codebase's way — its worktree guide is at ${review.worktreeGuide}.`]
      : []),
    'Work unattended: do not stop to ask questions — if no spec turns up, carry on without one and say so.',
    `When the review is complete, publish it into jReview with /jreview-report review=${review.key} reviewer=${n} doc=${r.docKey}.`,
  ].join(' ')
}

export const triagePrompt = (review: Review) => `/jreview-triage ${review.key}`

async function workspaceFor(review: Review) {
  return ensureHerdrWorkspace(`jreview · ${basename(review.repoPath)}`, review.workdir)
}

/**
 * Start reviewer `n` in a packed pane of the review's tab. Never throws: a
 * herdr failure is recorded on the reviewer (status `failed`, `error`) so the
 * page can offer a retry and the manual prompt.
 */
export async function dispatchReviewer(key: string, n: number): Promise<void> {
  const review = await readReview(key)
  if (!review) return
  try {
    const { workspaceId, freshTab } = await workspaceFor(review)
    const { tabId, paneId } = await acquirePackedPane(workspaceId, `review ${review.key}`, review.workdir, freshTab)
    await renamePane(paneId, `reviewer ${n} · ${review.title}`)
    // Slot first, so the 28-char agent-name cap trims the key, not the slot.
    const agent = await startClaudeIn(paneId, `jr${n}-${review.key}`, reviewerPrompt(review, n), {
      args: ['--model', REVIEW_MODEL],
    })
    await updateReview(key, (fresh) => {
      fresh.workspaceId = workspaceId
      const r = fresh.reviewers.find((x) => x.n === n)!
      // The document may already be in (a re-dispatch after it landed).
      if (r.status === 'done' || r.status === 'skipped') return
      Object.assign(r, { status: 'running', agent, tabId, paneId, error: undefined, dispatchedAt: new Date().toISOString() })
    })
  } catch (err: any) {
    const error = String(err?.message ?? err).slice(0, 300)
    await updateReview(key, (fresh) => {
      const r = fresh.reviewers.find((x) => x.n === n)!
      if (r.status === 'done' || r.status === 'skipped') return
      Object.assign(r, { status: 'failed', error })
    }).catch(() => {})
  }
}

/**
 * Hand every queued reviewer to herdr, one after another — herdr's pane
 * packing reads the tab's current layout, so parallel splits would race.
 * Each start blocks until claude is up (seconds), so callers don't await this.
 */
export async function dispatchQueuedReviewers(key: string): Promise<void> {
  const review = await readReview(key)
  if (!review) return
  for (const r of review.reviewers) {
    if (r.status === 'queued') await dispatchReviewer(key, r.n)
  }
}

/**
 * Start the triage session in its own job tab. Never throws — a failure is
 * recorded as triage `failed` with the error, and the page offers a retry.
 */
export async function dispatchTriage(key: string): Promise<void> {
  const review = await readReview(key)
  if (!review) return
  try {
    const { workspaceId, freshTab } = await workspaceFor(review)
    const tabLabel = `triage ${review.key}`
    let tabId: string, paneId: string
    if (freshTab) {
      await herdrJson(['tab', 'rename', freshTab.tabId, tabLabel])
      ;({ tabId, paneId } = freshTab)
    } else {
      ;({ tabId, paneId } = await createJobTab(workspaceId, tabLabel, review.workdir))
    }
    await renamePane(paneId, `triage · ${review.title}`)
    const agent = await startClaudeIn(paneId, `jrt-${review.key}`, triagePrompt(review), {
      args: ['--model', REVIEW_MODEL],
    })
    await updateReview(key, (fresh) => {
      if (fresh.triage.status === 'done') return
      Object.assign(fresh.triage, { status: 'running', agent, tabId, error: undefined, dispatchedAt: new Date().toISOString() })
    })
  } catch (err: any) {
    const error = String(err?.message ?? err).slice(0, 300)
    await updateReview(key, (fresh) => {
      if (fresh.triage.status === 'done') return
      Object.assign(fresh.triage, { status: 'failed', error })
    }).catch(() => {})
  }
}
