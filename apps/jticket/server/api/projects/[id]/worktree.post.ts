// Give the project a checkout of its integration branch: a git worktree under
// the repo's .worktrees/, claimed as a fleet slot and booted where the repo
// ships a launcher that can (server/utils/worktrees.ts).
//
// The point is not the directory, it's what the directory then does for free:
// every local PR merge moves the integration branch, and squashMergePr
// fast-forwards the clean checkout that has it out (localPrs.ts). So the
// project's worktree tracks the project's work with no syncing step at all.
//
// Minutes of work hide behind this call, so it returns as soon as the job is
// recorded and the job reports by writing the project — which reaches open
// boards over /api/stream. Re-POSTing is how you retry a failed step.
//
// Body: { slug?: string, boot?: boolean }
//   slug — registry/directory name, default 'proj-8-hydra-asset-library'
//   boot — boot the slot's stack once claimed (default true)
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  const body = await readBody<{ slug?: string; boot?: boolean }>(event).catch(() => ({}) as { slug?: string; boot?: boolean })
  const store = loadStore()
  const project = store.projects.find((p) => p.id === id || p.key === id)
  if (!project) throw createError({ statusCode: 404, statusMessage: 'project not found' })

  const path = resolveRepoDir(project.repo)
  const branch = project.integrationBranch.trim()
  if (!branch) {
    throw createError({
      statusCode: 400,
      statusMessage: `${project.key} has no integration branch — cut one first, the worktree is a checkout of it`,
    })
  }
  if (!(await localBranchExists(path, branch))) {
    throw createError({ statusCode: 400, statusMessage: `integration branch not in this clone: ${branch}` })
  }

  // A job already walking the steps owns the record — don't start a second.
  if (isJobRunning(project.id)) return { worktree: project.worktree, started: false }

  const boot = body?.boot !== false
  const { worktree, start } = beginWorktree(project, path, branch, { slug: body?.slug, boot })
  saveStore(store)
  start()

  return {
    worktree,
    started: true,
    // Without a launcher the checkout is the whole story — the UI says so
    // rather than promising a slot that will never arrive.
    fleet: !!fleetLauncher(path),
    boot,
  }
})
