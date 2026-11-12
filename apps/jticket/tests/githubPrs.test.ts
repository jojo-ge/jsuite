import { beforeEach, describe, expect, it, vi } from 'vitest'

// The GitHub PR reads (server/utils/github.ts) against a stubbed `gh`: the
// paged search the Reviews board lists from, and the light whole-repo list a
// project's PRs are matched from. Both sit behind ghCache.

type Call = { cmd: string; args: string[] }
const calls: Call[] = []
let respond: (call: Call) => string = () => '{}'

vi.mock('node:child_process', () => ({
  execFile: (cmd: string, args: string[], _opts: unknown, cb: (err: unknown, out?: { stdout: string }) => void) => {
    const call = { cmd, args }
    calls.push(call)
    try {
      cb(null, { stdout: respond(call) })
    } catch (err) {
      cb(err)
    }
  },
}))
;(globalThis as any).createError ??= (o: { statusCode: number; statusMessage: string }) =>
  Object.assign(new Error(o.statusMessage), o)

const { listOpenPrs, prDiffStats, searchOpenPrs } = await import('../server/utils/github')
const { DEFAULT_PR_QUERY } = await import('../app/utils/prList')

const field = (call: Call, name: string) => call.args.find((a) => a.startsWith(`${name}=`))?.slice(name.length + 1)
const isGraphql = (c: Call) => c.args[0] === 'api' && c.args[1] === 'graphql'
const searches = () => calls.filter((c) => isGraphql(c) && field(c, 'q'))

const node = (number: number, over: Record<string, unknown> = {}) => ({
  number,
  title: `PR ${number}`,
  url: `https://github.com/o/r/pull/${number}`,
  isDraft: false,
  updatedAt: '2026-11-11T10:00:00Z',
  additions: 10,
  deletions: 2,
  reviewDecision: 'REVIEW_REQUIRED',
  headRefName: `b${number}`,
  baseRefName: 'main',
  author: { login: 'ann', name: 'Ann' },
  reviewRequests: { nodes: [{ requestedReviewer: { login: 'me' } }, { requestedReviewer: { slug: 'core', name: 'Core' } }, { requestedReviewer: null }] },
  ...over,
})

function gh(pages: Record<string, { nodes: unknown[]; next?: string; total?: number }>) {
  respond = (call) => {
    if (call.cmd === 'gh' && call.args[0] === 'repo') return JSON.stringify({ nameWithOwner: 'o/r', defaultBranchRef: { name: 'main' } })
    if (isGraphql(call) && field(call, 'q')) {
      const page = pages[field(call, 'after') ?? '']!
      return JSON.stringify({
        data: {
          viewer: { login: 'me' },
          search: { issueCount: page.total ?? page.nodes.length, pageInfo: { hasNextPage: !!page.next, endCursor: page.next ?? null }, nodes: page.nodes },
        },
      })
    }
    throw new Error(`unexpected command: ${call.cmd} ${call.args.join(' ')}`)
  }
}

let n = 0
let repo = ''
beforeEach(() => {
  calls.length = 0
  repo = `/repo-${++n}` // a fresh repo per test: the cache is module state
})

