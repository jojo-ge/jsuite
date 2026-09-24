import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  buildGuide,
  cleanWorktreeGuide,
  cleanWorktreeLinks,
  guideState,
  linkState,
  normalizeSourcePath,
  parseWorktreeList,
  type WorktreeLink,
} from './worktrees'

// The guide is the codebase's own answer to "how do worktrees work here" —
// the contract that matters is that it can't point outside the repo, that it
// goes stale when the files it rests on change, and that "linked" is always
// git's word, never the stored record's.

function repo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'jticket-wt-'))
  writeFileSync(join(dir, 'package.json'), '{"name":"x"}')
  mkdirSync(join(dir, 'docs'))
  writeFileSync(join(dir, 'docs', 'CLAUDE.md'), 'use pnpm')
  return dir
}

describe('buildGuide', () => {
  it('hashes sources and resolves a relative root against the repo', () => {
    const dir = repo()
    const res = buildGuide(dir, { body: '## Create\ngit worktree add', root: '../wt', sources: ['package.json', 'docs/CLAUDE.md', 'package.json'], verified: true, author: 'claude' }, 'T')
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.guide.root).toBe(join(dir, '..', 'wt'))
    expect(res.guide.sources.map((s) => s.path)).toEqual(['package.json', 'docs/CLAUDE.md'])
    expect(res.guide.sources.every((s) => s.hash.length === 16)).toBe(true)
    expect(res.guide.verified).toBe(true)
    expect(res.guide.updatedAt).toBe('T')
  })

  it('refuses an empty body and sources outside the repo', () => {
    const dir = repo()
    expect(buildGuide(dir, { body: '  ' }, 'T').ok).toBe(false)
    expect(buildGuide(dir, { body: 'x', sources: ['../elsewhere'] }, 'T').ok).toBe(false)
    expect(buildGuide(dir, { body: 'x', sources: ['/etc/hosts'] }, 'T').ok).toBe(false)
  })

  it('records a missing source with an empty hash rather than refusing it', () => {
    const dir = repo()
    const res = buildGuide(dir, { body: 'x', sources: ['.env.example'] }, 'T')
    expect(res.ok && res.guide.sources[0]).toEqual({ path: '.env.example', hash: '' })
  })

  it('only trusts verified: true', () => {
    const res = buildGuide(repo(), { body: 'x', verified: 'yes' }, 'T')
    expect(res.ok && res.guide.verified).toBe(false)
  })
})

describe('normalizeSourcePath', () => {
  it('makes absolute paths under the repo relative', () => {
    expect(normalizeSourcePath('/r', '/r/a/b.json')).toBe('a/b.json')
    expect(normalizeSourcePath('/r', '/r')).toBeNull()
    expect(normalizeSourcePath('/r', '/other/x')).toBeNull()
  })
})

describe('guideState', () => {
  it('is missing with no guide, ready while sources match, stale once one changes', () => {
    const dir = repo()
    expect(guideState(dir, null).state).toBe('missing')
    const res = buildGuide(dir, { body: 'x', sources: ['package.json', 'docs/CLAUDE.md'] }, 'T')
    if (!res.ok) throw new Error(res.error)
    expect(guideState(dir, res.guide)).toEqual({ state: 'ready', changed: [] })
    writeFileSync(join(dir, 'package.json'), '{"name":"y"}')
    expect(guideState(dir, res.guide)).toEqual({ state: 'stale', changed: ['package.json'] })
  })

  it('goes stale when a source that was missing appears', () => {
    const dir = repo()
    const res = buildGuide(dir, { body: 'x', sources: ['.env.example'] }, 'T')
    if (!res.ok) throw new Error(res.error)
    writeFileSync(join(dir, '.env.example'), 'PORT=1')
    expect(guideState(dir, res.guide).state).toBe('stale')
  })
})

describe('parseWorktreeList', () => {
  it('reads paths and branches, detached HEADs as empty', () => {
    const out = [
      'worktree /r', 'HEAD abc', 'branch refs/heads/main', '',
      'worktree /wt/proj', 'HEAD def', 'branch refs/heads/proj/PROJ-1-cart', '',
      'worktree /wt/review', 'HEAD 123', 'detached', '',
    ].join('\n')
    expect(parseWorktreeList(out)).toEqual([
      { path: '/r', branch: 'main' },
      { path: '/wt/proj', branch: 'proj/PROJ-1-cart' },
      { path: '/wt/review', branch: '' },
    ])
  })
})

describe('linkState', () => {
  const entries = [
    { path: '/r', branch: 'main' },
    { path: '/wt/proj', branch: 'proj-1' },
  ]
  const link = (path: string): WorktreeLink => ({ branch: 'proj-1', path, notes: '', author: '', linkedAt: '' })

  it('is linked only when git has the branch at the recorded path', () => {
    expect(linkState(link('/wt/proj'), entries, 'proj-1', '/r')).toEqual({ state: 'linked', checkedOutAt: '/wt/proj' })
  })

  it('is broken when the recorded worktree is gone or moved', () => {
    expect(linkState(link('/wt/old'), entries, 'proj-1', '/r').state).toBe('broken')
    expect(linkState(link('/wt/proj'), [entries[0]!], 'proj-1', '/r').state).toBe('broken')
  })

  it('offers adoption when the branch is already in a worktree, not when it is the main checkout', () => {
    expect(linkState(null, entries, 'proj-1', '/r').state).toBe('unlinked-checked-out')
    expect(linkState(null, entries, 'main', '/r')).toEqual({ state: 'unlinked', checkedOutAt: '/r' })
    expect(linkState(null, entries, 'nope', '/r').state).toBe('unlinked')
  })
})

describe('loading', () => {
  it('drops a guide with no body and links without a branch or path', () => {
    expect(cleanWorktreeGuide({ body: '' })).toBeNull()
    expect(cleanWorktreeGuide(undefined)).toBeNull()
    expect(cleanWorktreeGuide({ body: 'x', verified: 1 })?.verified).toBe(false)
    expect(cleanWorktreeLinks([{ branch: 'b', path: '/p' }, { branch: '', path: '/p' }, null])).toHaveLength(1)
  })
})
