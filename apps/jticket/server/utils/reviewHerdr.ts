import { basename, join } from 'node:path'
import { existsSync, readdirSync } from 'node:fs'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
// jTicket's herdr wrappers, not @jsuite/herdr's: a sandbox dispatches only
// into its writable repos and points every session back at itself.
import {
  ensureHerdrWorkspace,
  acquirePackedPane,
  createJobTab,
  renamePane,
  startClaudeIn,
  herdrJson,
  invalidateHerdrState,
} from './herdr'
import { suiteRoot } from '@jsuite/data'
import { isReviewTab, reviewPath, votes, type Review } from '../../app/utils/reviewTypes'
import { JTICKET_PUBLIC } from './sandbox'

// The publish step reviewers read by path (jreview-report is typed-only, so it cannot be invoked mid-task).
const REPORT_SKILL = join(suiteRoot(), 'apps/jticket/.claude/skills/jreview-report/SKILL.md')

const pExecFile = promisify(execFile)

// Driving Herdr (the terminal workspace manager) for the review engine —
// jReview's, run inside jTicket since TICK-942.
//
// The engine runs NO claude of its own. Every session is an interactive claude in
// a herdr pane, one workspace per reviewed repo (`jreview · <dir>`), every
// pane's cwd the review's workdir (the repo, or the branch's worktree):
//   - REVIEWERS — packed 2×2 into a `review <key>` tab, one pane each. The
//     prompt STARTS with the slash command (`/code-review …`, or
//     `/jarch-review …` on an architecture pass) — claude only runs a skill
//     when `/name` is the first token; mid-sentence it is a mere permission
//     grant — and the rest of the line is the context: the global skill, never
//     the target repo's own, then the jreview-report skill publishes the report as
//     a jExplain document at the reviewer's pre-assigned key. That skill is
//     typed-only, so the prompt names its file for the reviewer to read and
//     follow; a mid-sentence `/jreview-report` would never run. That document
//     landing in the pool IS the completion signal — the watcher plugin sees it.
//   - the TRIAGER — one job tab, dispatched by the watcher once every reviewer
//     is settled. `/jreview-triage <key>` dedupes the reports, publishes the
//     triage document, and POSTs the merged findings to /api/reviews/:key/findings.
//     A consensus review gets `/jreview-consensus <key>` on CONSENSUS_MODEL in
//     that tab instead: it files the findings every reviewer raised into the
//     caller's jTicket project and POSTs the ticket keys to /consensus.
//     An agreement review (a PR review plan) gets `/jreview-consensus <key>`
//     too, on REVIEW_MODEL: it keeps what every reviewer raised, has each
//     finding adversarially verified when `verify` is set, judges
//     approvability, and POSTs findings + assessment to /findings — where
//     the server files each finding on the project as a record-only ticket.
//
// Once that hand-back lands the watcher closes the review's panes (every pane
// in its 'review K' / 'triage K' tabs — never one whose agent is still working
// or blocked), and a triaged review opens in the browser instead — on its
// jTicket project's Review tab when it belongs to one. That watcher sweep is
// the only one: the auto loop's cleanup leaves review tabs to it.

/** Every session is pinned to Opus 5.5; JREVIEW_MODEL overrides it. */
export const REVIEW_MODEL = process.env.JREVIEW_MODEL?.trim() || 'claude-opus-5-5'

/**
 * The consensus session only matches finished reports and files tickets —
 * Sonnet 5 is plenty; JREVIEW_CONSENSUS_MODEL overrides it.
 */
export const CONSENSUS_MODEL = process.env.JREVIEW_CONSENSUS_MODEL?.trim() || 'claude-sonnet-5'

/** A review skill the reviewed codebase carries in its own .claude/skills. */
export interface CodebaseSkill {
  name: string
  /** Its SKILL.md, absolute. */
  path: string
}

/**
 * The codebase's own code-review skill, when it carries one: `code-review`
 * first, else the first skill whose name says review (jSuite's own jreview-*
 * / jarch-review skills excepted — a jSuite checkout carries those). Read
 * from the review's checkout, so it is the PR's version of the skill.
 */
