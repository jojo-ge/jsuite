import { describe, expect, it } from 'vitest'
import { authorChips, filterPrs, filterPrsExceptAuthor, NO_FILTERS, projectsByPr, verdictBadge, type OpenPr } from '../app/utils/prList'

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

describe('filterPrs', () => {
  it('keeps everything with no filters', () => {
    expect(nums(filterPrs(prs, NO_FILTERS, 'me'))).toEqual([1, 2, 3, 4, 5])
  })
  it('hides drafts', () => {
    expect(nums(filterPrs(prs, { ...NO_FILTERS, hideDrafts: true }, 'me'))).toEqual([2, 3, 4, 5])
  })
  it('only mine needs a viewer', () => {
    expect(nums(filterPrs(prs, { ...NO_FILTERS, onlyMine: true }, 'me'))).toEqual([2])
    expect(nums(filterPrs(prs, { ...NO_FILTERS, onlyMine: true }, ''))).toEqual([])
  })
  it("i'm reviewing and team reviewing each narrow, and widen each other", () => {
    expect(nums(filterPrs(prs, { ...NO_FILTERS, imReviewing: true }, 'me'))).toEqual([3])
    expect(nums(filterPrs(prs, { ...NO_FILTERS, teamReviewing: true }, 'me'))).toEqual([4])
    expect(nums(filterPrs(prs, { ...NO_FILTERS, imReviewing: true, teamReviewing: true }, 'me'))).toEqual([3, 4])
  })
  it('filters by author, on top of the rest', () => {
    expect(nums(filterPrs(prs, { ...NO_FILTERS, authors: ['bob'] }, 'me'))).toEqual([4, 5])
    expect(nums(filterPrs(prs, { ...NO_FILTERS, authors: ['bob'], teamReviewing: true }, 'me'))).toEqual([4])
    expect(nums(filterPrsExceptAuthor(prs, { ...NO_FILTERS, authors: ['bob'] }, 'me'))).toHaveLength(5)
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
