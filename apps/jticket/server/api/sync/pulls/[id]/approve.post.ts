// Approve a pending pull: build this share's snapshot and stream it to the
// requester. The one human decision DOC-30 requires per pull.
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')!
  try {
    await useSyncServer().approve(id)
  } catch (error) {
    if (error instanceof PullAnswerError) {
      throw createError({ statusCode: error.statusCode, statusMessage: error.message })
    }
    throw error
  }
  return { ok: true }
})
