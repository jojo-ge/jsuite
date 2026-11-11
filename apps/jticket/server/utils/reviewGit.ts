import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { appDataDir } from '@jsuite/data'
import type { PullRequest } from '../../app/utils/reviewTypes'
import { assertCommandAllowed } from './sandbox'

// The review engine's git and gh reads/writes (jReview's, run inside jTicket
// since TICK-942). Every command passes the sandbox's guard first, like the
// rest of jTicket's git: a sandbox reads anywhere and writes (a review
// worktree) only in its writable repos.

const exec = promisify(execFile)

async function git(repo: string, args: string[], timeout = 15_000): Promise<string> {
  assertCommandAllowed('git', args, repo)
  const { stdout } = await exec('git', ['-C', repo, ...args], { timeout, maxBuffer: 8 * 1024 * 1024 })
  return stdout.trim()
}

async function gh(repo: string, args: string[]): Promise<string> {
  assertCommandAllowed('gh', args, repo)
  const { stdout } = await exec('gh', args, { cwd: repo, timeout: 20_000 })
  return stdout
}

// Refs land verbatim in a claude prompt — accept only ref-shaped text rather
// than trying to escape it.
const REF_SHAPE = /^[A-Za-z0-9._\/~^@{}-]{1,160}$/

export async function assertGitRepo(repo: string): Promise<void> {
  try {
    await git(repo, ['rev-parse', '--git-dir'])
  } catch {
    throw createError({ statusCode: 400, message: `not a git repository: ${repo}` })
  }
}

