// Stacked builds — the pure decisions (app/utils/stacking.ts): what the base
// reads as, whether the upstream looks merged, which sync case applies, and the
// gh arguments (tested here because no test may open or edit a real PR).
import { describe, expect, it } from 'vitest'
import {
  compareUrl,
  effectiveBase,
  isStacked,
  mergeKind,
  normalizeBase,
  parseMergeTreeConflict,
  parseShortstat,
  pickUpstreamPr,
  planSync,
  retargetPrArgs,
  rollupPrCreateArgs,
  rollupPrListArgs,
  stackCandidates,
  syncMergeMessage,
  upstreamLooksMerged,
  upstreamPrListArgs,
  type UpstreamPr,
} from '../app/utils/stacking'

const pr = (over: Partial<UpstreamPr>): UpstreamPr => ({
  number: 7, state: 'OPEN', url: 'https://github.com/o/r/pull/7', headRefOid: 'abc', baseRefName: 'main', mergedAt: '', ...over,
})

describe('the base', () => {
  it("reads '' and the default's own name as the default branch", () => {
    expect(effectiveBase('', 'main')).toBe('main')
    expect(effectiveBase(undefined, 'main')).toBe('main')
    expect(effectiveBase('proj/up', 'main')).toBe('proj/up')
    expect(normalizeBase('main', 'main')).toBe('')
    expect(normalizeBase(' proj/up ', 'main')).toBe('proj/up')
    expect(isStacked('main', 'main')).toBe(false)
    expect(isStacked('proj/up', 'main')).toBe(true)
  })
})

describe('pickUpstreamPr', () => {
  it('prefers an open PR, then the latest merged, then closed', () => {
    expect(pickUpstreamPr([pr({ number: 1, state: 'CLOSED' }), pr({ number: 2, state: 'OPEN' })])?.number).toBe(2)
    expect(
      pickUpstreamPr([
        pr({ number: 1, state: 'MERGED', mergedAt: '2026-01-01' }),
        pr({ number: 3, state: 'CLOSED' }),
        pr({ number: 2, state: 'MERGED', mergedAt: '2026-02-01' }),
      ])?.number,
    ).toBe(2)
    expect(pickUpstreamPr([])).toBeNull()
    expect(pickUpstreamPr('nope')).toBeNull()
  })
})

describe('upstreamLooksMerged', () => {
  const base = { stacked: true, pr: null, baseOnOrigin: true, baseLocal: true }
  it('goes by the PR when GitHub answered', () => {
    expect(upstreamLooksMerged({ ...base, pr: pr({ state: 'MERGED' }) }).merged).toBe(true)
    // An open PR wins even when the branch looks gone (a stale ls-remote).
    expect(upstreamLooksMerged({ ...base, pr: pr({ state: 'OPEN' }), baseOnOrigin: false, baseLocal: false }).merged).toBe(false)
  })
  it('reads a branch gone from origin and this clone as merged', () => {
    expect(upstreamLooksMerged({ ...base, baseOnOrigin: false, baseLocal: false })).toEqual({ merged: true, why: 'its branch is gone' })
  })
  it('reads a pushed branch deleted from origin as merged, even with a local copy left', () => {
    expect(upstreamLooksMerged({ ...base, baseOnOrigin: false, baseTracked: true }).merged).toBe(true)
    expect(upstreamLooksMerged({ ...base, baseOnOrigin: false, baseTracked: true, pr: pr({ state: 'CLOSED' }) }).merged).toBe(false)
  })
  it('never calls a local-only or still-present branch merged without a merged PR', () => {
    expect(upstreamLooksMerged({ ...base, baseOnOrigin: false }).merged).toBe(false)
    expect(upstreamLooksMerged({ ...base, baseOnOrigin: null }).merged).toBe(false)
    expect(upstreamLooksMerged({ ...base, pr: pr({ state: 'CLOSED' }) }).merged).toBe(false)
  })
  it('is never merged when not stacked', () => {
    expect(upstreamLooksMerged({ ...base, stacked: false, pr: pr({ state: 'MERGED' }) }).merged).toBe(false)
  })
})

