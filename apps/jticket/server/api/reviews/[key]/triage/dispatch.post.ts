/**
 * Re-dispatch the triage session — only while the review is `triaging`.
 * Returns the review. See retryTriage.
 */
export default defineEventHandler((event) => retryTriage(sanitizeReviewKey(getRouterParam(event, 'key'))))
