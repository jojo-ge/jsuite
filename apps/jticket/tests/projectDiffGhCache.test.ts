import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The Diff tab's ?gh=<n> target (TICK-955): resolving it costs a `gh pr view`
// and a `git fetch`, so it's held briefly per (repo, PR). Reopening it inside
// the window makes no gh/git call; the reload button (force) goes fresh.

const ghPrInfo = vi.fn(async (_repo: string, n: number) => ({ number: n, title: `PR ${n}`, baseRefName: 'main' }))
const run = vi.fn(async () => '')

vi.mock('../server/utils/github', () => ({
  isSafeRef: (r: string) => /^[\w./-]+$/.test(r),
  localBranchExists: async () => true,
  repoContext: async () => ({ defaultBranch: 'main' }),
  run: (...args: unknown[]) => (run as any)(...args),
}))
vi.mock('../server/utils/prReview', () => ({
  ghPrInfo: (...args: unknown[]) => (ghPrInfo as any)(...args),
  prReviewBase: () => 'main',
}))
vi.mock('../server/utils/localPrs', () => ({ findPrRef: () => null }))

const { GH_TARGET_TTL_MS, resolveDiffTarget } = await import('../server/utils/projectDiff')

const store = { projects: [], tickets: [], prs: [] } as any
const project = { id: 'p1', key: 'PROJ-1', mode: 'standard', integrationBranch: 'one' } as any
let repo = 0

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  ghPrInfo.mockClear()
  run.mockClear()
  repo += 1 // a fresh repo per test, so the module's cache never carries over
})
afterEach(() => vi.useRealTimers())

const resolve = (n: number, force = false) => resolveDiffTarget(store, project, `/repo-${repo}`, { gh: n }, { force })

describe('GitHub PR diff target cache', () => {
  it('reopening within the window makes no gh or git call', async () => {
    const first = await resolve(7)
    expect(first).toMatchObject({ kind: 'gh', head: 'refs/remotes/jticket/pr-7', base: 'refs/remotes/origin/main' })
    expect(ghPrInfo).toHaveBeenCalledTimes(1)
    expect(run).toHaveBeenCalledTimes(1)

    vi.setSystemTime(Date.now() + GH_TARGET_TTL_MS - 1_000)
    expect(await resolve(7)).toEqual(first)
    expect(ghPrInfo).toHaveBeenCalledTimes(1)
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('the reload button (force) fetches fresh', async () => {
    await resolve(7)
    await resolve(7, true)
    expect(ghPrInfo).toHaveBeenCalledTimes(2)
    expect(run).toHaveBeenCalledTimes(2)
  })

  it('fetches again once the window has passed, and per PR', async () => {
    await resolve(7)
    await resolve(8)
    expect(ghPrInfo).toHaveBeenCalledTimes(2)
    vi.setSystemTime(Date.now() + GH_TARGET_TTL_MS + 1)
    await resolve(7)
    expect(ghPrInfo).toHaveBeenCalledTimes(3)
  })

  it('two loads at once share one fetch, and a failure is not kept', async () => {
    await Promise.all([resolve(9), resolve(9)])
    expect(run).toHaveBeenCalledTimes(1)

    ghPrInfo.mockRejectedValueOnce(new Error('gh: not found'))
    await expect(resolve(10)).rejects.toThrow('gh: not found')
    await resolve(10)
    expect(ghPrInfo).toHaveBeenCalledTimes(3)
  })
})
