/**
 * The human's button for a triage review: turn triaged findings into tickets
 * on the review's own project. Body: { findingIds?: string[], projectKey?:
 * string } — `projectKey` only for a review that predates projects. Never a
 * new project; refused for consensus and agreement reviews, whose findings
 * are filed without a press. Human-only — no skill or session may call it.
 * See fileReviewTickets (server/utils/reviewActions.ts).
 */
export default defineEventHandler(async (event) =>
  fileReviewTickets(sanitizeReviewKey(getRouterParam(event, 'key')), (await readBody(event)) ?? {}),
)
