// A jTicket project's reviews. The review engine (jReview's, run inside
// jTicket since TICK-942 — reviewStore.ts, reviewActions.ts) answers
// in-process: the auto loop asks it for a consensus review of each loop's
// changes and reads it until the consensus session has filed its tickets, and
// the project page's Review tab starts reviews that belong to the project,
// follows them, and adds their findings to it as tickets.
import type { Review } from '../../app/utils/reviewTypes'
import { readReview, sanitizeReviewKey } from './reviewStore'

/** Whether a review is this project's: its Review tab started it, or its auto loop asked for it. */
export function reviewBelongsTo(review: Pick<Review, 'project' | 'consensus'>, projectKey: string): boolean {
  return review.project === projectKey || review.consensus?.projectKey === projectKey
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
