export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  const body = await readBody<Partial<Project>>(event)
  const store = loadStore()
  const project = store.projects.find((p) => p.id === id || p.key === id)
  if (!project) throw createError({ statusCode: 404, statusMessage: 'project not found' })

  // On a shared project the title/description/mode belong to the link creator
  // (spec DOC-30). Machine-local fields — repo, integration branch, starred —
  // stay editable on both sides and never cross the wire.
  if (body.title !== undefined || body.description !== undefined || body.mode !== undefined) {
    const refused = projectMetadataError(project.share)
    if (refused) throw createError({ statusCode: 403, statusMessage: refused })
  }

  if (body.title !== undefined) project.title = body.title.trim()
  if (body.description !== undefined) project.description = body.description.trim()
  if (body.mode !== undefined) project.mode = coerceProjectMode(body.mode)
  if (body.starred !== undefined) project.starred = body.starred === true
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
  // Hand-off prompt overrides, merged per kind: send a kind to set it, send ''
  // to drop back to the global default. Machine-local like the repo link — no
  // creator-owned guard, and never on the sync wire.
  if (body.prompts !== undefined) {
    project.prompts = mergePromptOverrides(project.prompts, body.prompts)
  }
  project.updatedAt = now()

  saveStore(store)
  return project
})
