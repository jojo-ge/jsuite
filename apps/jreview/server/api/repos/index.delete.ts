/** Forget a codebase (?path=…) — drops it from jReview's history only. */
export default defineEventHandler(async (event) => {
  const path = String(getQuery(event).path ?? '')
  if (!path) throw createError({ statusCode: 400, message: 'missing ?path=' })
  await forgetReviewRepo(path)
  return { ok: true }
})
