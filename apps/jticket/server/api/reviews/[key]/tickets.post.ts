/**
 * The human's button: turn triaged findings into jTicket tickets. Body:
 * { findingIds?: string[], projectKey?: string }. Human-only — no skill or
 * session may call it. See fileReviewTickets (server/utils/reviewActions.ts).
 */
export default defineEventHandler(async (event) =>
  fileReviewTickets(sanitizeReviewKey(getRouterParam(event, 'key')), (await readBody(event)) ?? {}),
)