async function refExists(repo: string, ref: string): Promise<boolean> {
  if (!REF_SHAPE.test(ref)) return false
  try {
    await git(repo, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`])
    return true
  } catch {
    return false
  }
}

/** The checked-out branch; '' when detached. */
export async function currentBranch(repo: string): Promise<string> {
  return git(repo, ['branch', '--show-current']).catch(() => '')
}

/** origin's default branch, else a local main/master; '' when none resolve. */
export async function defaultBase(repo: string): Promise<string> {
  const originHead = await git(repo, ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD']).catch(() => '')
  for (const ref of [originHead, 'main', 'master']) {
    if (ref && (await refExists(repo, ref))) return ref
  }
  return ''
}

/**
 * A branch NAME as GitHub knows it (a PR's baseRefName) → a local ref: the
 * local branch when there is one (freshest for a local stack), else
 * origin/<name>. '' when neither resolves.
 */
export async function resolveBranchName(repo: string, name: string): Promise<string> {
  for (const ref of [name, `origin/${name}`]) {
    if (await refExists(repo, ref)) return ref
  }
  return ''
}

/** A ref the caller named, verified; 400 when it doesn't resolve. */
export async function requireRef(repo: string, ref: string, what: string): Promise<string> {
  if (await refExists(repo, ref)) return ref
  throw createError({ statusCode: 400, message: `${what} does not resolve to a commit in ${repo}: ${ref}` })
}

/**
 * Open PRs by head branch name. One `gh pr list` per call (a network round
 * trip), so it is cached briefly. Throws with gh's own message
 * when gh is missing or the repo has no GitHub remote.
 */
const prCache = new Map<string, { at: number; prs: Map<string, PullRequest> }>()
async function openPrs(repo: string): Promise<Map<string, PullRequest>> {
  const hit = prCache.get(repo)
  if (hit && Date.now() - hit.at < 30_000) return hit.prs
  const stdout = await gh(repo, ['pr', 'list', '--state', 'open', '--limit', '200', '--json', 'number,title,url,headRefName,baseRefName,isDraft'])
  const prs = new Map<string, PullRequest>()
  for (const pr of JSON.parse(stdout || '[]') as PullRequest[]) prs.set(pr.headRefName, pr)
  prCache.set(repo, { at: Date.now(), prs })
  return prs
}

/** The open PR whose head is `branch` (local or `origin/…` name), if any. */
export async function prForBranch(repo: string, branch: string): Promise<PullRequest | null> {
  try {
    return (await openPrs(repo)).get(branch.replace(/^origin\//, '')) ?? null
  } catch {
    return null
  }
}

/**
 * The main checkout of whatever repo `dir` belongs to — `dir` itself unless
 * it's a linked worktree. jTicket keys codebases by path, so anything handed to
 * it names the main checkout, never a worktree. Falls back to `dir` when git
 * can't say (or the main checkout is bare).
 */
export async function mainCheckout(dir: string): Promise<string> {
  const listed = await git(dir, ['worktree', 'list', '--porcelain']).catch(() => '')
  const [first, second] = listed.split('\n')
  if (!first?.startsWith('worktree ') || second === 'bare') return dir
  return first.slice('worktree '.length)
}

// ── Worktrees ────────────────────────────────────────────────────────────────
// A branch that isn't checked out gets a detached worktree, so reviewers see
// it as HEAD without jReview ever touching the human's own checkout. It goes
// where the codebase keeps its worktrees — `root` from its worktree guide on
// jTicket — else under .data/jreview/worktrees.

const worktreeRoot = () => appDataDir('jreview/worktrees')

export async function addReviewWorktree(repo: string, key: string, branch: string, root = ''): Promise<string> {
  const dir = root ? join(root, `jreview-${key}`) : join(worktreeRoot(), key)
  try {
    // A full checkout of a big repo (13k+ files) routinely runs past 15s;
    // give this call room the other, cheap git calls don't need.
    await git(repo, ['worktree', 'add', '--detach', dir, branch], 180_000)
  } catch (err: any) {
    throw createError({
      statusCode: 500,
      message: `could not check out ${branch} in a worktree: ${String(err?.stderr || err?.message).trim().slice(0, 300)}`,
    })
  }
  return dir
}

/**
 * Best-effort: the worktree may already be gone. Only ever a linked worktree
 * of `repo` — never its main checkout — since a guide can put review
 * worktrees anywhere, not just under jReview's own root.
 */
export async function removeReviewWorktree(repo: string, dir: string): Promise<void> {
  const listed = await git(repo, ['worktree', 'list', '--porcelain']).catch(() => '')
  const paths = listed.split('\n').filter((l) => l.startsWith('worktree ')).map((l) => l.slice('worktree '.length))
  const isLinked = paths.slice(1).includes(dir)
  if (!isLinked && !dir.startsWith(worktreeRoot())) return
  await git(repo, ['worktree', 'remove', '--force', dir]).catch(() => {})
  if (!existsSync(dir)) await git(repo, ['worktree', 'prune']).catch(() => {})
}

// ── Pull requests by number ──────────────────────────────────────────────────

/**
 * PR `number` of the repo's GitHub remote, as `gh pr view` reports it —
 * open or not (a PR review project may rerun after the PR merged). Throws a
 * 400 with gh's own message when gh can't answer.
 */
export async function prByNumber(repo: string, number: number): Promise<PullRequest> {
  try {
    const stdout = await gh(repo, ['pr', 'view', String(number), '--json', 'number,title,url,headRefName,baseRefName,isDraft'])
    return JSON.parse(stdout) as PullRequest
  } catch (err: any) {
    const why = String(err?.stderr || err?.message || err).trim().split('\n')[0]!.slice(0, 200)
    throw createError({ statusCode: 400, message: `gh could not read PR #${number} in ${repo}: ${why}` })
  }
}

/** The commit `ref` points at ('' when it doesn't resolve). */
export async function commitOf(repo: string, ref: string): Promise<string> {
  if (!REF_SHAPE.test(ref)) return ''
  return git(repo, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]).catch(() => '')
}

/**
 * The lines `head` adds or changes relative to the merge base with `base`,
 * per file, as new-file line numbers — where GitHub accepts an inline review
 * comment on the RIGHT side. Context lines are left out on purpose: they are
 * only commentable inside a hunk GitHub shows, and its hunks can differ.
 */
export async function changedLines(repo: string, base: string, head: string): Promise<Map<string, Set<number>>> {
  const out = new Map<string, Set<number>>()
  if (!REF_SHAPE.test(base) || !REF_SHAPE.test(head)) return out
  const diff = await git(repo, ['diff', '--unified=0', '--no-color', '--no-ext-diff', `${base}...${head}`], 60_000).catch(() => '')
  let file = ''
  for (const line of diff.split('\n')) {
    if (line.startsWith('+++ ')) {
      file = line.startsWith('+++ b/') ? line.slice(6) : ''
      continue
    }
    const m = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(line)
    if (!m || !file) continue
    const start = Number(m[1])
    const count = m[2] === undefined ? 1 : Number(m[2])
    if (!out.has(file)) out.set(file, new Set())
    for (let i = 0; i < count; i++) out.get(file)!.add(start + i)
  }
  return out
}
