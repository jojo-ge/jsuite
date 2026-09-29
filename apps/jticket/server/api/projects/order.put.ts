// The projects page's drag-to-reorder: number a whole list in one write.
// Body { ids: string[] } — project ids or keys, top first. Each named project
// gets position = its index; projects not named keep theirs (the page sends
// one codebase's active list, so other codebases' orders are untouched).
// Machine-local view state, like starred — never on the sync wire.
export default defineEventHandler(async (event) => {
  const body = await readBody<{ ids?: unknown }>(event)
  if (!Array.isArray(body?.ids) || !body.ids.every((id) => typeof id === 'string')) {
    throw createError({ statusCode: 400, statusMessage: 'ids must be an array of project ids' })
  }
  const store = loadStore()
  const ids = body.ids as string[]
  const missing = ids.filter((ref) => !store.projects.some((p) => p.id === ref || p.key === ref))
  if (missing.length) throw createError({ statusCode: 404, statusMessage: `unknown project: ${missing.join(', ')}` })

  ids.forEach((ref, i) => {
    const project = store.projects.find((p) => p.id === ref || p.key === ref)!
    project.position = i
  })
  saveStore(store)
  return { ok: true }
})
