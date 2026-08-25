// Stop sharing a project. Revocation is immediate — serving refuses from this
// instant — but the record stays so a later re-share re-arms the same project
// UUID instead of minting a new shared identity.
export default defineEventHandler((event) => {
  const id = getRouterParam(event, 'id')
  const store = loadStore()
  const project = store.projects.find((p) => p.id === id || p.key === id)
  if (!project) throw createError({ statusCode: 404, statusMessage: 'project not found' })

  const share = revokeShare(store, project.id)
  if (!share) throw createError({ statusCode: 404, statusMessage: 'project is not shared' })
  saveStore(store)

  // "Stop-sharing kills the room instantly" (DOC-30). There is no room
  // registry to kill any more, so this side says so on the channel and leaves:
  // a peer waiting on us fails fast with the reason instead of timing out.
  // Best effort and never awaited — the serving gate above already refuses
  // regardless, this is only the courtesy note.
  if (syncServingEnabled()) {
    void useSyncServer().announceRevoked(share).catch(() => {})
  }

  return { share: shareView(share, getRequestURL(event).origin) }
})
