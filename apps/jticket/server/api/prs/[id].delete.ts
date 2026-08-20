// Remove a local PR record. The store only — no branch is touched; closing
// without merging is usually what you want instead (PATCH { status: 'closed' }).
export default defineEventHandler((event) => {
  const id = getRouterParam(event, 'id')
  const store = loadStore()
  const pr = findPrRef(store, id)
  if (!pr) throw createError({ statusCode: 404, statusMessage: 'PR not found' })
  store.prs = store.prs.filter((p) => p.id !== pr.id)
  saveStore(store)
  return { ok: true }
})
