// Record that a project's integration branch is connected to a worktree — the
// last step of the 'worktree:connect' prompt. Body: { path, notes?, author? }.
//
// Checked against git, not taken on trust: `path` must be a worktree of the
// project's repo (not its main checkout) with the integration branch checked
// out. One link per branch; re-posting replaces it.
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  const body = await readBody<{ path?: string; notes?: string; author?: string }>(event)
  const store = loadStore()
  const project = store.projects.find((p) => p.id === id || p.key === id)
  if (!project) throw createError({ statusCode: 404, statusMessage: 'project not found' })

  const repoPath = resolveRepoDir(project.repo)
  const branch = project.integrationBranch.trim()
  if (!branch) throw createError({ statusCode: 400, statusMessage: `${project.key} has no integration branch` })
  const wanted = expandHome(String(body?.path ?? ''))
  if (!wanted) throw createError({ statusCode: 400, statusMessage: 'path is required — the worktree directory' })

  const entries = await listWorktrees(repoPath)
  const hit = entries.find((e) => samePath(e.path, wanted))
  if (!hit) {
    throw createError({ statusCode: 409, statusMessage: `${wanted} is not a worktree of ${repoPath} (git worktree list)` })
  }
  if (entries[0] && samePath(hit.path, entries[0].path)) {
    throw createError({ statusCode: 409, statusMessage: `${wanted} is the repo's own checkout — connect a separate worktree` })
  }
  if (hit.branch !== branch) {
    throw createError({
      statusCode: 409,
      statusMessage: `${wanted} has ${hit.branch || 'a detached HEAD'} checked out, not ${branch}`,
    })
  }

  if (!findKnownRepo(store, repoPath)) rememberRepo(store, { path: repoPath }, { touch: false })
  const repo = findKnownRepo(store, repoPath)!
  const link = {
    branch,
    path: hit.path,
    notes: String(body?.notes ?? '').trim().slice(0, LINK_NOTES_CAP),
    author: String(body?.author ?? '').trim().slice(0, 80),
    linkedAt: now(),
  }
  repo.worktreeLinks = [...repo.worktreeLinks.filter((l) => l.branch !== branch), link]
  saveStore(store)
  return { link, state: 'linked' as const }
})
