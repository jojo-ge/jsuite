/**
 * (Re-)dispatch one reviewer — the retry after a failed herdr hand-off, or a
 * fresh session for one that stalled. Blocks until claude is up in its pane.
 * Returns the review. See retryReviewer.
 */
export default defineEventHandler((event) =>
  retryReviewer(sanitizeReviewKey(getRouterParam(event, 'key')), Number(getRouterParam(event, 'n'))),
)
