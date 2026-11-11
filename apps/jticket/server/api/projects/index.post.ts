export default defineEventHandler(async (event) => {
  const body = await readBody<Partial<Project>>(event)
  if (!body?.title?.trim()) {
    throw createError({ statusCode: 400, statusMessage: 'title is required' })
  }
  // A PR review project is only ever made with its pull request attached
  // (POST /api/projects/pr-review) — one made here would have no prReview and
  // render a blank Review setup tab.
  if (coerceProjectMode(body.mode) === 'prreview') {
    throw createError({ statusCode: 400, statusMessage: 'PR review projects are made with POST /api/projects/pr-review {repo, pr}' })
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
