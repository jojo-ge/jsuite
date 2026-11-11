/**
 * Give up on one reviewer so triage can go ahead without it (refused for a
 * consensus review). Returns the review. See skipReviewer.
 */
export default defineEventHandler((event) =>
  skipReviewer(sanitizeReviewKey(getRouterParam(event, 'key')), Number(getRouterParam(event, 'n'))),
)
