export default defineEventHandler((event) => {
  const id = getRouterParam(event, 'id')
  const store = loadStore()
  const doc = store.docs.find((d) => d.id === id || d.key === id)
  if (!doc) throw createError({ statusCode: 404, statusMessage: 'doc not found' })

  // Peer-owned docs only ever leave by sync (deletion by absence), never by a
  // local delete.
  const project = store.projects.find((p) => p.id === doc.projectId)
  const refused = peerWriteError(doc, project?.share)
  if (refused) throw createError({ statusCode: 403, statusMessage: refused })

  store.docs = store.docs.filter((d) => d.id !== doc.id)
  saveStore(store)
  return { ok: true }
})
