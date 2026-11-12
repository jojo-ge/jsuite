// The Reviews board's Open PRs section, pure: the codebase's open GitHub PRs
// (GET /api/repos/prs — one GitHub search, a page at a time), the filters
// that make up that search, and each PR matched to the review project already
// made for it. Rendering is app/components/OpenPrList.vue; the paging state
// is app/composables/useOpenPrs.ts; tests in tests/prList.test.ts.

/** One open PR as the list shows it. */
export interface OpenPr {
  number: number
  title: string
  url: string
  author?: { login?: string; name?: string } | null
  headRefName: string
  baseRefName: string
  isDraft: boolean
  updatedAt: string
  additions?: number
  deletions?: number
  reviewDecision?: string | null
  /** Users (login) and teams (slug/name, no login) asked to review. */
  reviewRequests?: { login?: string; slug?: string; name?: string }[]
}

/**
 * The filters GitHub applies — each is part of the search, so the pages and
 * the total are of exactly what is asked for. Drafts are left out unless
 * asked for: in a busy repo they are most of the open PRs.
 */
export interface PrQuery {
  hideDrafts: boolean
  onlyMine: boolean
  /** Review requested of me directly. */
  imReviewing: boolean
  /** Review requested of me or of a team I'm on. */
  teamReviewing: boolean
}

export const DEFAULT_PR_QUERY: PrQuery = { hideDrafts: true, onlyMine: false, imReviewing: false, teamReviewing: false }

export const PR_PAGE_SIZE = 25
export const PR_PAGE_MAX = 50

/** The GitHub search for a repo's open PRs under `q`, most recently updated first. */
export function prSearchQuery(slug: string, q: PrQuery): string {
  return [
    `repo:${slug}`,
    'is:pr',
    'is:open',
    q.hideDrafts ? 'draft:false' : '',
    q.onlyMine ? 'author:@me' : '',
    // "me or my teams" already covers "me", so the wider one wins.
    q.teamReviewing ? 'review-requested:@me' : q.imReviewing ? 'user-review-requested:@me' : '',
    'sort:updated-desc',
  ].filter(Boolean).join(' ')
}

/** `q` as GET /api/repos/prs takes it: drafts=1, mine=1, reviewing=me|team. */
export function prQueryParams(q: PrQuery): Record<string, string> {
  return {
    ...(q.hideDrafts ? {} : { drafts: '1' }),
    ...(q.onlyMine ? { mine: '1' } : {}),
    ...(q.teamReviewing ? { reviewing: 'team' } : q.imReviewing ? { reviewing: 'me' } : {}),
  }
}

const on = (v: unknown) => v === true || v === 1 || v === '1' || v === 'true'

/** The reverse of prQueryParams — what the route reads its query string into. */
export function parsePrQuery(params: Record<string, unknown>): PrQuery {
  return {
    hideDrafts: !on(params.drafts),
    onlyMine: on(params.mine),
    imReviewing: params.reviewing === 'me',
    teamReviewing: params.reviewing === 'team',
  }
}

/**
 * Loaded pages as one list. A PR that moved between two fetches (it was
 * updated, so it climbed) can sit on two pages: the first sighting wins.
 */
export function mergePrPages(pages: OpenPr[][]): OpenPr[] {
  const seen = new Set<number>()
  const out: OpenPr[] = []
  for (const pr of pages.flat()) {
    if (seen.has(pr.number)) continue
    seen.add(pr.number)
    out.push(pr)
  }
  return out
}

/** The author chips narrow what is loaded; an empty selection is everyone. */
export function filterByAuthors(prs: OpenPr[], authors: string[]): OpenPr[] {
  return authors.length ? prs.filter((pr) => authors.includes(pr.author?.login ?? '')) : prs
}

export interface AuthorChip {
  login: string
  name?: string
  count: number
}

/** One chip per author in `prs`, busiest first, then alphabetical. */
export function authorChips(prs: OpenPr[]): AuthorChip[] {
  const by = new Map<string, AuthorChip>()
  for (const pr of prs) {
    const login = pr.author?.login
    if (!login) continue
    const seen = by.get(login)
    if (seen) seen.count++
    else by.set(login, { login, name: pr.author?.name, count: 1 })
  }
  return [...by.values()].sort((a, b) => b.count - a.count || a.login.localeCompare(b.login))
}

/**
 * The PR review project for each PR number — the newest when there are
 * several. `projects` are the codebase's review projects, so a number is
 * unambiguous.
 */
export function projectsByPr<P extends { createdAt: string; prReview?: { pr: { number: number } } | null }>(projects: P[]): Map<number, P> {
  const out = new Map<number, P>()
  for (const p of projects) {
    const n = p.prReview?.pr.number
    if (!n) continue
    const seen = out.get(n)
    if (!seen || p.createdAt > seen.createdAt) out.set(n, p)
  }
  return out
}

export type VerdictColor = 'success' | 'warning' | 'error'

const VERDICT: Record<string, { label: string; color: VerdictColor }> = {
  approve: { label: 'recommends approval', color: 'success' },
  'approve-with-nits': { label: 'approvable with nits', color: 'success' },
  'request-changes': { label: 'changes needed', color: 'error' },
  'needs-discussion': { label: 'needs discussion', color: 'warning' },
}

/** The badge a review verdict shows as; null for no verdict. */
export function verdictBadge(v: string): { label: string; color: VerdictColor } | null {
  return v ? (VERDICT[v] ?? { label: v, color: 'warning' }) : null
}
