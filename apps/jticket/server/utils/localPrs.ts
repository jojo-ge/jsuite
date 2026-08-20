// Local pull requests — the git side.
//
// A local PR is jTicket's own review unit: a ticket branch squash-merged onto
// the project's integration branch by the app itself, no GitHub involved. The
// merge is done with plumbing (merge-tree → commit-tree → update-ref) so it
// never checks anything out and never touches the user's working tree — the
// merge button works whatever is checked out, half-edited or not. A conflict is
// an answer, not a mess: the repo is left exactly as it was and the conflicted
// files are reported so the head branch can be rebased and the merge retried.
//
// Needs git >= 2.38 (`merge-tree --write-tree`). Store-side shape: LocalPr in
// store.ts; the HTTP surface: server/api/prs/*.
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { LocalPr, Store, Ticket } from './store'

// run() (github.ts) wraps failures in an h3 error and drops the exit code and
// stdout, but merge-tree's conflict answer *is* a non-zero exit with output —
// so this file talks to git directly.
const pExecFile = promisify(execFile)

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await pExecFile('git', args, { cwd, maxBuffer: 16 * 1024 * 1024 })
  return stdout
}

async function tryGit(cwd: string, args: string[]): Promise<string | null> {
  try {
    return await git(cwd, args)
  } catch {
    return null
  }
}

export interface PrCommit {
  oid: string
  shortOid: string
  subject: string
  author: string
  committedAt: string
}

