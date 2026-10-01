// Where a project's integration branch stands — the Branches tab's data.
//
// Two comparisons, both read from local refs (so they're as fresh as the last
// fetch — the tab's ↻ fetches first):
//   - against origin/<branch>: what a push would send, what a pull would bring
//   - against origin/<default>: how far the project has moved off main, and
//     how far main has moved on since
//
// Plus the fast-forward pull. Push lives in api/projects/[id]/sync.post.ts.
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { run } from './github'
import { worktreeOf, type PrCommit } from './localPrs'

const pExecFile = promisify(execFile)

async function tryGit(cwd: string, args: string[]): Promise<string | null> {
  try {
    const { stdout } = await pExecFile('git', args, { cwd, maxBuffer: 16 * 1024 * 1024 })
    return stdout
  } catch {
    return null
  }
}

async function refOid(path: string, ref: string): Promise<string | null> {
  return ((await tryGit(path, ['rev-parse', '--verify', '--quiet', ref])) ?? '').trim() || null
}

/** Commits in `range` (`a..b`), newest first. */
async function logRange(path: string, range: string, limit = 50): Promise<PrCommit[]> {
  const out = await tryGit(path, ['log', `--max-count=${limit}`, '--format=%H%x09%h%x09%an%x09%cI%x09%s', range])
  if (!out) return []
  return out
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => {
      const [oid, shortOid, author, committedAt, ...rest] = l.split('\t')
      return { oid: oid ?? '', shortOid: shortOid ?? '', author: author ?? '', committedAt: committedAt ?? '', subject: rest.join('\t') }
    })
}

async function countRange(path: string, range: string): Promise<number> {
  return Number(((await tryGit(path, ['rev-list', '--count', range])) ?? '').trim()) || 0
}

/**
 * Refresh origin's copy of the branch and the default branch. Each refspec is
 * fetched on its own: a branch that was never pushed makes a combined fetch
 * fail outright. A branch origin doesn't have is an answer, not a failure —
 * its stale tracking ref (deleted on origin) is dropped. Returns false only
 * when origin couldn't be reached; the status then reads older refs.
 */
export async function fetchBranches(path: string, branches: string[]): Promise<boolean> {
  let ok = true
  for (const b of branches) {
    try {
      await pExecFile('git', ['fetch', '--quiet', 'origin', `+refs/heads/${b}:refs/remotes/origin/${b}`], { cwd: path })
    } catch (err: any) {
      if (/couldn't find remote ref/i.test(String(err?.stderr ?? ''))) {
        await tryGit(path, ['update-ref', '-d', `refs/remotes/origin/${b}`])
      } else {
        ok = false
      }
    }
  }
  return ok
}

export interface BranchStatus {
  name: string
  defaultBranch: string
  tip: PrCommit | null
  /** False when the branch only exists on origin (not in this clone). */
  local: boolean
  /** origin/<branch> as of the last fetch. */
  onOrigin: boolean
  /** Commits a push would send (every commit off the default branch, if never pushed). */
  toPush: PrCommit[]
  toPushCount: number
  /** Commits on origin the local branch lacks — a pull would bring them. */
  incoming: PrCommit[]
  incomingCount: number
  /** Diverged: both sides have commits the other lacks — a pull can't fast-forward. */
  diverged: boolean
  /** Against origin/<default> (or the local default when origin's is unknown). */
  aheadOfDefault: number
  behindDefault: number
  /** The worktree the branch is checked out in, if any, and its uncommitted file count. */
  checkedOutAt: string | null
  dirtyFiles: number
}

export async function branchStatus(path: string, branch: string, defaultBranch: string): Promise<BranchStatus> {
  const local = `refs/heads/${branch}`
  const remote = `refs/remotes/origin/${branch}`
  const [localOid, remoteOid] = await Promise.all([refOid(path, local), refOid(path, remote)])
  const def = (await refOid(path, `refs/remotes/origin/${defaultBranch}`))
    ? `refs/remotes/origin/${defaultBranch}`
    : `refs/heads/${defaultBranch}`
  const head = localOid ? local : remote

  const [tip] = await logRange(path, `${head}`, 1)
  const pushRange = localOid ? (remoteOid ? `${remote}..${local}` : `${def}..${local}`) : null
  const pullRange = localOid && remoteOid ? `${local}..${remote}` : null
  const [toPush, toPushCount, incoming, incomingCount, aheadOfDefault, behindDefault] = await Promise.all([
    pushRange ? logRange(path, pushRange) : [],
    pushRange ? countRange(path, pushRange) : 0,
    pullRange ? logRange(path, pullRange) : [],
    pullRange ? countRange(path, pullRange) : 0,
    countRange(path, `${def}..${head}`),
    countRange(path, `${head}..${def}`),
  ])

  const checkedOutAt = localOid ? await worktreeOf(path, branch) : null
  const dirty = checkedOutAt ? await tryGit(checkedOutAt, ['status', '--porcelain']) : null
  return {
    name: branch,
    defaultBranch,
    tip: tip ?? null,
    local: !!localOid,
    onOrigin: !!remoteOid,
    toPush,
    toPushCount,
    incoming,
    incomingCount,
    diverged: !!remoteOid && toPushCount > 0 && incomingCount > 0,
    aheadOfDefault,
    behindDefault,
    checkedOutAt,
    dirtyFiles: dirty ? dirty.split('\n').filter((l) => l.trim()).length : 0,
  }
}

/**
 * Fast-forward the local branch to origin's. Never merges or rebases: a
 * diverged branch is a 409 for a human (or an agent) to sort out. When the
 * branch is checked out somewhere, the fast-forward runs in that worktree so
 * its files move with the ref; otherwise only the ref moves (compare-and-swap
 * against the tip we checked, so a concurrent local-PR merge isn't lost).
 */
export async function fastForwardFromOrigin(path: string, branch: string): Promise<{ from: string; to: string }> {
  await fetchBranches(path, [branch])
  const local = `refs/heads/${branch}`
  const remote = `refs/remotes/origin/${branch}`
  const [from, to] = await Promise.all([refOid(path, local), refOid(path, remote)])
  if (!from) throw createError({ statusCode: 400, statusMessage: `${branch} is not in this clone` })
  if (!to) throw createError({ statusCode: 400, statusMessage: `${branch} is not on origin — push it first` })
  if (from === to) return { from, to }
  if ((await tryGit(path, ['merge-base', '--is-ancestor', local, remote])) === null) {
    throw createError({
      statusCode: 409,
      statusMessage: `${branch} has diverged from origin — both sides have commits the other lacks. Rebase or merge it by hand.`,
    })
  }
  const dir = await worktreeOf(path, branch)
  if (dir) await run('git', ['merge', '--ff-only', '--quiet', remote], dir)
  else await run('git', ['update-ref', local, to, from], path)
  return { from, to }
}
