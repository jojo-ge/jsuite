// Confirm an import: create the local shared project from a link's fragment
// and record the share so later pulls know the room and the peer (spec
// DOC-30). The project is armed with the blob's side — the recipient's — so
// ownership partitioning and parity minting (importer = even ticket numbers)
// take effect immediately. Re-importing a re-armed link of a share this
// machine already holds updates the record's room and expiry in place and
// lands on the same project.
//
// Body: { fragment: string, peerName?: string }  // peerName required on
//                                                // first import
export default defineEventHandler(async (event) => {
  const body = await readBody<{ fragment?: string; peerName?: string }>(event).catch(() => undefined)
  const store = loadStore()
  const blob = readImportFragment(store, body?.fragment)
  const peerName = (body?.peerName ?? '').trim()

  const existingProject = importedProjectOf(store, blob)
  if (existingProject) {
    recordImportedShare(store, blob, existingProject.id)
    if (peerName && existingProject.share) existingProject.share.peerName = peerName
    existingProject.updatedAt = now()
    saveStore(store)
    return { project: existingProject, rearmed: true }
  }

  if (!peerName) {
    throw createError({ statusCode: 400, statusMessage: "your coworker's name is required" })
  }
  const ts = now()
  const project: Project = {
    id: newId('proj'),
    key: nextKey(store, 'project'),
    // A placeholder title — the real one is the creator's metadata and arrives
    // with the first pull.
    title: `${blob.sharedKey} — shared by ${peerName}`,
    description: '',
    mode: 'standard',
    repo: '',
    integrationBranch: '',
    starred: false,
    share: { key: blob.sharedKey, side: blob.side, peerName },
    createdAt: ts,
    updatedAt: ts,
  }
  store.projects.push(project)
  // Also adopts a record whose local project was deleted — projectId is
  // authoritative on every call.
  recordImportedShare(store, blob, project.id, ts)
  saveStore(store)
  setResponseStatus(event, 201)
  return { project, rearmed: false }
})
