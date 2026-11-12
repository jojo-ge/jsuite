// "Sync from upstream" — the git plumbing (server/utils/integrationSync.ts)
// against real throwaway repos: an origin (bare) and a clone of it. The cases
// that matter: an open upstream moved on, an upstream squash-merged into main
// (the user's repos squash), a real conflict, and the integration branch
// checked out in a linked worktree.
//
// STACKING_TEST_DIR puts the repos somewhere to inspect; the OS tmpdir otherwise.
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { commitOid, mergeIntoBranch, sliceSize } from '../server/utils/integrationSync'
import { planSync } from '../app/utils/stacking'

let root: string
let origin: string
let repo: string

function gitIn(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
}
const git = (...args: string[]) => gitIn(repo, ...args)

function write(cwd: string, file: string, text: string) {
  writeFileSync(join(cwd, file), text)
}
function commit(cwd: string, file: string, text: string, message = `${file}: ${text.trim()}`) {
  write(cwd, file, text)
  gitIn(cwd, 'add', file)
  gitIn(cwd, 'commit', '-q', '-m', message)
}
const parents = (oid: string) => git('rev-list', '--parents', '-n', '1', oid).split(' ').slice(1)
const show = (ref: string, file: string) => git('show', `${ref}:${file}`)

beforeEach(() => {
  const parent = process.env.STACKING_TEST_DIR || tmpdir()
  mkdirSync(parent, { recursive: true })
  // realpath: git reports worktree paths resolved (macOS's /var is /private/var).
  root = realpathSync(mkdtempSync(join(parent, 'sync-')))
  origin = join(root, 'origin.git')
  repo = join(root, 'clone')
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', origin])
  execFileSync('git', ['clone', '-q', origin, repo], { stdio: 'ignore' })
  git('config', 'user.email', 'test@example.com')
  git('config', 'user.name', 'test')
  git('config', 'commit.gpgsign', 'false')
  git('checkout', '-q', '-b', 'main')
  commit(repo, 'app.txt', 'line 1\nline 2\nline 3\n', 'init')
  git('push', '-q', 'origin', 'main')
  // The upstream build: proj/up, one commit, pushed.
  git('checkout', '-q', '-b', 'proj/up')
  commit(repo, 'app.txt', 'line 1\nupstream line\nline 3\n', 'upstream work')
  git('push', '-q', '-u', 'origin', 'proj/up')
  // The stacked build: proj/stack, cut from proj/up, with its own work.
  git('checkout', '-q', '-b', 'proj/stack')
  commit(repo, 'stack.txt', 'stacked work\n')
  git('push', '-q', '-u', 'origin', 'proj/stack')
  git('checkout', '-q', 'main')
})

afterEach(() => rmSync(root, { recursive: true, force: true }))

const open = planSync({ integrationBase: 'proj/up', defaultBranch: 'main', upstream: { merged: false, why: '' } })
const merged = planSync({ integrationBase: 'proj/up', defaultBranch: 'main', upstream: { merged: true, why: '' } })
const notStacked = planSync({ integrationBase: '', defaultBranch: 'main', upstream: { merged: false, why: '' } })

/** Squash proj/up into main on origin and delete the branch everywhere, like GitHub's squash merge. Returns the upstream tip. */
function squashUpstream(): string {
  const tip = git('rev-parse', 'proj/up')
  git('checkout', '-q', 'main')
  git('merge', '-q', '--squash', 'proj/up')
  git('commit', '-q', '-m', 'Upstream build (#1)')
  git('push', '-q', 'origin', 'main')
  git('push', '-q', 'origin', '--delete', 'proj/up')
  git('branch', '-q', '-D', 'proj/up')
  return tip
}

