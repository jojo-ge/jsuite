// Stacked builds — the git plumbing. Merging the base into a project's
// integration branch ("Sync from upstream"), and the read-only measurements the
// state answer is made of (ahead/behind, unpushed, the slice's size).
//
// The merge works like a local PR merge (localPrs.ts): merge-tree computes the
// result in memory, commit-tree makes the commit, update-ref moves the branch
// guarded by its old oid — nothing is checked out, so whatever the human has
// open is untouched. A conflict is an answer, not a mess: the branch stays
// where it was and the conflicted files are named. A branch checked out in a
// worktree (the main checkout or a linked one) is moved only when that
// worktree is clean, and then that worktree is reset onto the new tip so files
// and ref agree; a dirty one refuses before anything moves.
//
// Decision logic (which case, what to merge, the merge kind) is in
// app/utils/stacking.ts. No store and no h3 here, so tests drive it against
// throwaway repos.
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { assertCommandAllowed } from './sandbox'
import { branchOid, worktreeOf } from './localPrs'
import { mergeKind, parseMergeTreeConflict, parseShortstat, type MergeKind, type SliceSize, type SyncPlan } from '../../app/utils/stacking'

const pExecFile = promisify(execFile)

async function git(cwd: string, args: string[]): Promise<string> {
  assertCommandAllowed('git', args, cwd)
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

/** A ref (or oid) → its commit oid, or null. */
export async function commitOid(path: string, ref: string): Promise<string | null> {
  if (!ref) return null
  const out = await tryGit(path, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`])
  return (out ?? '').trim() || null
}

/** The first of `refs` that names a commit here: [ref, oid] — or null. */
export async function firstCommit(path: string, refs: string[]): Promise<[string, string] | null> {
  for (const ref of refs) {
    const oid = await commitOid(path, ref)
    if (oid) return [ref, oid]
  }
  return null
}

export async function isAncestor(path: string, a: string, b: string): Promise<boolean> {
  return (await tryGit(path, ['merge-base', '--is-ancestor', a, b])) !== null
}

export async function mergeBaseOf(path: string, a: string, b: string): Promise<string | null> {
  return ((await tryGit(path, ['merge-base', a, b])) ?? '').trim() || null
}

/** Commits on `to` that `from` lacks — null when git can't say. */
export async function countRange(path: string, from: string, to: string): Promise<number | null> {
  const out = await tryGit(path, ['rev-list', '--count', `${from}..${to}`])
  const n = Number.parseInt((out ?? '').trim(), 10)
  return Number.isFinite(n) ? n : null
}

/** Files changed, lines added/removed from `fromOid` to `toOid`; null when the diff is empty. */
export async function sliceSize(path: string, fromOid: string, toOid: string): Promise<SliceSize | null> {
  const out = await tryGit(path, ['diff', '--shortstat', '--no-ext-diff', '-M', fromOid, toOid])
  return out === null ? null : parseShortstat(out)
}

/** Refresh origin's copy of a branch into its remote-tracking ref. false when origin can't give it (gone, offline). */
export async function fetchBranch(path: string, branch: string): Promise<boolean> {
  return (await tryGit(path, ['fetch', '--quiet', 'origin', `+refs/heads/${branch}:refs/remotes/origin/${branch}`])) !== null
}

async function worktreeIsClean(dir: string): Promise<boolean> {
  const out = await tryGit(dir, ['status', '--porcelain'])
  return out !== null && !out.trim()
}

export type MergeOutcome =
  | {
      ok: true
      kind: MergeKind
      /** The ref that was merged in: 'refs/remotes/origin/main', or the local branch. */
      fromRef: string
      before: string
      after: string
      /** The merge base given to merge-tree (the squash-merge case); null = git's own. */
      mergeBase: string | null
      /** The worktree that has the branch checked out and was moved with it. */
      worktree: string | null
    }
  | { ok: false; reason: 'conflict'; fromRef: string; conflictFiles: string[] }
  | { ok: false; reason: 'dirty-worktree'; worktree: string }
  | { ok: false; reason: 'missing'; detail: string }

/**
 * Merge `plan.mergeFrom` (origin's copy, fetched first; the local branch when
 * origin has none) into `branch`. In the squash-merge case the merge base is
 * the upstream's tip — `upstreamTips` are tried in order (the merged PR's head
 * oid, then the upstream branch's refs) — when that commit is in this clone.
 */
export async function mergeIntoBranch(
  path: string,
  opts: { branch: string; plan: SyncPlan; message: string; upstreamTips?: string[]; fetch?: boolean },
): Promise<MergeOutcome> {
  const { branch, plan } = opts
  const before = await branchOid(path, branch)
  if (!before) return { ok: false, reason: 'missing', detail: `integration branch not in this clone: ${branch}` }

  if (opts.fetch !== false) await fetchBranch(path, plan.mergeFrom)
  const from = await firstCommit(path, [`refs/remotes/origin/${plan.mergeFrom}`, `refs/heads/${plan.mergeFrom}`])
  if (!from) return { ok: false, reason: 'missing', detail: `${plan.mergeFrom} is neither on origin nor in this clone` }
  const [fromRef, fromOid] = from

  const worktree = await worktreeOf(path, branch)
  const kind = mergeKind({
    fromIsAncestorOfBranch: await isAncestor(path, fromOid, before),
    branchIsAncestorOfFrom: await isAncestor(path, before, fromOid),
  })
  if (kind === 'up-to-date') return { ok: true, kind, fromRef, before, after: before, mergeBase: null, worktree: null }
  if (worktree && !(await worktreeIsClean(worktree))) return { ok: false, reason: 'dirty-worktree', worktree }

  let after = fromOid
  let mergeBase: string | null = null
  if (kind === 'merge') {
    if (plan.useUpstreamTip) mergeBase = await upstreamMergeBase(path, before, fromOid, opts.upstreamTips ?? [])
    let tree: string
    try {
      const args = ['merge-tree', '--write-tree', '--no-messages', '--name-only', ...(mergeBase ? [`--merge-base=${mergeBase}`] : []), before, fromOid]
      tree = (await git(path, args)).split('\n')[0]!.trim()
    } catch (err: any) {
      const stdout = String(err?.stdout ?? '')
      // Exit 1 with a tree oid first is merge-tree's "conflict" answer.
      if (err?.code === 1 && /^[0-9a-f]{40}/.test(stdout)) return { ok: false, reason: 'conflict', fromRef, conflictFiles: parseMergeTreeConflict(stdout) }
      throw new Error(`merge-tree failed (git >= 2.40 required): ${String(err?.stderr || err?.message || err).trim().slice(0, 300)}`)
    }
    after = (await git(path, ['commit-tree', tree, '-p', before, '-p', fromOid, '-m', opts.message])).trim()
  }
  // Guarded by the old oid: if the branch moved since we looked, fail rather
  // than drop whatever moved it.
  await git(path, ['update-ref', '-m', opts.message, `refs/heads/${branch}`, after, before])
  // Verified clean above, so reset --hard loses nothing: files follow the ref.
  if (worktree) await git(worktree, ['reset', '--hard', '--quiet', after])
  return { ok: true, kind, fromRef, before, after, mergeBase, worktree }
}

/**
 * The squash case's merge base: the newest upstream commit this branch shares
 * with the upstream's tip. Null (git's own merge base) when no tip is in this
 * clone, or the tip already reached the branch being merged in — a regular
 * merge, where git's merge base is right already.
 */
async function upstreamMergeBase(path: string, branchOid: string, fromOid: string, tips: string[]): Promise<string | null> {
  const tip = await firstCommit(path, tips.filter(Boolean))
  if (!tip) return null
  if (await isAncestor(path, tip[1], fromOid)) return null
  return mergeBaseOf(path, branchOid, tip[1])
}
