import { basename } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import {
  ensureHerdrWorkspace,
  acquirePackedPane,
  createJobTab,
  renamePane,
  startClaudeIn,
  herdrJson,
  invalidateHerdrState,
} from '@jsuite/herdr'
import { isReviewTab, type Review } from '../../app/utils/reviewTypes'

const pExecFile = promisify(execFile)

// Driving Herdr (the terminal workspace manager) from jReview.
//
// jReview runs NO claude of its own. Every session is an interactive claude in
// a herdr pane, one workspace per reviewed repo (`jreview · <dir>`), every
// pane's cwd the review's workdir (the repo, or the branch's worktree):
//   - REVIEWERS — packed 2×2 into a `review <key>` tab, one pane each. The
//     prompt runs the global /code-review skill — never the target repo's own
//     — then `/jreview-report` publishes the report as a jExplain
//     document at the reviewer's pre-assigned key. That document landing in
//     the pool IS the completion signal — the watcher plugin sees it.
//   - the TRIAGER — one job tab, dispatched by the watcher once every reviewer
//     is settled. `/jreview-triage <key>` dedupes the reports, publishes the
//     triage document, and POSTs the merged findings to /api/reviews/:key/findings.
//     A consensus review gets `/jreview-consensus <key>` on CONSENSUS_MODEL in
//     that tab instead: it files the findings every reviewer raised into the
//     caller's jTicket project and POSTs the ticket keys to /consensus.
//
// Once that hand-back lands the watcher closes the review's panes (every pane
// in its 'review K' / 'triage K' tabs — never one whose agent is still working
// or blocked), and a triaged review opens in the browser instead — on its
// jTicket project's Review tab when it belongs to one.
// jTicket's auto loop sweeps the same tabs for its consensus reviews; closing
// is idempotent, so whichever gets there first wins and the other finds nothing.

/** Every session is pinned to Opus 5.5; JREVIEW_MODEL overrides it. */
export const REVIEW_MODEL = process.env.JREVIEW_MODEL?.trim() || 'claude-opus-5-5'

/**
 * The consensus session only matches finished reports and files tickets —
 * Sonnet 5 is plenty; JREVIEW_CONSENSUS_MODEL overrides it.
 */
export const CONSENSUS_MODEL = process.env.JREVIEW_CONSENSUS_MODEL?.trim() || 'claude-sonnet-5'

export function reviewerPrompt(review: Review, n: number): string {
  const r = review.reviewers.find((x) => x.n === n)!
  // One line: herdr submits the prompt as typed input, and a newline would
  // submit it early.
  return [
    'Run the global /code-review skill (~/.claude/skills/code-review) — not any code-review skill this repo carries in its own .claude/skills.',
    `HEAD in this checkout is ${review.branch}${review.pr ? ` (PR #${review.pr.number}, "${review.pr.title.replace(/[\r\n]+/g, ' ')}")` : ''}.`,
    `The fixed point is ${review.base} — review \`git diff ${review.base}...HEAD\`.`,
    ...(review.worktree && review.worktreeGuide
      ? [`This checkout is a fresh worktree: if you need to install or run anything, set it up the codebase's way — its worktree guide is at ${review.worktreeGuide}.`]
      : []),
    'Work unattended: do not stop to ask questions — if no spec turns up, carry on without one and say so.',
    `When the review is complete, publish it into jReview with /jreview-report review=${review.key} reviewer=${n} doc=${r.docKey}.`,
  ].join(' ')
}

export const triagePrompt = (review: Review) =>
  review.consensus ? `/jreview-consensus ${review.key}` : `/jreview-triage ${review.key}`

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
 * Start the triage session (the consensus session, for a consensus review) in
 * its own job tab. Never throws — a failure is
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
    await renamePane(paneId, `${review.consensus ? 'consensus' : 'triage'} · ${review.title}`)
    const agent = await startClaudeIn(paneId, `jrt-${review.key}`, triagePrompt(review), {
      args: ['--model', review.consensus ? CONSENSUS_MODEL : REVIEW_MODEL],
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

/**
 * Close every herdr pane in the review's tabs whose agent isn't working or
 * blocked (closing a tab's last pane closes the tab; an emptied workspace goes
 * too, and is recreated on the next dispatch). Returns true when none of the
 * review's panes are left open. Throws only when herdr can't be listed; a pane
 * that won't close (jTicket's sweep got it first) is simply skipped.
 */
export async function closeReviewPanes(key: string): Promise<boolean> {
  const [tabList, paneList] = await Promise.all([herdrJson<any>(['tab', 'list']), herdrJson<any>(['pane', 'list'])])
  const tabLabel = new Map<string, string>((tabList?.result?.tabs ?? []).map((t: any) => [t.tab_id, String(t.label ?? '')]))
  const mine = (paneList?.result?.panes ?? []).filter((p: any) => isReviewTab(tabLabel.get(p.tab_id) ?? '', key))
  const busy = mine.filter((p: any) => p.agent_status === 'working' || p.agent_status === 'blocked')
  let closed = 0
  for (const p of mine) {
    if (busy.includes(p)) continue
    try {
      await herdrJson(['pane', 'close', p.pane_id])
      closed++
    } catch { /* already gone */ }
  }
  if (closed) invalidateHerdrState()
  return busy.length === 0
}

/**
 * Open the finished review where the human picks it up: its jTicket project's
 * Review tab when it belongs to one, else its page here. Best-effort;
 * JREVIEW_OPEN_BROWSER=0 turns it off.
 */
export async function openReviewInBrowser(review: Pick<Review, 'key' | 'project'>): Promise<void> {
  if (process.env.JREVIEW_OPEN_BROWSER?.trim() === '0') return
  const { key, project } = review
  const url = project
    ? `${JTICKET_PUBLIC}/projects/${encodeURIComponent(project)}?tab=review&review=${encodeURIComponent(key)}`
    : `https://jreview.local/r/${key}`
  try {
    await pExecFile('open', [url])
  } catch (err: any) {
    console.error(`[jreview] could not open ${key} in the browser:`, String(err?.message ?? err))
  }
}
