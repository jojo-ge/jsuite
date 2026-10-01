// jTicket's line to jReview — the auto loop asks it for a consensus review of
// each loop's changes and polls it until the consensus session has filed its
// tickets, and the project page's Review tab starts reviews that belong to the
// project, follows them, and adds their findings to it as tickets.
// Server-to-server; browser links use JREVIEW_PUBLIC.

const JREVIEW_API = process.env.JREVIEW_API_URL || 'http://localhost:43008'
export const JREVIEW_PUBLIC = process.env.JREVIEW_URL || 'https://jreview.local'

export async function jreviewFetch<T = any>(path: string, opts: any = {}): Promise<T> {
  try {
    return await $fetch<T>(`${JREVIEW_API}${path}`, { timeout: 10_000, ...opts })
  } catch (err: any) {
    const status = err?.statusCode ?? err?.response?.status
    if (status) {
      throw createError({
        statusCode: status,
        // jReview's routes set `message`; h3 fills statusMessage with a generic 'Server Error'.
        message: `jReview said ${status}: ${String(err?.data?.message ?? err?.data?.statusMessage ?? err?.message ?? '').slice(0, 300)}`,
      })
    }
    throw createError({
      statusCode: 503,
      message: 'jReview is not reachable on :43008 — run ./jsuite status, then ./jsuite start',
    })
  }
}

/** The slice of a jReview review the auto loop reads. */
export interface JreviewReview {
  key: string
  status: 'reviewing' | 'triaging' | 'triaged' | 'ticketed'
  tickets: { projectKey: string; ticketKeys: string[] } | null
}

/** A triaged finding, as jReview's triage session POSTed it. */
export interface JreviewFinding {
  id: string
  title: string
  severity: 'critical' | 'high' | 'medium' | 'low'
  category: string
  file?: string
  line?: number
  summary: string
  detail: string
  reviewers: number[]
  /** The ticket it became, once added. */
  ticketKey?: string
}

/** The whole review, as the Review tab renders it. */
export interface JreviewFull extends JreviewReview {
  title: string
  repoPath: string
  branch: string
  base: string
  pr: { number: number; title: string; url: string } | null
  worktree: boolean
  project?: string
  consensus?: { projectKey: string; loop?: number; considered?: number; kept?: number }
  reviewers: { n: number; docKey: string; status: 'queued' | 'running' | 'done' | 'failed' | 'skipped'; agent?: string; error?: string }[]
  triage: { docKey: string; status: 'waiting' | 'running' | 'done' | 'failed'; agent?: string; error?: string }
  findings: JreviewFinding[]
  createdAt: string
  updatedAt: string
}

/** Whether a review is this project's: its Review tab started it, or its auto loop asked for it. */
export function reviewBelongsTo(review: Pick<JreviewFull, 'project' | 'consensus'>, projectKey: string): boolean {
  return review.project === projectKey || review.consensus?.projectKey === projectKey
}

/** One of this project's reviews, or a 404 — the Review tab's routes never reach another project's. */
export async function projectReview(projectKey: string, reviewKey: string): Promise<JreviewFull> {
  const review = await jreviewFetch<JreviewFull>(`/api/reviews/${encodeURIComponent(reviewKey)}`)
  if (!reviewBelongsTo(review, projectKey)) {
    throw createError({ statusCode: 404, statusMessage: `review ${reviewKey} is not one of ${projectKey}'s` })
  }
  return review
}
