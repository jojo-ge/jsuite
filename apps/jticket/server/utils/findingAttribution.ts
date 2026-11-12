// Which ticket introduced a review finding — the quality half of a run's
// record. A review files what it found as fix tickets; that says what was
// wrong, not whose work it was. Blame says: the finding's file and line, at
// the commit the review read, name the squash commit that last wrote the
// line; that commit is a local PR's merge commit; the PR belongs to a ticket.
//
// A heuristic, and named as one on every row (`by`): 'line' is a blame of the
// finding's own line; 'file' — for a finding with no line — is the last commit
// in the review's range to touch the file. A finding whose commit is no PR of
// the project's is code from before the run (`introducedBy` '').
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { Finding, Review } from '../../app/utils/reviewTypes'
import type { LocalPr } from './store'
import { assertCommandAllowed } from './sandbox'

const pExecFile = promisify(execFile)

export interface FindingAttribution {
  findingId: string
  title: string
  severity: string
  category: string
  /** What the reviewers said: introduced by the diff under review ('in') or there before ('out'). */
  scope: string
  verdict: string
  /** How many reviewers raised it. */
  raisedBy: number
  file: string
  line: number | null
  /** The ticket the finding became ('' when it was never filed). */
  fixTicket: string
  /** The commit git names for the line or file ('' when it couldn't say). */
  commit: string
  by: 'line' | 'file' | ''
  /** The local PR whose merge that commit is, and its ticket ('' = not this project's work). */
  introducedPr: string
  introducedBy: string
}

export type BlameFn = (file: string, line: number | null) => Promise<{ commit: string; by: 'line' | 'file' | '' }>

/** Attribute each finding. Pure but for `blame` — tests pass their own. */
export async function attributeFindings(
  findings: Finding[],
  blame: BlameFn,
  prs: Pick<LocalPr, 'key' | 'mergeCommit' | 'ticketId'>[],
  ticketKeyById: Map<string, string>,
): Promise<FindingAttribution[]> {
  const merged = prs.filter((p) => p.mergeCommit)
  const prOf = (commit: string) => (commit ? merged.find((p) => p.mergeCommit === commit || p.mergeCommit.startsWith(commit) || commit.startsWith(p.mergeCommit)) : undefined)
  const out: FindingAttribution[] = []
  for (const f of findings) {
    const line = typeof f.line === 'number' && f.line > 0 ? f.line : null
    const { commit, by } = f.file ? await blame(f.file, line).catch(() => ({ commit: '', by: '' as const })) : { commit: '', by: '' as const }
    const pr = prOf(commit)
    out.push({
      findingId: f.id,
      title: f.title,
      severity: f.severity,
      category: f.category,
      scope: f.scope ?? '',
      verdict: f.verdict ?? '',
      raisedBy: f.reviewers?.length ?? 0,
      file: f.file ?? '',
      line,
      fixTicket: f.ticketKey ?? '',
      commit,
      by,
      introducedPr: pr?.key ?? '',
      introducedBy: pr ? (ticketKeyById.get(pr.ticketId) ?? '') : '',
    })
  }
  return out
}

/** The first line of `git blame --porcelain` is `<oid> <orig-line> <final-line> <count>`. */
export function blamedCommit(porcelain: string): string {
  const m = /^\^?([0-9a-f]{7,40})\s/.exec(porcelain)
  return m && !/^0+$/.test(m[1]!) ? m[1]! : ''
}

/**
 * Blame through git, in `repo`, at the commit the review read (`rev`). A
 * finding with no line falls back to the last commit in `base..rev` that
 * touched its file.
 */
export function gitBlame(repo: string, rev: string, base: string): BlameFn {
  const run = async (args: string[]) => {
    const full = ['-C', repo, ...args]
    assertCommandAllowed('git', full, repo)
    return (await pExecFile('git', full, { timeout: 15_000, maxBuffer: 16 * 1024 * 1024 })).stdout
  }
  return async (file, line) => {
    if (line) {
      const commit = await run(['blame', '-L', `${line},${line}`, '--porcelain', rev, '--', file])
        .then(blamedCommit)
        .catch(() => '')
      if (commit) return { commit, by: 'line' }
    }
    const range = base ? `${base}..${rev}` : rev
    const commit = await run(['log', '-1', '--format=%H', range, '--', file])
      .then((s) => s.trim())
      .catch(() => '')
    return commit ? { commit, by: 'file' } : { commit: '', by: '' }
  }
}

/** The commit a review read: its recorded head, else its branch. */
export function reviewRev(review: Pick<Review, 'headSha' | 'branch'>): string {
  return review.headSha || review.branch
}
