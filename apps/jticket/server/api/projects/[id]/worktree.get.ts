// Where a project's integration branch stands against its codebase's worktree
// setup — what the Connect button on the GitHub panel reads.
//
//   guide  — the codebase's worktree guide: missing / ready / stale
//   state  — the branch's link, re-checked against `git worktree list` every
//            read: linked / broken (recorded, but git disagrees) /
//            unlinked-checked-out (already in a worktree — connect adopts it)
//            / unlinked / no-branch / no-repo
//   link   — the recorded link (path + the connecting agent's notes), if any
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  const store = loadStore()
  const project = store.projects.find((p) => p.id === id || p.key === id)
  if (!project) throw createError({ statusCode: 404, statusMessage: 'project not found' })

  const path = projectRepoPath(project)
  const branch = project.integrationBranch.trim()
  const repo = path ? findKnownRepo(store, path) : undefined
  const guide = repo?.worktreeGuide ?? null
  const guideInfo = path ? guideState(path, guide) : { state: 'missing' as const, changed: [] }
  const base = {
    repo: path,
    branch,
    guide: {
      ...guideInfo,
      updatedAt: guide?.updatedAt ?? '',
      verified: guide?.verified ?? false,
      root: guide?.root ?? '',
    },
  }
  if (!path) return { ...base, state: 'no-repo' as const, link: null, checkedOutAt: null }
  if (!branch) return { ...base, state: 'no-branch' as const, link: null, checkedOutAt: null }

  const link = repo?.worktreeLinks.find((l) => l.branch === branch) ?? null
  const entries = await listWorktrees(path)
  const { state, checkedOutAt } = linkState(link, entries, branch, entries[0]?.path ?? path)
  return { ...base, state, link, checkedOutAt }
})
