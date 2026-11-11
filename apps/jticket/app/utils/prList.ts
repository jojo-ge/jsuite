// The Reviews board's Open PRs section, pure: the codebase's open GitHub PRs
// (GET /api/repos/prs, `gh pr list`) filtered the way jDiff's PR list did,
// and each matched to the PR review project already made for it.
// Rendering is app/components/OpenPrList.vue; tests in tests/prList.test.ts.

/** One open PR as `gh pr list --json` gives it (the fields the list asks for). */
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
  /** gh mixes users (login) and teams (slug/name, no login). */
  reviewRequests?: { login?: string; slug?: string; name?: string }[]
}

export interface PrFilters {
  hideDrafts: boolean
  onlyMine: boolean
  imReviewing: boolean
  teamReviewing: boolean
  /** Author logins; empty means everyone. */
  authors: string[]
}

export const NO_FILTERS: PrFilters = { hideDrafts: false, onlyMine: false, imReviewing: false, teamReviewing: false, authors: [] }

export const reviewRequestedOf = (pr: OpenPr, viewer: string) =>
  !!viewer && (pr.reviewRequests ?? []).some((r) => r.login && r.login === viewer)

export const reviewRequestedOfTeam = (pr: OpenPr) =>
  (pr.reviewRequests ?? []).some((r) => !r.login && (r.slug || r.name))

/**
 * Every filter except the author one — the people chips are built from this,
 * so only authors you could actually select into a result get a chip. The two
 * reviewer filters widen each other: either alone narrows to it, both keep
 * PRs matching either.
 */
export function filterPrsExceptAuthor(prs: OpenPr[], f: PrFilters, viewer: string): OpenPr[] {
  return prs.filter((pr) =>
    (!f.hideDrafts || !pr.isDraft)
    && (!f.onlyMine || (!!viewer && pr.author?.login === viewer))
    && (!(f.imReviewing || f.teamReviewing)
      || (f.imReviewing && reviewRequestedOf(pr, viewer))
      || (f.teamReviewing && reviewRequestedOfTeam(pr))),
  )
}

export function filterPrs(prs: OpenPr[], f: PrFilters, viewer: string): OpenPr[] {
  return filterPrsExceptAuthor(prs, f, viewer).filter((pr) => !f.authors.length || f.authors.includes(pr.author?.login ?? ''))
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
