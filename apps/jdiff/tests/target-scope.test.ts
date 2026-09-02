import { describe, expect, it } from 'vitest'
import { DIFF_SCOPES, parseTargetParams, requireCommittedScope } from '../server/utils/target'

describe('?scope= parsing', () => {
  it('defaults a branch target to the committed scope', () => {
    expect(parseTargetParams({ branch: 'feat-x' }).scope).toBe('committed')
    expect(parseTargetParams({ branch: 'feat-x', scope: '' }).scope).toBe('committed')
  })

  it('accepts every advertised scope', () => {
    for (const scope of DIFF_SCOPES) {
      expect(parseTargetParams({ branch: 'feat-x', scope }).scope).toBe(scope)
    }
  })

  it('rejects an unknown scope', () => {
    expect(() => parseTargetParams({ branch: 'feat-x', scope: 'wip' })).toThrow(/bad \?scope=/)
  })

  it('keeps scope out of storeKey, so artifacts stay branch-keyed', () => {
    const committed = parseTargetParams({ branch: 'feat-x' })
    const staged = parseTargetParams({ branch: 'feat-x', scope: 'staged' })
    expect(staged.storeKey).toBe(committed.storeKey)
    expect(staged.storeKey).toBe('branch/feat-x')
  })

  it('pins PR targets to the committed scope, whatever was asked for', () => {
    expect(parseTargetParams({ number: '12', scope: 'staged' }).scope).toBe('committed')
  })
})

describe('requireCommittedScope', () => {
  it('passes committed targets through', () => {
    expect(() => requireCommittedScope(parseTargetParams({ branch: 'b' }), 'a review run')).not.toThrow()
    expect(() => requireCommittedScope(parseTargetParams({ number: '1' }), 'a review run')).not.toThrow()
  })

  it('blocks the worktree scopes, naming the one that was asked for', () => {
    expect(() => requireCommittedScope(parseTargetParams({ branch: 'b', scope: 'unstaged' }), 'a tour'))
      .toThrow(/a tour needs the committed scope — unstaged/)
  })
})
