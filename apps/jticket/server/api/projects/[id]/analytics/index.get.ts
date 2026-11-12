// The project page's Analytics tab: the same rollup as /api/analytics over
// this project's rows only, with every ticket row included.
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  const store = loadStore()
  const project = findByRef(store.projects, id)
  if (!project) throw createError({ statusCode: 404, statusMessage: 'project not found' })
  const data = await buildAnalytics(store, { projectIds: new Set([project.id]) })
  return { project: project.key, generatedAt: data.generatedAt, ledger: data.ledger, ...rollup(data), tickets: data.tickets, orchestrations: data.orchestrations, jobs: data.jobs, heavyRuns: data.heavyRuns }
})
