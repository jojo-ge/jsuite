export default defineEventHandler(async (event) => {
  const key = sanitizeReviewKey(getRouterParam(event, 'key'))
  const review = await readReview(key)
  if (!review) throw createError({ statusCode: 404, message: `No such review: ${key}` })
  return review
})
