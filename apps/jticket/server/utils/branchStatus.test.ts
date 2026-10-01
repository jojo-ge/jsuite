import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

// Real git, throwaway repos: an `origin` bare repo, the project's clone, and a
// second clone standing in for a teammate who pushes to the same branch.
let mod: typeof import('./branchStatus')
beforeAll(async () => {
  // github.ts's run() and the ff-only refusal lean on h3's createError.
  vi.stubGlobal('createError', (o: { statusCode: number; statusMessage: string }) =>
    Object.assign(new Error(o.statusMessage), o),
  )
  mod = await import('./branchStatus')
})

let root: string
let clone: string
let teammate: string
const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
function commit(cwd: string, name: string) {
  writeFileSync(join(cwd, name), name)
  git(cwd, 'add', name)
  git(cwd, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', `add ${name}`)
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'jticket-branch-'))
  const origin = join(root, 'origin.git')
  clone = join(root, 'clone')
  teammate = join(root, 'teammate')
  git(root, 'init', '-q', '--bare', '-b', 'main', origin)
  git(root, 'clone', '-q', origin, clone)
  git(clone, 'checkout', '-q', '-b', 'main')
  commit(clone, 'base')
  git(clone, 'push', '-q', 'origin', 'main')
  git(clone, 'branch', 'proj/X-1')
  git(root, 'clone', '-q', origin, teammate)
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

describe('branchStatus', () => {
  it('counts every commit off the default branch as to-push when never pushed', async () => {
    git(clone, 'checkout', '-q', 'proj/X-1')
    commit(clone, 'a')
    commit(clone, 'b')
    const s = await mod.branchStatus(clone, 'proj/X-1', 'main')
    expect(s).toMatchObject({ local: true, onOrigin: false, toPushCount: 2, incomingCount: 0, aheadOfDefault: 2, behindDefault: 0 })
    expect(s.checkedOutAt).toBeTruthy()
  })

  it('sees what a push sends and what a pull brings, and flags divergence', async () => {
    git(clone, 'push', '-q', '-u', 'origin', 'proj/X-1')
    git(teammate, 'fetch', '-q')
    git(teammate, 'checkout', '-q', 'proj/X-1')
    commit(teammate, 'theirs')
    git(teammate, 'push', '-q', 'origin', 'proj/X-1')

    await mod.fetchBranches(clone, ['proj/X-1', 'main'])
    let s = await mod.branchStatus(clone, 'proj/X-1', 'main')
    expect(s).toMatchObject({ onOrigin: true, toPushCount: 0, incomingCount: 1, diverged: false })

    git(clone, 'checkout', '-q', 'proj/X-1')
    commit(clone, 'mine-too')
    s = await mod.branchStatus(clone, 'proj/X-1', 'main')
    expect(s).toMatchObject({ toPushCount: 1, incomingCount: 1, diverged: true })
  })

  it('treats a branch origin never had as an answer, not an outage', async () => {
    expect(await mod.fetchBranches(clone, ['proj/X-1', 'main'])).toBe(true)
  })
})

describe('fastForwardFromOrigin', () => {
  beforeEach(() => {
    git(clone, 'push', '-q', '-u', 'origin', 'proj/X-1')
    git(teammate, 'fetch', '-q')
    git(teammate, 'checkout', '-q', 'proj/X-1')
    commit(teammate, 'theirs')
    git(teammate, 'push', '-q', 'origin', 'proj/X-1')
  })

  it('moves only the ref when the branch is not checked out', async () => {
    const theirs = git(teammate, 'rev-parse', 'HEAD')
    const res = await mod.fastForwardFromOrigin(clone, 'proj/X-1')
    expect(res.to).toBe(theirs)
    expect(git(clone, 'rev-parse', 'refs/heads/proj/X-1')).toBe(theirs)
    expect(git(clone, 'status', '--porcelain')).toBe('')
  })

  it('fast-forwards inside the worktree that has it checked out', async () => {
    git(clone, 'checkout', '-q', 'proj/X-1')
    await mod.fastForwardFromOrigin(clone, 'proj/X-1')
    expect(git(clone, 'rev-parse', 'HEAD')).toBe(git(teammate, 'rev-parse', 'HEAD'))
    expect(git(clone, 'status', '--porcelain')).toBe('')
  })

  it('refuses a diverged branch and leaves it alone', async () => {
    git(clone, 'checkout', '-q', 'proj/X-1')
    commit(clone, 'mine')
    const before = git(clone, 'rev-parse', 'HEAD')
    await expect(mod.fastForwardFromOrigin(clone, 'proj/X-1')).rejects.toMatchObject({ statusCode: 409 })
    expect(git(clone, 'rev-parse', 'HEAD')).toBe(before)
  })
})
