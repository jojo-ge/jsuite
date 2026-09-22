// The worktree side of a project: naming, the fleet registry we read but never
// write, and the git work itself — which runs against a real throwaway repo,
// because `git worktree add` is the one part where being wrong is expensive.
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  ensureWorktree,
  fleetLauncher,
  isSafeSlug,
  readFleetSlot,
  suggestWorktreeSlug,
  worktreeAlive,
  worktreeDir,
} from './worktrees'

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'jticket-worktrees-'))
  roots.push(root)
  return root
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' })
}

/** A one-commit repo with an extra branch, standing in for a project's clone. */
function tempRepo(branch = 'proj/PROJ-8-hydra-asset-library'): string {
  const dir = tempRoot()
  git(dir, 'init', '--quiet', '--initial-branch=master')
  git(dir, 'config', 'user.email', 'test@example.com')
  git(dir, 'config', 'user.name', 'Test')
  writeFileSync(join(dir, 'README.md'), '# thing\n')
  git(dir, 'add', '.')
  git(dir, 'commit', '--quiet', '-m', 'first')
  git(dir, 'branch', branch)
  return dir
}

describe('naming', () => {
  it('names the worktree after the project, lowercase-hyphen', () => {
    expect(suggestWorktreeSlug({ key: 'PROJ-8', title: 'hydra Asset Library' }))
      .toBe('proj-8-hydra-asset-library')
  })

  it('falls back to the key when the title slugifies to nothing', () => {
    expect(suggestWorktreeSlug({ key: 'PROJ-8', title: '!!!' })).toBe('proj-8')
  })

  it('puts it under the repo, in .worktrees/', () => {
    expect(worktreeDir('/code/kraken', 'proj-8-thing')).toBe('/code/kraken/.worktrees/proj-8-thing')
  })

  it('rejects slugs that would escape the directory or read as a flag', () => {
    expect(isSafeSlug('proj-8-hydra-asset-library')).toBe(true)
    expect(isSafeSlug('../../etc')).toBe(false)
    expect(isSafeSlug('-force')).toBe(false)
    expect(isSafeSlug('Proj-8')).toBe(false)
    expect(isSafeSlug('')).toBe(false)
  })
})

describe('fleet detection', () => {
  it('is off for a repo with no launcher', () => {
    expect(fleetLauncher(tempRepo())).toBeNull()
  })

  it('is on for a repo that ships an executable kraken', () => {
    const repo = tempRepo()
    writeFileSync(join(repo, 'kraken'), '#!/bin/sh\n', { mode: 0o755 })
    expect(fleetLauncher(repo)).toBe(join(repo, 'kraken'))
  })
})

describe('readFleetSlot', () => {
  it('finds the slot claimed for a checkout', () => {
    const repo = tempRepo()
    const dir = worktreeDir(repo, 'proj-8-thing')
    mkdirSync(join(repo, '.fleet'), { recursive: true })
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(repo, '.fleet', 'slot1.json'), JSON.stringify({ slot: 1, worktree: '/elsewhere', host: 'wt1.local' }))
    writeFileSync(join(repo, '.fleet', 'slot2.json'), JSON.stringify({ slot: 2, worktree: dir, host: 'wt2.local', status: 'up' }))

    expect(readFleetSlot(repo, dir)).toEqual({ slot: 2, host: 'wt2.local', status: 'up' })
  })

  it('is null when no slot points at the checkout, and when there is no registry', () => {
    const repo = tempRepo()
    const dir = worktreeDir(repo, 'proj-8-thing')
    expect(readFleetSlot(repo, dir)).toBeNull()
    mkdirSync(join(repo, '.fleet'), { recursive: true })
    writeFileSync(join(repo, '.fleet', 'slot1.json'), '{ half-written')
    expect(readFleetSlot(repo, dir)).toBeNull()
  })
})

describe('ensureWorktree', () => {
  it('checks the branch out under .worktrees/', async () => {
    const repo = tempRepo()
    const dir = worktreeDir(repo, 'proj-8-hydra-asset-library')

    const res = await ensureWorktree(repo, 'proj/PROJ-8-hydra-asset-library', dir)

    expect(res).toEqual({ path: dir, created: true })
    expect(await worktreeAlive(repo, dir)).toBe(true)
    expect(git(dir, 'rev-parse', '--abbrev-ref', 'HEAD').trim()).toBe('proj/PROJ-8-hydra-asset-library')
  })

  it('adopts a checkout that already has the branch instead of duplicating it', async () => {
    const repo = tempRepo()
    const elsewhere = join(tempRoot(), 'conductor-workspace')
    git(repo, 'worktree', 'add', '--quiet', elsewhere, 'proj/PROJ-8-hydra-asset-library')

    const res = await ensureWorktree(repo, 'proj/PROJ-8-hydra-asset-library', worktreeDir(repo, 'proj-8-thing'))

    expect(res.created).toBe(false)
    // git answers with the resolved path (/private/... on macOS), and that is
    // the one the job records — it is what every later `worktree list` says.
    expect(res.path).toBe(realpathSync(elsewhere))
  })

  it('refuses a leftover directory that no worktree stands behind', async () => {
    const repo = tempRepo()
    const dir = worktreeDir(repo, 'proj-8-thing')
    mkdirSync(dir, { recursive: true })

    await expect(ensureWorktree(repo, 'proj/PROJ-8-hydra-asset-library', dir)).rejects.toMatchObject({
      statusCode: 409,
    })
  })

  it('reports a checkout that was removed behind our back', async () => {
    const repo = tempRepo()
    const dir = worktreeDir(repo, 'proj-8-thing')
    await ensureWorktree(repo, 'proj/PROJ-8-hydra-asset-library', dir)
    rmSync(dir, { recursive: true, force: true })

    expect(await worktreeAlive(repo, dir)).toBe(false)
  })
})
