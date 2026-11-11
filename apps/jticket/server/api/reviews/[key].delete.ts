/**
 * Forget a review, and remove the worktree jReview made for it (if any). Its
 * jExplain documents stay in the shared pool and any jTicket project it made
 * stays on the board — only the run record and the checkout go.
 */
export default defineEventHandler(async (event) => {
  const key = sanitizeReviewKey(getRouterParam(event, 'key'))
  const review = await readReview(key)
  if (review?.worktree) await removeReviewWorktree(review.repoPath, review.workdir)
  await deleteReview(key)
  return { ok: true }
})
