// Which jDiff review runs are live for this project's repo. Proxies jDiff's
// repo-wide /api/ai-jobs; jDiff being down (or the project having no repo)
// answers { available: false } rather than erroring — the panel must render
// either way.
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  const store = loadStore()
  const project = store.projects.find((p) => p.id === id || p.key === id)
  if (!project) throw createError({ statusCode: 404, statusMessage: 'project not found' })
  if (!project.repo.trim()) return { available: false, running: [] }

  try {
    const path = resolveRepoDir(project.repo)
    const res = await jdiffFetch<{ prs: Record<string, string[]>; jobs?: any[] }>(
      `/api/ai-jobs?repo=${encodeURIComponent(path)}`,
    )
    // Keys are jDiff storeKeys: a bare PR number, or "branch/<name>".
    return { available: true, running: Object.keys(res.prs ?? {}), jobs: res.jobs ?? [] }
  } catch {
    return { available: false, running: [] }
  }
})
