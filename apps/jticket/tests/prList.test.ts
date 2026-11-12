import { describe, expect, it } from 'vitest'
import {
  authorChips,
  DEFAULT_PR_QUERY,
  filterByAuthors,
  mergePrPages,
  parsePrQuery,
  projectsByPr,
  prQueryParams,
  prSearchQuery,
  verdictBadge,
  type OpenPr,
  type PrQuery,
} from '../app/utils/prList'

const pr = (number: number, over: Partial<OpenPr> = {}): OpenPr => ({
  number,
  title: `PR ${number}`,
  url: `https://github.com/o/r/pull/${number}`,
  author: { login: 'ann' },
  headRefName: `b${number}`,
  baseRefName: 'main',
  isDraft: false,
  updatedAt: '2026-11-11T10:00:00Z',
  reviewRequests: [],
  ...over,
})

const prs = [
  pr(1, { isDraft: true }),
  pr(2, { author: { login: 'me' } }),
  pr(3, { reviewRequests: [{ login: 'me' }] }),
  pr(4, { author: { login: 'bob' }, reviewRequests: [{ slug: 'core', name: 'Core' }] }),
  pr(5, { author: { login: 'bob' } }),
]
const nums = (list: OpenPr[]) => list.map((p) => p.number)
const q = (over: Partial<PrQuery> = {}): PrQuery => ({ ...DEFAULT_PR_QUERY, ...over })

describe('prSearchQuery', () => {
  it('leaves drafts out by default, newest update first', () => {
    expect(prSearchQuery('o/r', DEFAULT_PR_QUERY)).toBe('repo:o/r is:pr is:open draft:false sort:updated-desc')
  })
  it('includes drafts when asked', () => {
    expect(prSearchQuery('o/r', q({ hideDrafts: false }))).toBe('repo:o/r is:pr is:open sort:updated-desc')
  })
  it('only mine is the author qualifier', () => {
    expect(prSearchQuery('o/r', q({ onlyMine: true }))).toContain(' author:@me ')
  })
  it("i'm reviewing is a direct request; my team widens it to me or my teams", () => {
    expect(prSearchQuery('o/r', q({ imReviewing: true }))).toContain(' user-review-requested:@me ')
    expect(prSearchQuery('o/r', q({ teamReviewing: true }))).toContain(' review-requested:@me ')
    const both = prSearchQuery('o/r', q({ imReviewing: true, teamReviewing: true }))
    expect(both).toContain(' review-requested:@me ')
    expect(both).not.toContain('user-review-requested')
  })
})

describe('prQueryParams / parsePrQuery', () => {
  it('the default search sends nothing, and nothing parses back to it', () => {
    expect(prQueryParams(DEFAULT_PR_QUERY)).toEqual({})
    expect(parsePrQuery({})).toEqual(DEFAULT_PR_QUERY)
  })
  it('round-trips every filter', () => {
    for (const query of [q({ hideDrafts: false }), q({ onlyMine: true }), q({ imReviewing: true }), q({ hideDrafts: false, onlyMine: true, teamReviewing: true })]) {
      expect(parsePrQuery(prQueryParams(query))).toEqual(query)
    }
  })
  it('both reviewing filters travel as the wider one', () => {
    expect(prQueryParams(q({ imReviewing: true, teamReviewing: true }))).toEqual({ reviewing: 'team' })
  })
})

describe('mergePrPages', () => {
  it('joins pages in order and keeps the first sighting of a PR that moved', () => {
    expect(nums(mergePrPages([[pr(1), pr(2)], [pr(2, { title: 'later copy' }), pr(3)]]))).toEqual([1, 2, 3])
    expect(mergePrPages([[pr(2)], [pr(2, { title: 'later copy' })]])[0]!.title).toBe('PR 2')
    expect(mergePrPages([])).toEqual([])
  })
})

describe('filterByAuthors', () => {
  it('an empty selection is everyone', () => {
    expect(nums(filterByAuthors(prs, []))).toEqual([1, 2, 3, 4, 5])
  })
  it('keeps only the selected authors', () => {
    expect(nums(filterByAuthors(prs, ['bob']))).toEqual([4, 5])
    expect(nums(filterByAuthors(prs, ['bob', 'me']))).toEqual([2, 4, 5])
  })
})

describe('authorChips', () => {
  it('counts per author, busiest first then alphabetical', () => {
    expect(authorChips(prs).map((a) => [a.login, a.count])).toEqual([['ann', 2], ['bob', 2], ['me', 1]])
  })
})

describe('projectsByPr', () => {
  it('maps each PR number to its newest review project', () => {
    const map = projectsByPr([
      { key: 'PROJ-1', createdAt: '2026-11-01', prReview: { pr: { number: 3 } } },
      { key: 'PROJ-2', createdAt: '2026-11-05', prReview: { pr: { number: 3 } } },
      { key: 'PROJ-3', createdAt: '2026-11-02', prReview: { pr: { number: 4 } } },
      { key: 'PROJ-4', createdAt: '2026-11-02', prReview: null },
    ])
    expect(map.get(3)?.key).toBe('PROJ-2')
    expect(map.get(4)?.key).toBe('PROJ-3')
    expect(map.size).toBe(2)
  })
})

describe('verdictBadge', () => {
  it('labels known verdicts and passes unknown ones through', () => {
    expect(verdictBadge('approve')?.color).toBe('success')
    expect(verdictBadge('request-changes')?.label).toBe('changes needed')
    expect(verdictBadge('odd')).toEqual({ label: 'odd', color: 'warning' })
    expect(verdictBadge('')).toBeNull()
  })
})
