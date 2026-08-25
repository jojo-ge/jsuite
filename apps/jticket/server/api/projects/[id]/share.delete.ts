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

  // "Stop-sharing kills the room instantly" (DOC-30) — both directions; best
  // effort; the serving gate refuses regardless, this just cuts signaling too.
  if (syncRelayUrl()) {
    void killRelayRoom(syncRelayUrl(), share)
    if (share.reverseRoomId) {
      void killRelayRoom(syncRelayUrl(), { roomId: share.reverseRoomId, roomSecret: share.reverseRoomSecret })
    }
  }

  return { share: shareView(share, getRequestURL(event).origin) }
})
