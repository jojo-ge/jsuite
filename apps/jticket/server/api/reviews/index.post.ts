/**
 * Start a review — see createReview (server/utils/reviewActions.ts) for the
 * body. Returns { key, path: "/reviews/<key>" }.
 */
export default defineEventHandler(async (event) => createReview((await readBody(event)) ?? {}))