/** The oid of a local branch tip, or null when the branch doesn't exist. */
export async function branchOid(path: string, branch: string): Promise<string | null> {
  const out = await tryGit(path, ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`])
  return (out ?? '').trim() || null
}

/** The commits a PR carries: on head, not yet on base, newest first. */
export async function listPrCommits(path: string, base: string, head: string, limit = 50): Promise<PrCommit[]> {
  const out = await tryGit(path, [
    'log',
    `--max-count=${limit}`,
    '--format=%H%x09%h%x09%an%x09%cI%x09%s',
    `refs/heads/${base}..refs/heads/${head}`,
  ])
  if (!out) return []
  return out
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => {
      const [oid, shortOid, author, committedAt, ...rest] = l.split('\t')
      return { oid: oid ?? '', shortOid: shortOid ?? '', author: author ?? '', committedAt: committedAt ?? '', subject: rest.join('\t') }
    })
}

/** The directory of the worktree that has `branch` checked out, or null. */
export async function worktreeOf(path: string, branch: string): Promise<string | null> {
  const out = await tryGit(path, ['worktree', 'list', '--porcelain'])
  if (!out) return null
  let dir: string | null = null
  for (const line of out.split('\n')) {
    if (line.startsWith('worktree ')) dir = line.slice('worktree '.length).trim()
    else if (line === `branch refs/heads/${branch}` && dir) return dir
  }
  return null
}

async function worktreeIsClean(dir: string): Promise<boolean> {
  const out = await tryGit(dir, ['status', '--porcelain'])
  return out !== null && !out.trim()
}

export type SquashResult =
  | { ok: true; commit: string; headDeleted: boolean }
  | { ok: false; conflictFiles: string[] }

/**
 * Squash-merge `head` onto `base` without touching any working tree, then (on
 * success) delete the head branch. Throws 400/409 for the states a retry can't
 * fix by itself (missing branch, nothing to merge, dirty checkout of base);
 * returns { ok: false } for a content conflict — the caller records it on the
 * PR and the repo is left untouched.
 */
export async function squashMergePr(
  path: string,
  opts: { head: string; base: string; message: string },
): Promise<SquashResult> {
  const { head, base, message } = opts

  const baseOid = await branchOid(path, base)
  if (!baseOid) throw createError({ statusCode: 400, statusMessage: `base branch not in this clone: ${base}` })
  const headOid = await branchOid(path, head)
  if (!headOid) throw createError({ statusCode: 400, statusMessage: `head branch not in this clone: ${head}` })

  const ahead = Number.parseInt((await git(path, ['rev-list', '--count', `${baseOid}..${headOid}`])).trim(), 10)
  if (!ahead) throw createError({ statusCode: 400, statusMessage: `${head} has no commits that ${base} lacks — nothing to merge` })

  // If the base branch happens to be checked out somewhere, moving its ref
  // would desync that checkout — allowed only when it's clean (we re-sync it
  // after the merge). A dirty checkout refuses rather than risking anything.
  const baseWorktree = await worktreeOf(path, base)
  if (baseWorktree && !(await worktreeIsClean(baseWorktree))) {
    throw createError({
      statusCode: 409,
      statusMessage: `${base} is checked out at ${baseWorktree} with uncommitted changes — commit or stash them, then merge again`,
    })
  }

  // merge-tree computes the merged tree in memory: exit 0 = clean (stdout is
  // the tree oid), exit 1 = conflict (tree oid, then the conflicted filenames
  // thanks to --name-only). Any other failure is a real error — including a git
  // too old to know --write-tree.
  let tree: string
  try {
    const out = await git(path, ['merge-tree', '--write-tree', '--no-messages', '--name-only', base, head])
    tree = out.split('\n')[0]!.trim()
  } catch (err: any) {
    const stdout = String(err?.stdout ?? '')
    // Exit 1 with a tree oid on stdout is merge-tree's "conflict" answer.
    if (err?.code === 1 && /^[0-9a-f]{40}/.test(stdout)) {
      const [, ...files] = stdout.split('\n').map((l) => l.trim())
      return { ok: false, conflictFiles: files.filter(Boolean) }
    }
    throw createError({
      statusCode: 500,
      statusMessage: `merge-tree failed (git >= 2.38 required): ${String(err?.stderr || err?.message || err).trim().slice(0, 300)}`,
    })
  }

  const commit = (await git(path, ['commit-tree', tree, '-p', baseOid, '-m', message])).trim()
  // Guarded by the old oid: if base moved since we looked, fail instead of
  // silently dropping whatever moved it.
  await git(path, ['update-ref', `refs/heads/${base}`, commit, baseOid])

  // A clean checkout of base gets fast-forwarded to the new tip so the ref and
  // the files agree again. (Verified clean above; reset --hard loses nothing.)
  if (baseWorktree) await git(baseWorktree, ['reset', '--hard', commit])

  // The squash carries everything, so the ticket branch has served its purpose
  // — but one that's checked out (mid-review, say) is left alone.
  let headDeleted = false
  if (!(await worktreeOf(path, head))) {
    headDeleted = (await tryGit(path, ['branch', '-D', head])) !== null
  }

  return { ok: true, commit, headDeleted }
}

/** Resolve a PR by id or key. */
export function findPrRef(store: Store, ref: unknown): LocalPr | undefined {
  if (typeof ref !== 'string' || !ref) return undefined
  return store.prs.find((pr) => pr.id === ref || pr.key === ref)
}

/** The default branch name for a ticket's work: 'tick/TICK-7-persist-cart'. */
export function suggestTicketBranchName(ticket: Pick<Ticket, 'key' | 'title'>): string {
  const tail = slugify(ticket.title)
  return `tick/${ticket.key}${tail ? `-${tail}` : ''}`
}

/** What every GET returns for a PR: the record plus who/where it points at. */
export function withPrDerived(store: Store, pr: LocalPr, repoPath: string | null) {
  const ticket = store.tickets.find((t) => t.id === pr.ticketId)
  return {
    ...pr,
    ticketKey: ticket?.key ?? null,
    ticketTitle: ticket?.title ?? null,
    jdiffUrl: repoPath ? jdiffBranchUrl(repoPath, pr.status === 'merged' ? pr.baseBranch : pr.headBranch) : null,
  }
}
