// Share a project with a peer, or re-arm its existing share (same project
// UUID, fresh room + 2-hour expiry — see shares.ts). Returns the record with
// the link to paste to the coworker; the secret rides the link's fragment.
//
// Body: { sharedKey?: string }  // 1–4 chars; required on first share,
//                               // defaults to the existing key on re-share
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  const body = await readBody<{ sharedKey?: string }>(event).catch(() => undefined)

  const store = loadStore()
  const project = store.projects.find((p) => p.id === id || p.key === id)
  if (!project) throw createError({ statusCode: 404, statusMessage: 'project not found' })

  const existing = findShare(store, project.id)
  const sharedKey = (body?.sharedKey ?? '').trim().toUpperCase() || existing?.sharedKey || ''
  if (!isValidSharedKey(sharedKey)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'shared key must be 1-4 characters — a letter, then letters or digits',
    })
  }

  // The module refuses keys in use on this machine and attempts to rename an
  // existing share — both are conflicts with state, not malformed requests.
  let share
  try {
    share = createOrRearmShare(store, project.id, sharedKey)
  } catch (e) {
    throw createError({ statusCode: 409, statusMessage: e instanceof Error ? e.message : String(e) })
  }
  saveStore(store)
  return { share: shareView(share, getRequestURL(event).origin) }
})
