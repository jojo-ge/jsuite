import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { appDataDir } from '@jsuite/data'
import type { BranchInfo, BranchList, PullRequest } from '../../app/utils/reviewTypes'

const exec = promisify(execFile)

async function git(repo: string, args: string[]): Promise<string> {
  const { stdout } = await exec('git', ['-C', repo, ...args], { timeout: 15_000, maxBuffer: 8 * 1024 * 1024 })
  return stdout.trim()
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
 * trip), so the branch list caches it briefly. Throws with gh's own message
 * when gh is missing or the repo has no GitHub remote.
 */
const prCache = new Map<string, { at: number; prs: Map<string, PullRequest> }>()
async function openPrs(repo: string): Promise<Map<string, PullRequest>> {
  const hit = prCache.get(repo)
  if (hit && Date.now() - hit.at < 30_000) return hit.prs
  const { stdout } = await exec(
    'gh',
    ['pr', 'list', '--state', 'open', '--limit', '200', '--json', 'number,title,url,headRefName,baseRefName,isDraft'],
    { cwd: repo, timeout: 20_000 },
  )
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
 * Every branch worth reviewing: local branches plus origin branches with no
 * local counterpart (as `origin/<name>`), each with its open PR when gh can
 * tell.
 */
export async function listBranches(repo: string): Promise<BranchList> {
  await assertGitRepo(repo)
  const [current, base, raw] = await Promise.all([
    currentBranch(repo),
    defaultBase(repo),
    git(repo, [
      'for-each-ref',
      '--sort=-committerdate',
      '--format=%(refname)%09%(committerdate:iso-strict)',
      'refs/heads',
      'refs/remotes/origin',
    ]),
  ])

  let prs = new Map<string, PullRequest>()
  let prError: string | undefined
  try {
    prs = await openPrs(repo)
  } catch (err: any) {
    prError = String(err?.stderr || err?.message || err).trim().split('\n')[0]!.slice(0, 200)
  }

  const local = new Set<string>()
  const rows = raw.split('\n').filter(Boolean).map((line) => {
    const [ref, committedAt] = line.split('\t') as [string, string]
    return { ref, committedAt }
  })
  const branches: BranchInfo[] = []
  for (const { ref, committedAt } of rows) {
    if (!ref.startsWith('refs/heads/')) continue
    const name = ref.slice('refs/heads/'.length)
    local.add(name)
    branches.push({ name, remote: false, current: name === current, committedAt, pr: prs.get(name) ?? null })
  }
  for (const { ref, committedAt } of rows) {
    if (!ref.startsWith('refs/remotes/origin/')) continue
    const short = ref.slice('refs/remotes/origin/'.length)
    if (short === 'HEAD' || local.has(short)) continue
    branches.push({ name: `origin/${short}`, remote: true, current: false, committedAt, pr: prs.get(short) ?? null })
  }
  // The checked-out branch, then branches with an open PR, then the rest —
  // each group newest commit first. Big repos carry 1000+ stale branches.
  const rank = (b: BranchInfo) => (b.current ? 0 : b.pr ? 1 : 2)
  branches.sort((a, b) => rank(a) - rank(b) || b.committedAt.localeCompare(a.committedAt))
  return { current, defaultBase: base, branches, prError }
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
    await git(repo, ['worktree', 'add', '--detach', dir, branch])
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
