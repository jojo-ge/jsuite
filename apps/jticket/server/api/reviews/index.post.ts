/**
 * Start a review — see createReview (server/utils/reviewActions.ts) for the
 * body. A review belongs to a jTicket project: without `project` (or a
 * consensus review's `consensus.projectKey`) naming an existing one it is
 * refused (400). Returns { key, path: "/reviews/<key>" }.
 */
export default defineEventHandler(async (event) => createReview((await readBody(event)) ?? {}))
