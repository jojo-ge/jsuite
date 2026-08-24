// Get-or-create a codebase's TODO project — the only place todo-mode projects
// are made. Idempotent: the first call for a repo creates the project (201,
// created: true), every later call returns the same one (200, created: false),
// so the client can fire it on every codebase selection and agents can call it
// before adding a todo without checking first.
export default defineEventHandler(async (event) => {
  const body = await readBody<{ repo?: string }>(event)
  const probe = await probeRepo(String(body?.repo ?? ''))
  if (!probe.ok) throw createError({ statusCode: 400, statusMessage: `${probe.error}: ${probe.path}` })

  const store = loadStore()
  const existing = findTodoProject(store, probe.path)
  if (existing) return { ...existing, created: false }

  const ts = now()
  const project: Project = {
    id: newId('proj'),
    key: nextKey(store, 'project'),
    title: 'TODO',
    description:
      "The codebase's running todo list — one human-written line per todo. " +
      "Exercise a todo with its Grill button: a jGrilling interview whose " +
      "decisions land back in the ticket's resolution. No branches, no PRs.",
    mode: 'todo',
    repo: probe.path,
    integrationBranch: '',
    // Never starred: /next is for dispatchable work, todos are grilled instead.
    starred: false,
    share: null,
    createdAt: ts,
    updatedAt: ts,
  }
  store.projects.push(project)
  rememberRepo(store, { path: probe.path, slug: probe.slug ?? '', defaultBranch: probe.defaultBranch })
  saveStore(store)
  setResponseStatus(event, 201)
  return { ...project, created: true }
})
