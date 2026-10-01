// The Branches tab: where the project's integration branch stands against
// origin (what a push would send, what a pull would bring) and against the
// default branch. See server/utils/branchStatus.ts.
//
// ?fetch=1 refreshes origin's copy of both branches first (a network round
// trip — the tab does it on open and on ↻). Offline answers from the refs the
// clone already has, with `fetchFailed` set.
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  const store = loadStore()
  const project = store.projects.find((p) => p.id === id || p.key === id)
  if (!project) throw createError({ statusCode: 404, statusMessage: 'project not found' })

  const path = resolveRepoDir(project.repo)
  const branch = project.integrationBranch.trim()
  // The remembered default branch saves a `gh` round trip on every refresh.
  const defaultBranch = findKnownRepo(store, path)?.defaultBranch || (await repoContext(path)).defaultBranch
  if (!branch) return { repo: path, defaultBranch, fetchFailed: false, status: null }

  const fetchFailed = getQuery(event).fetch ? !(await fetchBranches(path, [branch, defaultBranch])) : false
  return { repo: path, defaultBranch, fetchFailed, status: await branchStatus(path, branch, defaultBranch) }
})
