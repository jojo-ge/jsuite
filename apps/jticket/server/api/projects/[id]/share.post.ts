// Share a project with a peer, or re-arm its existing share (same project
// UUID, fresh room + 2-hour expiry — see shares.ts). Returns the record with
// the link to paste to the coworker; the secret rides the link's fragment.
// Sharing also arms the project itself — project.share gains the creator
// side, so parity minting and ownership partitioning take effect here, and
// entities that predate the share are stamped creator (TICK-302).
//
// Body: { sharedKey?: string,  // 1–4 chars; required on first share,
//                              // defaults to the existing key on re-share
//         peerName?: string,   // required while the project is unarmed,
//                              // refreshes the armed name otherwise
//         ttlMs?: number }     // test affordance — shorter windows only
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  const body = await readBody<{ sharedKey?: string; peerName?: string; ttlMs?: number }>(event).catch(() => undefined)

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
  // Unarmed covers both a first share and a share cut before arming existed —
  // either way the badge-and-partition side needs the coworker's name.
  const peerName = (body?.peerName ?? '').trim()
  if (!project.share && !peerName) {
    throw createError({ statusCode: 400, statusMessage: "your coworker's name is required" })
  }

  // The module refuses keys in use on this machine, attempts to rename an
  // existing share, and re-arming an imported one — all conflicts with state,
  // not malformed requests.
  let share
  try {
    const ttlMs = typeof body?.ttlMs === 'number' && body.ttlMs > 0 ? body.ttlMs : undefined
    share = createOrRearmShare(store, project.id, sharedKey, undefined, ttlMs)
  } catch (e) {
    throw createError({ statusCode: 409, statusMessage: e instanceof Error ? e.message : String(e) })
  }

  const tickets = store.tickets.filter((t) => t.projectId === project.id)
  const docs = store.docs.filter((d) => d.projectId === project.id)
  armCreatorShare(project, share.sharedKey, peerName, [...tickets, ...tickets.flatMap((t) => t.comments), ...docs])
  project.updatedAt = now()

  saveStore(store)

  // Register the room on the relay right away so the link is dialable the
  // moment it's pasted. Best effort — the presence loop re-ensures it every
  // tick, so a briefly unreachable relay doesn't fail the share.
  if (syncRelayUrl()) void ensureRelayRoom(syncRelayUrl(), share).catch(() => {})

  return { share: shareView(share, getRequestURL(event).origin) }
})
