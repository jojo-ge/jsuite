export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  const body = await readBody<Partial<Project>>(event)
  const store = loadStore()
  const project = findByRef(store.projects, id)
  if (!project) throw createError({ statusCode: 404, statusMessage: 'project not found' })

  // On a shared project the title/description/mode belong to the link creator
  // (spec DOC-30). Machine-local fields — repo, integration branch, starred,
  // position, hidden — stay editable on both sides and never cross the wire.
  if (body.title !== undefined || body.description !== undefined || body.mode !== undefined) {
    const refused = projectMetadataError(project.share)
    if (refused) throw createError({ statusCode: 403, statusMessage: refused })
  }

  if (body.title !== undefined) project.title = body.title.trim()
  if (body.description !== undefined) project.description = body.description.trim()
  if (body.mode !== undefined) {
    // Nothing moves into or out of PR review mode: the mode and its prReview
    // record (the PR, the plan, the runs) come and go together.
    const mode = coerceProjectMode(body.mode)
    if (mode !== project.mode && (mode === 'prreview' || project.mode === 'prreview')) {
      throw createError({ statusCode: 400, statusMessage: 'a project cannot become or stop being a review project — make one with POST /api/projects/pr-review {repo, pr}, or POST /api/projects {mode: "prreview", repo} and pick its PR after' })
    }
    if (mode !== project.mode && (mode === 'planreview' || project.mode === 'planreview')) {
      throw createError({ statusCode: 400, statusMessage: 'a project cannot become or stop being a plan review project — make one with POST /api/projects {mode: "planreview", plan: PROJ-n}' })
    }
    project.mode = mode
  }
  if (body.starred !== undefined) project.starred = body.starred === true
  if (body.position !== undefined) {
    project.position = typeof body.position === 'number' && Number.isFinite(body.position) ? body.position : null
  }
  if (body.hidden !== undefined) {
    const unhiding = project.hidden && body.hidden !== true
    project.hidden = body.hidden === true
    // Unhiding brings a project back on top of the placed ones (below only
    // never-placed new projects) — that's usually why it was unhidden.
    if (unhiding && body.position === undefined) {
      const placed = store.projects.map((p) => p.position).filter((n): n is number => n !== null)
      project.position = placed.length ? Math.min(...placed) - 1 : null
    }
  }
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
    // A different branch (or none) forgets the old one's base — unless this
    // same PATCH names the new one's.
    if (branch !== project.integrationBranch && body.integrationBase === undefined) project.integrationBase = ''
    project.integrationBranch = branch
  }
  // The integration branch's base ('' = the default branch, else the build it
  // stacks on — app/utils/stacking.ts). Recorded, not acted on: nothing is
  // merged or retargeted here (Sync from upstream does that).
  if (body.integrationBase !== undefined) {
    const base = String(body.integrationBase ?? '').trim()
    if (base && !isSafeRef(base)) throw createError({ statusCode: 400, statusMessage: `not a usable base: ${base}` })
    if (base && base === project.integrationBranch) throw createError({ statusCode: 400, statusMessage: `a branch cannot be its own base: ${base}` })
    project.integrationBase = base
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
