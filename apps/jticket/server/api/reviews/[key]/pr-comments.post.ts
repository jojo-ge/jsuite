/**
 * The human's "Post to PR" button. Body: { ticketKeys?: string[], body?: string }
 * — the finding tickets to post and the summary. Posts ONE GitHub
 * pull-request review with the human's gh auth — event COMMENT, always.
 * Human-only, like the ticket split: no skill or session may call it. See
 * postReviewToPr (server/utils/reviewActions.ts).
 */
export default defineEventHandler(async (event) =>
  postReviewToPr(sanitizeReviewKey(getRouterParam(event, 'key')), (await readBody(event)) ?? {}),
)
