// One file of the project's repo at a commit, highlighted line by line —
// what the Diff tab's gap expansion and full-file view read.
// ?oid=<head commit from GET …/diff>&path=<file> → { lines: string[] }
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  const store = loadStore()
  const project = store.projects.find((p) => p.id === id || p.key === id)
  if (!project) throw createError({ statusCode: 404, statusMessage: 'project not found' })
  const q = getQuery(event)
  const lines = await loadFileLines(resolveRepoDir(project.repo), String(q.oid ?? ''), String(q.path ?? ''))
  return { lines }
})
