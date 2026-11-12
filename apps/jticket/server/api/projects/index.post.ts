export default defineEventHandler(async (event) => {
  const body = await readBody<Partial<Project>>(event)
  // A review project made here (the create modal's Review type) has no pull
  // request yet: its page is the PR picker until one is attached (POST
  // /api/projects/:id/pr-review {pr}). It needs a repo, not a title — the PR
  // names it. POST /api/projects/pr-review {repo, pr} makes one with its PR
  // in a single call.
  if (coerceProjectMode(body?.mode) === 'prreview') {
    setResponseStatus(event, 201)
    return createUnattachedReviewProject({ repo: body.repo, title: body.title, description: body.description })
  }
  // A plan review project (the create modal's Plan review type) is made
  // pointed at its plan — `plan`, a plan project's key or id — in that plan's
  // codebase. The title is optional: left blank, the plan names it.
  if (coerceProjectMode(body?.mode) === 'planreview') {
    const store = loadStore()
    const plan = planProjectRef(store, (body as { plan?: unknown }).plan)
    const project = createPlanReviewProject(store, { plan, title: body.title, description: body.description })
    saveStore(store)
    setResponseStatus(event, 201)
    return project
  }
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
    mode: coerceProjectMode(body.mode),
    repo: body.repo?.trim() ?? '',
    integrationBranch: body.integrationBranch?.trim() ?? '',
    integrationBase: '',
    starred: body.starred === true,
    position: null,
    hidden: false,
    // Local-only until the share flow arms it — never set at creation.
    share: null,
    // Hand-off prompts start empty — every kind falls through to the global
    // defaults (and then the code defaults) until this project overrides one.
    prompts: cleanPromptOverrides(body.prompts),
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
