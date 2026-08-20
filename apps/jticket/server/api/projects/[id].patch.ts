export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  const body = await readBody<Partial<Project>>(event)
  const store = loadStore()
  const project = store.projects.find((p) => p.id === id || p.key === id)
  if (!project) throw createError({ statusCode: 404, statusMessage: 'project not found' })

  if (body.title !== undefined) project.title = body.title.trim()
  if (body.description !== undefined) project.description = body.description.trim()
  if (body.mode !== undefined) project.mode = coerceProjectMode(body.mode)
  // The GitHub link. '' on either clears it; the branch is validated here so a
  // hand-set name can't smuggle a git flag into the branch endpoints.
  if (body.repo !== undefined) {
    project.repo = body.repo.trim()
    // Same as create: pointing a project at a repo remembers it.
    if (project.repo) rememberRepo(store, { path: expandHome(project.repo) })
  }
  if (body.integrationBranch !== undefined) {
    const branch = body.integrationBranch.trim()
    if (branch && !isSafeRef(branch)) {
      throw createError({ statusCode: 400, statusMessage: `not a usable branch name: ${branch}` })
    }
    project.integrationBranch = branch
  }
  project.updatedAt = now()

  saveStore(store)
  return project
})
