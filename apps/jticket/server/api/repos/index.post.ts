// Remember a repo: validate the path is a real clone, resolve its slug and
// default branch, and add (or refresh) it in the remembered list.
//
// This is the "I'm using this repo" call — the project form makes it when you
// browse to, pick, or finish typing a path. Rejects anything that isn't a git
// worktree, so the list can't fill up with typos.
export default defineEventHandler(async (event) => {
  const body = await readBody<{ path?: string }>(event)
  const probe = await probeRepo(String(body?.path ?? ''))
  if (!probe.ok) throw createError({ statusCode: 400, statusMessage: `${probe.error}: ${probe.path}` })

  const store = loadStore()
  rememberRepo(store, { path: probe.path, slug: probe.slug ?? '', defaultBranch: probe.defaultBranch })
  saveStore(store)

  return { path: probe.path, slug: probe.slug, defaultBranch: probe.defaultBranch }
})
