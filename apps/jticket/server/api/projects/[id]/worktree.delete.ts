// Tear the project's worktree down. With a fleet launcher that is `wt rm` —
// the stack stops, the slot's containers and volumes go, the checkout is
// removed — otherwise it's `git worktree remove`. The integration branch
// itself is never touched: this removes a place to run the work, not the work.
//
// Query: ?force=1  remove even with uncommitted changes in the checkout
//        ?forget=1 only drop jTicket's record, leave the checkout on disk
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  const query = getQuery(event)
  const force = !!query.force
  const forget = !!query.forget

  const store = loadStore()
  const project = store.projects.find((p) => p.id === id || p.key === id)
  if (!project) throw createError({ statusCode: 404, statusMessage: 'project not found' })
  const worktree = project.worktree
  if (!worktree) throw createError({ statusCode: 400, statusMessage: `${project.key} has no worktree` })
  if (isJobRunning(project.id)) {
    throw createError({ statusCode: 409, statusMessage: 'the worktree is still being set up — let it finish, then remove it' })
  }

  if (!forget) {
    const path = resolveRepoDir(project.repo)
    try {
      await removeWorktree(path, worktree.path, worktree.slug, { force })
    } catch (err: any) {
      const message = String(err?.stderr || err?.message || err).trim()
      throw createError({
        statusCode: 409,
        // The launcher refuses a dirty checkout by design; say how to mean it.
        statusMessage: `${message.slice(0, 400)}${/uncommitted|dirty/i.test(message) ? ' — re-run with ?force=1 to remove it anyway' : ''}`,
      })
    }
  }

  project.worktree = null
  project.updatedAt = now()
  saveStore(store)
  return { removed: !forget, forgotten: true, slug: worktree.slug }
})
