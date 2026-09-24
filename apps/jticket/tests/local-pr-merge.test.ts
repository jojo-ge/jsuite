import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { squashMergePr } from '../server/utils/localPrs'

let repo: string

function git(...args: string[]): string {
  return execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim()
}

function commit(file: string, message: string) {
  writeFileSync(join(repo, file), message)
  git('add', file)
  git('commit', '-q', '-m', message)
}

function parents(oid: string): string[] {
  return git('rev-list', '--parents', '-n', '1', oid).split(' ').slice(1)
}

function isAncestor(a: string, b: string): boolean {
  try {
    git('merge-base', '--is-ancestor', a, b)
    return true
  } catch {
    return false
  }
}

// main ── gate (integration branch). origin/main is simulated with a plain
// ref + origin/HEAD, which is all the merge reads.
beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), 'jticket-merge-'))
  git('init', '-q', '-b', 'main')
  git('config', 'user.email', 'test@example.com')
  git('config', 'user.name', 'test')
  commit('base.txt', 'base')
  git('branch', 'gate')
  git('checkout', '-q', 'gate')
  commit('gate.txt', 'gate work')
})

afterEach(() => rmSync(repo, { recursive: true, force: true }))

function publishUpstream() {
  git('update-ref', 'refs/remotes/origin/main', 'main')
  git('symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main')
}

describe('squashMergePr', () => {
  it('squashes a PR that carries only ticket commits', async () => {
    publishUpstream()
    git('checkout', '-q', '-b', 'tick', 'gate')
    commit('a.txt', 'ticket one')
    commit('b.txt', 'ticket two')
    git('checkout', '-q', 'main')
    const base = git('rev-parse', 'gate')

    const result = await squashMergePr(repo, { head: 'tick', base: 'gate', message: 'PR' })

    expect(result).toMatchObject({ ok: true, mergedAs: 'squash', parent: base })
    if (!result.ok) return
    expect(parents(result.commit)).toEqual([base])
  })

  it('merges with two parents when the PR brings upstream history the base lacks', async () => {
    git('checkout', '-q', 'main')
    commit('upstream.txt', 'upstream moved on')
    publishUpstream()
    git('checkout', '-q', '-b', 'sync', 'gate')
    git('merge', '-q', '--no-edit', 'main')
    git('checkout', '-q', 'main')
    const base = git('rev-parse', 'gate')
    const head = git('rev-parse', 'sync')

    const result = await squashMergePr(repo, { head: 'sync', base: 'gate', message: 'PR' })

    expect(result).toMatchObject({ ok: true, mergedAs: 'merge', parent: base })
    if (!result.ok) return
    expect(parents(result.commit)).toEqual([base, head])
    expect(isAncestor('refs/remotes/origin/main', 'gate')).toBe(true)
  })

  it('keeps squashing when the repo has no origin/HEAD', async () => {
    git('checkout', '-q', 'main')
    commit('upstream.txt', 'upstream moved on')
    git('checkout', '-q', '-b', 'sync', 'gate')
    git('merge', '-q', '--no-edit', 'main')
    git('checkout', '-q', 'main')
    const base = git('rev-parse', 'gate')

    const result = await squashMergePr(repo, { head: 'sync', base: 'gate', message: 'PR' })

    expect(result).toMatchObject({ ok: true, mergedAs: 'squash' })
    if (!result.ok) return
    expect(parents(result.commit)).toEqual([base])
  })
})
