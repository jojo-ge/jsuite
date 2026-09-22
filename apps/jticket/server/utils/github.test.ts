// The bits of the GitHub side that decide when origin is owed a push: how far
// the local integration branch has run ahead, and whether the roll-up PR that
// makes the branch public is on record. Both run against real git, since both
// are answers about a repo rather than about a string.
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { branchDrift, prNumberFromUrl, rememberRollupPr } from './github'
import type { Project } from './store'

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' })
}

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'jticket-github-'))
  roots.push(root)
  return root
}

/** A clone with an origin behind it, both carrying the integration branch. */
function clonedRepo(branch: string): string {
  const origin = join(tempRoot(), 'origin.git')
  execFileSync('git', ['init', '--quiet', '--bare', '--initial-branch=master', origin])
  const work = join(tempRoot(), 'work')
  execFileSync('git', ['clone', '--quiet', origin, work])
  git(work, 'config', 'user.email', 'test@example.com')
  git(work, 'config', 'user.name', 'Test')
  writeFileSync(join(work, 'README.md'), '# thing\n')
  git(work, 'add', '.')
  git(work, 'commit', '--quiet', '-m', 'first')
  git(work, 'push', '--quiet', '-u', 'origin', 'master')
  git(work, 'checkout', '--quiet', '-b', branch)
  git(work, 'push', '--quiet', '-u', 'origin', `${branch}:${branch}`)
  return work
}

function commit(work: string, message: string): void {
  writeFileSync(join(work, `${message}.txt`), message)
  git(work, 'add', '.')
  git(work, 'commit', '--quiet', '-m', message)
}

describe('branchDrift', () => {
  const BRANCH = 'proj/PROJ-8-hydra-asset-library'

  it('is level right after the branch is pushed', async () => {
    expect(await branchDrift(clonedRepo(BRANCH), BRANCH)).toEqual({ ahead: 0, behind: 0 })
  })

  it('counts the merges origin has not been told about', async () => {
    const work = clonedRepo(BRANCH)
    commit(work, 'tick-205')
    commit(work, 'tick-206')

    expect(await branchDrift(work, BRANCH)).toEqual({ ahead: 2, behind: 0 })
  })

  it('is null for a branch that was never pushed', async () => {
    const work = clonedRepo(BRANCH)
    git(work, 'branch', 'proj/PROJ-9-private')

    expect(await branchDrift(work, 'proj/PROJ-9-private')).toBeNull()
  })
})

describe('the roll-up PR record', () => {
  function project(): Project {
    return { id: 'proj_1', key: 'PROJ-8', rollupPr: null } as unknown as Project
  }

  it('reads the number out of a gh URL', () => {
    expect(prNumberFromUrl('https://github.com/year13/kraken/pull/1234')).toBe(1234)
    expect(prNumberFromUrl('not a url')).toBe(0)
  })

  it('records the PR and reports that something changed', () => {
    const p = project()
    expect(rememberRollupPr(p, { number: 12, url: 'https://github.com/o/r/pull/12' })).toBe(true)
    expect(p.rollupPr).toEqual({ number: 12, url: 'https://github.com/o/r/pull/12' })
  })

  it('is a no-op for the PR already on record — a GET must not rewrite the store', () => {
    const p = project()
    rememberRollupPr(p, { number: 12, url: 'https://github.com/o/r/pull/12' })
    expect(rememberRollupPr(p, { number: 12, url: 'https://github.com/o/r/pull/12' })).toBe(false)
  })

  it('ignores a PR with no URL rather than arming pushes on nothing', () => {
    const p = project()
    expect(rememberRollupPr(p, { number: 0, url: '' })).toBe(false)
    expect(p.rollupPr).toBeNull()
  })
})
