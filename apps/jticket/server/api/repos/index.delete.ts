// Forget a repo (?path=…). Only drops it from the remembered list — projects
// pointing at it keep their repo, and nothing on disk is touched.
export default defineEventHandler((event) => {
  const path = String(getQuery(event).path ?? '').trim()
  if (!path) throw createError({ statusCode: 400, statusMessage: 'missing ?path=' })
  const store = loadStore()
  const forgotten = forgetRepo(store, path)
  if (forgotten) saveStore(store)
  return { forgotten }
})