export function codebaseReviewSkill(workdir: string): CodebaseSkill | null {
  const dir = join(workdir, '.claude/skills')
  let names: string[] = []
  try {
    names = readdirSync(dir).filter((d) => existsSync(join(dir, d, 'SKILL.md')))
  } catch {
    return null
  }
  const ours = (d: string) => d.startsWith('jreview-') || d === 'jarch-review' || d === 'jdiff-review'
  const pick = names.includes('code-review') ? 'code-review' : names.sort().find((d) => /review/i.test(d) && !ours(d))
  return pick && /^[A-Za-z0-9._-]{1,60}$/.test(pick) ? { name: pick, path: join(dir, pick, 'SKILL.md') } : null
}

/**
 * The reviewer's hand-off. `priorDocs` are the reports of the earlier review
 * named in `context.review` (the architectural pass), resolved by the caller.
 * `own` is the codebase's own review skill (codebaseReviewSkill): an
 * agreement review (a PR review plan) runs it in place of the global
 * /code-review when there is one — the codebase knows its own standards.
 */
export function reviewerPrompt(review: Review, n: number, priorDocs: string[] = [], own: CodebaseSkill | null = null): string {
  const r = review.reviewers.find((x) => x.n === n)!
  const arch = review.pass === 'architecture'
  // One line: herdr submits the prompt as typed input, and a newline would
  // submit it early. The slash command must be the first token — anywhere
  // else claude treats `/skill` as a permission grant and never runs it.
  const projectKey = review.consensus?.projectKey
  return [
    arch
      ? '/jarch-review the architectural & technical review of this diff. Use the GLOBAL skill (~/.claude/skills/jarch-review) — not /code-review, and not any review skill this repo carries in its own .claude/skills.'
      : review.agreement && own
        ? `/${own.name} the diff below. Use THIS CODEBASE's own review skill — read ${own.path} and follow it (not a global skill of the same name); where it asks for something only a human can give, carry on without it.`
        : '/code-review the diff below. Use the GLOBAL skill (~/.claude/skills/code-review) — not any code-review skill this repo carries in its own .claude/skills.',
    `HEAD in this checkout is ${review.branch}${review.pr ? ` (PR #${review.pr.number}, "${review.pr.title.replace(/[\r\n]+/g, ' ')}")` : ''}.`,
    ...(projectKey ? [`The jTicket project is ${projectKey} (GET http://localhost:43000/api/projects/${projectKey}).`] : []),
    `The fixed point is ${review.base} — review \`git diff ${review.base}...HEAD\`.`,
    ...(review.context?.docs?.length
      ? [`Read first: jTicket doc${review.context.docs.length > 1 ? 's' : ''} ${review.context.docs.join(', ')} (GET http://localhost:43000/api/docs/<key>) — the slice report: what this slice built, where, and the decisions behind it.`]
      : []),
    ...(priorDocs.length
      ? [
          `An architectural review of this same diff ran before you — its report${priorDocs.length > 1 ? 's' : ''}: ${priorDocs.join(', ')} (GET http://localhost:43000/api/documents/<key>). ` +
            'Its architectural findings have already been fixed in what you are reading: do not raise them again, but do check the fixes.',
        ]
      : []),
    ...(review.context?.brief
      ? [
          `Read the review brief first: jTicket doc ${review.context.brief} (GET http://localhost:43000/api/docs/${review.context.brief} gives its documentKey; the content is GET http://localhost:43000/api/documents/<documentKey>). ` +
            'Every reviewer of this review gets the same brief: its focus areas are where to look hardest, not the only places to look.',
        ]
      : []),
    ...(review.context?.checks?.length
      ? [
          `Checks already ran against this code: jTicket ticket${review.context.checks.length > 1 ? 's' : ''} ${review.context.checks.join(', ')} (GET http://localhost:43000/api/tickets/<key> — the resolution says what was run, the outcome and the verdict). ` +
            'Use what they found — a failing check is evidence, not a finding to rediscover — and do not re-run their work unless you doubt it.',
        ]
      : []),
    ...(review.agreement
      ? [
          `This is a review of ${review.pr ? `pull request #${review.pr.number}` : 'a branch'} that someone else may have written: report only — never commit, push, open a PR or comment on GitHub. ` +
            'Mark every finding `scope: in` (the PR introduced or changed it) or `scope: out` (it was there before). ' +
            'End with an approvability verdict — approve, approve-with-nits, request-changes or needs-discussion — in the dump\'s APPROVAL line (the report skill says how).',
        ]
      : []),
    ...(review.worktree && review.worktreeGuide
      ? [`This checkout is a fresh worktree: if you need to install or run anything, set it up the codebase's way — its worktree guide is at ${review.worktreeGuide}.`]
      : []),
    ...(review.consensus && !arch
      ? [
          'Stay in scope: judge the diff against what it set out to do (its tickets, the slice report, the commit messages) — defects in that work, and anything that breaks the build, the tests or existing behaviour, are in scope; ' +
            'pre-existing debt, unrelated refactors, style you would have chosen differently and nice-to-haves are not. Mark every finding `scope: in` or `scope: out`; out-of-scope findings are filed as follow-ups in a separate project, never fixed in this run.',
        ]
      : []),
    'Work unattended: do not stop to ask questions — if no spec turns up, carry on without one and say so.',
    `When the review is complete, publish it: read ${REPORT_SKILL} and follow it with review=${review.key} reviewer=${n} doc=${r.docKey}.`,
  ].join(' ')
}

export const triagePrompt = (review: Review) =>
  votes(review) ? `/jreview-consensus ${review.key}` : `/jreview-triage ${review.key}`

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
    await renamePane(paneId, `${review.pass === 'architecture' ? 'arch reviewer' : `reviewer ${n}`} · ${review.title}`)
    // The earlier pass's reports, when this review follows one.
    const prior = review.context?.review ? await readReview(review.context.review).catch(() => null) : null
    const priorDocs = prior ? prior.reviewers.filter((x) => x.status === 'done').map((x) => x.docKey) : []
    // Slot first, so the 28-char agent-name cap trims the key, not the slot.
    const own = review.agreement ? codebaseReviewSkill(review.workdir) : null
    const agent = await startClaudeIn(paneId, `jr${n}-${review.key}`, reviewerPrompt(review, n, priorDocs, own), {
      args: ['--model', review.model || REVIEW_MODEL, ...(review.effort ? ['--effort', review.effort] : [])],
    })
    await updateReview(key, (fresh) => {
      fresh.workspaceId = workspaceId
      if (own) fresh.reviewSkill = own.name
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
    await renamePane(paneId, `${votes(review) ? 'consensus' : 'triage'} · ${review.title}`)
    // An agreement review's consensus session also judges approvability and,
    // with `verify`, runs the adversarial verifiers — Opus work, not matching.
    const model = review.agreement ? REVIEW_MODEL : review.consensus ? CONSENSUS_MODEL : REVIEW_MODEL
    const agent = await startClaudeIn(paneId, `jrt-${review.key}`, triagePrompt(review), {
      args: ['--model', model],
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
 * that won't close (already gone) is simply skipped.
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
export async function openReviewInBrowser(review: Pick<Review, 'key' | 'project' | 'agreement'>): Promise<void> {
  if (process.env.JREVIEW_OPEN_BROWSER?.trim() === '0') return
  const { key, project } = review
  // A sandbox opens its own Review tab, never the live jTicket's.
  const url = project
    ? `${JTICKET_PUBLIC}/projects/${encodeURIComponent(project)}?tab=review&review=${encodeURIComponent(key)}`
    : `${JTICKET_PUBLIC}${reviewPath(key)}`
  try {
    await pExecFile('open', [url])
  } catch (err: any) {
    console.error(`[jticket] review engine could not open ${key} in the browser:`, String(err?.message ?? err))
  }
}