describe('mergeIntoBranch', () => {
  it('merges an open upstream that moved on, from origin, with two parents', async () => {
    git('checkout', '-q', 'proj/up')
    commit(repo, 'more.txt', 'more upstream\n')
    git('push', '-q', 'origin', 'proj/up')
    git('reset', '-q', '--hard', 'HEAD~1') // the local copy lags: the sync must fetch origin's
    git('checkout', '-q', 'main')
    const before = git('rev-parse', 'proj/stack')

    const res = await mergeIntoBranch(repo, { branch: 'proj/stack', plan: open, message: 'sync' })

    expect(res).toMatchObject({ ok: true, kind: 'merge', fromRef: 'refs/remotes/origin/proj/up', before, worktree: null })
    if (!res.ok) return
    expect(git('rev-parse', 'proj/stack')).toBe(res.after)
    expect(parents(res.after)).toEqual([before, git('rev-parse', 'origin/proj/up')])
    expect(show('proj/stack', 'more.txt')).toBe('more upstream')
    expect(show('proj/stack', 'stack.txt')).toBe('stacked work')
    // Nothing was checked out: the main checkout is still on main, clean.
    expect(git('rev-parse', '--abbrev-ref', 'HEAD')).toBe('main')
    expect(git('status', '--porcelain')).toBe('')
  })

  it('answers up to date when the upstream has nothing new', async () => {
    const before = git('rev-parse', 'proj/stack')
    const res = await mergeIntoBranch(repo, { branch: 'proj/stack', plan: open, message: 'sync' })
    expect(res).toMatchObject({ ok: true, kind: 'up-to-date', before, after: before })
  })

  it('fast-forwards a branch with no work of its own', async () => {
    git('branch', 'proj/empty', 'main')
    commit(repo, 'main.txt', 'main moved\n')
    git('push', '-q', 'origin', 'main')
    const res = await mergeIntoBranch(repo, { branch: 'proj/empty', plan: notStacked, message: 'sync' })
    expect(res).toMatchObject({ ok: true, kind: 'fast-forward', after: git('rev-parse', 'main') })
  })

  it('squash-merged upstream: merging main comes out clean and the slice is only the stack', async () => {
    const tip = squashUpstream()
    const before = git('rev-parse', 'proj/stack')

    const res = await mergeIntoBranch(repo, { branch: 'proj/stack', plan: merged, message: 'sync', upstreamTips: [tip] })

    expect(res).toMatchObject({ ok: true, kind: 'merge', fromRef: 'refs/remotes/origin/main', mergeBase: tip })
    if (!res.ok) return
    expect(parents(res.after)).toEqual([before, git('rev-parse', 'origin/main')])
    // The merged tree is main plus the stacked work, nothing else.
    expect(git('diff', '--name-only', 'origin/main', res.after)).toBe('stack.txt')
    expect(await sliceSize(repo, git('merge-base', 'origin/main', res.after), res.after)).toEqual({ files: 1, additions: 1, deletions: 0 })
  })

  it('squash-merged upstream: a stack that edited the upstream\'s own lines still merges clean, where a plain merge conflicts', async () => {
    // The stack rewrites the line the upstream wrote — what makes a plain
    // merge of main (git's merge base: the old fork point) conflict.
    git('checkout', '-q', 'proj/stack')
    commit(repo, 'app.txt', 'line 1\nupstream line, refined by the stack\nline 3\n')
    git('push', '-q', 'origin', 'proj/stack')
    const tip = squashUpstream()
    // Someone else's work landed on main after the squash, too.
    commit(repo, 'other.txt', 'other work\n')
    git('push', '-q', 'origin', 'main')
    const before = git('rev-parse', 'proj/stack')

    const plain = await mergeIntoBranch(repo, { branch: 'proj/stack', plan: { ...merged, useUpstreamTip: false }, message: 'sync' })
    expect(plain).toMatchObject({ ok: false, reason: 'conflict', conflictFiles: ['app.txt'] })
    expect(git('rev-parse', 'proj/stack')).toBe(before)

    const res = await mergeIntoBranch(repo, { branch: 'proj/stack', plan: merged, message: 'sync', upstreamTips: [tip] })
    expect(res).toMatchObject({ ok: true, kind: 'merge', mergeBase: tip })
    if (!res.ok) return
    expect(show(res.after, 'app.txt')).toBe('line 1\nupstream line, refined by the stack\nline 3')
    expect(show(res.after, 'other.txt')).toBe('other work')
    expect(git('diff', '--name-only', 'origin/main', res.after).split('\n').sort()).toEqual(['app.txt', 'stack.txt'])
  })

  it('a real conflict leaves the branch and its linked worktree untouched and names the files', async () => {
    const wt = join(root, 'wt-stack')
    git('worktree', 'add', '-q', wt, 'proj/stack')
    commit(wt, 'app.txt', 'line 1\nstack says this\nline 3\n')
    git('checkout', '-q', 'main')
    commit(repo, 'app.txt', 'line 1\nmain says that\nline 3\n')
    commit(repo, 'notes.txt', 'unrelated\n')
    git('push', '-q', 'origin', 'main')
    const before = git('rev-parse', 'proj/stack')
    const stackOnly = planSync({ integrationBase: '', defaultBranch: 'main', upstream: { merged: false, why: '' } })

    const res = await mergeIntoBranch(repo, { branch: 'proj/stack', plan: stackOnly, message: 'sync' })

    expect(res).toEqual({ ok: false, reason: 'conflict', fromRef: 'refs/remotes/origin/main', conflictFiles: ['app.txt'] })
    expect(git('rev-parse', 'proj/stack')).toBe(before)
    expect(gitIn(wt, 'rev-parse', 'HEAD')).toBe(before)
    expect(gitIn(wt, 'status', '--porcelain')).toBe('')
    expect(readFileSync(join(wt, 'app.txt'), 'utf8')).toBe('line 1\nstack says this\nline 3\n')
  })

  it('moves a branch checked out in a clean linked worktree, files and all', async () => {
    const wt = join(root, 'wt-stack')
    git('worktree', 'add', '-q', wt, 'proj/stack')
    git('checkout', '-q', 'proj/up')
    commit(repo, 'more.txt', 'more upstream\n')
    git('push', '-q', 'origin', 'proj/up')
    git('checkout', '-q', 'main')

    const res = await mergeIntoBranch(repo, { branch: 'proj/stack', plan: open, message: 'sync' })

    expect(res).toMatchObject({ ok: true, kind: 'merge', worktree: wt })
    if (!res.ok) return
    expect(gitIn(wt, 'rev-parse', 'HEAD')).toBe(res.after)
    expect(gitIn(wt, 'status', '--porcelain')).toBe('')
    expect(readFileSync(join(wt, 'more.txt'), 'utf8')).toBe('more upstream\n')
  })

  it('refuses a branch checked out in a dirty worktree before anything moves', async () => {
    const wt = join(root, 'wt-stack')
    git('worktree', 'add', '-q', wt, 'proj/stack')
    write(wt, 'stack.txt', 'half-edited\n')
    git('checkout', '-q', 'proj/up')
    commit(repo, 'more.txt', 'more upstream\n')
    git('push', '-q', 'origin', 'proj/up')
    git('checkout', '-q', 'main')
    const before = git('rev-parse', 'proj/stack')

    const res = await mergeIntoBranch(repo, { branch: 'proj/stack', plan: open, message: 'sync' })

    expect(res).toEqual({ ok: false, reason: 'dirty-worktree', worktree: wt })
    expect(git('rev-parse', 'proj/stack')).toBe(before)
    expect(readFileSync(join(wt, 'stack.txt'), 'utf8')).toBe('half-edited\n')
  })

  it('answers missing for a branch or base that is nowhere', async () => {
    expect(await mergeIntoBranch(repo, { branch: 'proj/nope', plan: open, message: 'sync' })).toMatchObject({ ok: false, reason: 'missing' })
    const gone = { ...open, mergeFrom: 'proj/gone' }
    expect(await mergeIntoBranch(repo, { branch: 'proj/stack', plan: gone, message: 'sync' })).toMatchObject({ ok: false, reason: 'missing' })
  })
})

describe('sliceSize', () => {
  it('measures files and lines from a base commit, null for no diff', async () => {
    const up = (await commitOid(repo, 'proj/up'))!
    expect(await sliceSize(repo, up, git('rev-parse', 'proj/stack'))).toEqual({ files: 1, additions: 1, deletions: 0 })
    expect(await sliceSize(repo, git('rev-parse', 'main'), up)).toEqual({ files: 1, additions: 1, deletions: 1 })
    expect(await sliceSize(repo, up, up)).toBeNull()
  })
})