describe('searchOpenPrs', () => {
  it('asks GitHub for one page of non-draft PRs and maps it', async () => {
    gh({ '': { nodes: [node(7), {}], next: 'Y3Vyc29yOjI1', total: 28 } })
    const page = await searchOpenPrs(repo, DEFAULT_PR_QUERY)

    const [call] = searches()
    expect(field(call!, 'q')).toBe('repo:o/r is:pr is:open draft:false sort:updated-desc')
    expect(field(call!, 'n')).toBe('25')
    expect(field(call!, 'after')).toBeUndefined()
    expect(page.refreshing).toBe(false)
    expect(page.value).toMatchObject({ total: 28, nextCursor: 'Y3Vyc29yOjI1', viewer: 'me' })
    // The empty node (a search hit that isn't a PR) is dropped.
    expect(page.value.prs).toEqual([
      {
        number: 7,
        title: 'PR 7',
        url: 'https://github.com/o/r/pull/7',
        author: { login: 'ann', name: 'Ann' },
        headRefName: 'b7',
        baseRefName: 'main',
        isDraft: false,
        updatedAt: '2026-11-11T10:00:00Z',
        additions: 10,
        deletions: 2,
        reviewDecision: 'REVIEW_REQUIRED',
        reviewRequests: [{ login: 'me' }, { slug: 'core', name: 'Core' }],
      },
    ])
  })

  it('the filters and the cursor go to GitHub; the page size is capped', async () => {
    gh({ abc: { nodes: [node(1)] } })
    const page = await searchOpenPrs(repo, { hideDrafts: false, onlyMine: true, imReviewing: false, teamReviewing: true }, { cursor: 'abc', limit: 500 })

    const [call] = searches()
    expect(field(call!, 'q')).toBe('repo:o/r is:pr is:open author:@me review-requested:@me sort:updated-desc')
    expect(field(call!, 'after')).toBe('abc')
    expect(field(call!, 'n')).toBe('50')
    expect(page.value.nextCursor).toBeNull()
  })

  it('a page is held: asking again makes no call, and each search and page has its own', async () => {
    gh({ '': { nodes: [node(1)], next: 'abc' }, abc: { nodes: [node(2)] } })
    await searchOpenPrs(repo, DEFAULT_PR_QUERY)
    await searchOpenPrs(repo, DEFAULT_PR_QUERY)
    expect(searches()).toHaveLength(1)

    await searchOpenPrs(repo, DEFAULT_PR_QUERY, { cursor: 'abc' })
    await searchOpenPrs(repo, { ...DEFAULT_PR_QUERY, hideDrafts: false })
    expect(searches()).toHaveLength(3)
    // gh repo view answered once for all of it.
    expect(calls.filter((c) => c.args[0] === 'repo')).toHaveLength(1)
  })

  it('force on the first page reads fresh and drops the pages after it', async () => {
    gh({ '': { nodes: [node(1)], next: 'abc' }, abc: { nodes: [node(2)] } })
    await searchOpenPrs(repo, DEFAULT_PR_QUERY)
    await searchOpenPrs(repo, DEFAULT_PR_QUERY, { cursor: 'abc' })
    await searchOpenPrs(repo, DEFAULT_PR_QUERY, { force: true })
    expect(searches()).toHaveLength(3)
    await searchOpenPrs(repo, DEFAULT_PR_QUERY, { cursor: 'abc' })
    expect(searches()).toHaveLength(4)
  })

  it('refuses a cursor that is not cursor-shaped', async () => {
    gh({})
    await expect(searchOpenPrs(repo, DEFAULT_PR_QUERY, { cursor: 'a b; rm' })).rejects.toThrow('not a page cursor')
    expect(calls).toHaveLength(0)
  })
})

describe('listOpenPrs / prDiffStats', () => {
  it('the whole-repo list asks only for the cheap fields and is held', async () => {
    respond = () => JSON.stringify([{ number: 3, title: 'PROJ-1 x', headRefName: 'proj-1', baseRefName: 'main', isDraft: true, url: 'u', updatedAt: '' }])
    const first = await listOpenPrs(repo)
    await listOpenPrs(repo)
    expect(calls).toHaveLength(1)
    expect(first.value[0]!.number).toBe(3)
    const fields = calls[0]!.args[calls[0]!.args.indexOf('--json') + 1]!
    for (const slow of ['additions', 'deletions', 'reviewDecision', 'reviewRequests']) expect(fields).not.toContain(slow)

    await listOpenPrs(repo, true)
    expect(calls).toHaveLength(2)
  })

  it('diff stats are asked for the named PRs only, in one call', async () => {
    respond = () => JSON.stringify({ data: { repository: { p3: { additions: 5, deletions: 1 }, p9: null } } })
    const stats = await prDiffStats(repo, 'o/r', [9, 3, 3])
    expect(stats.value).toEqual({ 3: { additions: 5, deletions: 1 } })
    expect(calls).toHaveLength(1)
    expect(field(calls[0]!, 'query')).toContain('p3: pullRequest(number: 3)')
    expect(field(calls[0]!, 'query')).toContain('p9: pullRequest(number: 9)')
    expect(field(calls[0]!, 'owner')).toBe('o')
    expect(field(calls[0]!, 'name')).toBe('r')

    // Nothing to ask → no call.
    calls.length = 0
    expect((await prDiffStats(repo, 'o/r', [])).value).toEqual({})
    expect(calls).toHaveLength(0)
  })
})