describe('planSync', () => {
  const notMerged = { merged: false, why: '' }
  const isMerged = { merged: true, why: '' }
  it('not stacked: merge the default branch, nothing else changes', () => {
    expect(planSync({ integrationBase: '', defaultBranch: 'main', upstream: notMerged })).toEqual({
      case: 'default', mergeFrom: 'main', newBase: null, retargetTo: null, useUpstreamTip: false,
    })
  })
  it('upstream open: merge the upstream branch', () => {
    expect(planSync({ integrationBase: 'proj/up', defaultBranch: 'main', upstream: notMerged })).toEqual({
      case: 'upstream-open', mergeFrom: 'proj/up', newBase: null, retargetTo: null, useUpstreamTip: false,
    })
  })
  it('upstream merged: merge the default branch, base becomes default, retarget the PR to it', () => {
    expect(planSync({ integrationBase: 'proj/up', defaultBranch: 'main', upstream: isMerged })).toEqual({
      case: 'upstream-merged', mergeFrom: 'main', newBase: '', retargetTo: 'main', useUpstreamTip: true,
    })
    expect(planSync({ integrationBase: 'proj/up', defaultBranch: 'main', upstream: isMerged, upstreamPr: pr({ state: 'MERGED', baseRefName: 'main' }) }).newBase).toBe('')
  })
  it('upstream merged into a build below it: that build becomes the base', () => {
    expect(
      planSync({ integrationBase: 'proj/b', defaultBranch: 'main', upstream: isMerged, upstreamPr: pr({ state: 'MERGED', baseRefName: 'proj/a' }) }),
    ).toEqual({ case: 'upstream-merged', mergeFrom: 'proj/a', newBase: 'proj/a', retargetTo: 'proj/a', useUpstreamTip: true })
  })
})

describe('mergeKind', () => {
  it('up to date, fast-forward or a merge', () => {
    expect(mergeKind({ fromIsAncestorOfBranch: true, branchIsAncestorOfFrom: true })).toBe('up-to-date')
    expect(mergeKind({ fromIsAncestorOfBranch: false, branchIsAncestorOfFrom: true })).toBe('fast-forward')
    expect(mergeKind({ fromIsAncestorOfBranch: false, branchIsAncestorOfFrom: false })).toBe('merge')
  })
})

describe('parsing git', () => {
  it('reads --shortstat, null when empty', () => {
    expect(parseShortstat(' 3 files changed, 40 insertions(+), 2 deletions(-)\n')).toEqual({ files: 3, additions: 40, deletions: 2 })
    expect(parseShortstat(' 1 file changed, 1 insertion(+)')).toEqual({ files: 1, additions: 1, deletions: 0 })
    expect(parseShortstat(' 1 file changed, 5 deletions(-)')).toEqual({ files: 1, additions: 0, deletions: 5 })
    expect(parseShortstat('')).toBeNull()
  })
  it('reads merge-tree conflict output', () => {
    expect(parseMergeTreeConflict('0123456789012345678901234567890123456789\napp.txt\nb/c.ts\napp.txt\n')).toEqual(['app.txt', 'b/c.ts'])
  })
  it('names the merge', () => {
    expect(syncMergeMessage({ from: 'main', branch: 'proj/b', case: 'upstream-merged' })).toBe('Merge main into proj/b (upstream build merged)')
  })
})

describe('gh arguments', () => {
  it('builds the PR reads and writes', () => {
    expect(upstreamPrListArgs('proj/up')).toEqual(['pr', 'list', '--head', 'proj/up', '--state', 'all', '--json', 'number,state,url,headRefOid,baseRefName,mergedAt', '--limit', '10'])
    expect(rollupPrListArgs('proj/b')).toEqual(['pr', 'list', '--head', 'proj/b', '--state', 'open', '--json', 'number,url,baseRefName', '--limit', '1'])
    expect(rollupPrCreateArgs({ branch: 'proj/b', base: 'proj/up', title: 'T', body: 'B' })).toEqual([
      'pr', 'create', '--head', 'proj/b', '--base', 'proj/up', '--title', 'T', '--body', 'B',
    ])
    expect(retargetPrArgs(12, 'main')).toEqual(['pr', 'edit', '12', '--base', 'main'])
    expect(compareUrl('o/r', 'proj/up', 'proj/b')).toBe('https://github.com/o/r/compare/proj%2Fup...proj%2Fb?expand=1')
    expect(compareUrl(null, 'main', 'proj/b')).toBeNull()
  })
})

describe('stackCandidates', () => {
  const p = (id: string, over: Record<string, string> = {}) => ({
    id, key: id.toUpperCase(), title: id, mode: 'standard', repo: '~/r', integrationBranch: `proj/${id}`, integrationBase: '', ...over,
  })
  it("offers other builds' integration branches in the same codebase only", () => {
    const self = p('me')
    const list = [self, p('a'), p('b', { repo: '~/other' }), p('c', { mode: 'prreview' }), p('d', { integrationBranch: '' }), p('e', { integrationBase: 'proj/me' })]
    expect(stackCandidates(list, self).map((x) => x.id)).toEqual(['a'])
  })
})
