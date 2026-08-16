export default defineEventHandler(async (event) => {
  const body = await readBody<Partial<Project>>(event)
  if (!body?.title?.trim()) {
    throw createError({ statusCode: 400, statusMessage: 'title is required' })
  }
  const store = loadStore()
  const ts = now()
  const project: Project = {
    id: newId('proj'),
    key: nextKey(store, 'project'),
    title: body.title.trim(),
    description: body.description?.trim() ?? '',
    mode: body.mode === 'wayfinder' ? 'wayfinder' : 'standard',
    repo: body.repo?.trim() ?? '',
    integrationBranch: body.integrationBranch?.trim() ?? '',
    createdAt: ts,
    updatedAt: ts,
  }
  store.projects.push(project)
  // Setting a repo is what puts it on the remembered list. No gh call here —
  // the slug gets filled in the first time the project's GitHub panel loads.
  if (project.repo) rememberRepo(store, { path: expandHome(project.repo) })
  saveStore(store)
  setResponseStatus(event, 201)
  return project
})
