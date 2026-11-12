// A jTicket project's reviews. The review engine (jReview's, run inside
// jTicket since TICK-942 — reviewStore.ts, reviewActions.ts) answers
// in-process: the auto loop asks it for a consensus review of each loop's
// changes and reads it until the consensus session has filed its tickets, and
// the project page's Review tab starts reviews that belong to the project,
// follows them, and adds their findings to it as tickets. Every review belongs
// to a project (app/utils/reviewFindings.ts) — these are how a project's
// routes reach only its own.
import type { Review } from '../../app/utils/reviewTypes'
import { readReview, sanitizeReviewKey } from './reviewStore'

/**
 * Whether a review is this project's: its Review tab started it, its auto loop
 * asked for it, or (a review that predates projects) its findings were filed
 * here.
 */
export function reviewBelongsTo(review: Pick<Review, 'project' | 'consensus' | 'tickets'>, projectKey: string): boolean {
  return review.project === projectKey || review.consensus?.projectKey === projectKey || review.tickets?.projectKey === projectKey
}

/** Every project key a review names as its home. */
export function reviewHomes(review: Pick<Review, 'project' | 'consensus' | 'tickets'>): string[] {
  return [review.project, review.consensus?.projectKey, review.tickets?.projectKey].filter((k): k is string => !!k)
}

/** A review that predates projects and was never filed anywhere: it names no home at all. */
export const reviewIsHomeless = (review: Pick<Review, 'project' | 'consensus' | 'tickets'>): boolean => !reviewHomes(review).length

/**
 * Whether no project's Review tab shows this review: it is homeless, or every
 * project it names has been deleted. `live` is the store's project keys. The
 * Reviews board lists these, since nothing else links to them.
 */
export function reviewIsOrphaned(review: Pick<Review, 'project' | 'consensus' | 'tickets'>, live: ReadonlySet<string>): boolean {
  return !reviewHomes(review).some((k) => live.has(k))
}

/** One of this project's reviews, or a 404 — the Review tab's routes never reach another project's. */
export async function projectReview(projectKey: string, reviewKey: string): Promise<Review> {
  const review = await readReview(sanitizeReviewKey(reviewKey))
  if (!review) throw createError({ statusCode: 404, statusMessage: `No such review: ${reviewKey}` })
  if (!reviewBelongsTo(review, projectKey)) {
    throw createError({ statusCode: 404, statusMessage: `review ${reviewKey} is not one of ${projectKey}'s` })
  }
  return review
}

/**
 * projectReview, except that a homeless review passes too — filing its
 * findings on this project is what gives it a home (fileReviewTickets records
 * `tickets.projectKey`, and from then on it is this project's alone).
 */
export async function projectOrHomelessReview(projectKey: string, reviewKey: string): Promise<Review> {
  const review = await readReview(sanitizeReviewKey(reviewKey))
  if (review && reviewIsHomeless(review)) return review
  return projectReview(projectKey, reviewKey)
}
