import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { deleteDoc, listDocs, readDoc, readDocNotes, writeDoc, writeDocNotes } from '@jsuite/documents/store'
import { mediaPath, notesMediaPath } from '@jsuite/documents/media'
import type { Project, Store } from './store'
import { loadStore, saveStore } from './store'
import type { Share } from './shares'
import type { ProjectShare } from './ownership'
import type { SyncChangeSummary, SyncPoolDocument, SyncSnapshot } from './sync'
import { applySyncSnapshot, buildSyncExport } from './sync'
import { ATTACHMENTS_DIR } from './attachments'

// The IO shell around the pure snapshot engine (sync.ts): load what the
// engine needs from the store, the document pool and the attachment dir, and
// perform the plan it returns. The serving side assembles, the pulling side
// applies; neither touches the network — that's the serve/pull managers' job.

/** Build the full snapshot this share serves, attachment and media bytes inlined. */
export async function assembleSyncSnapshot(store: Store, share: Share, exportedAt: string): Promise<SyncSnapshot> {
  const project = store.projects.find((p) => p.id === share.projectId)
  if (!project) throw new Error('the shared project no longer exists')
  // TICK-302 arms project.share at share time on the creator; until every
  // share record has an armed project, derive the export side from the record.
  const armed: Project = project.share
    ? project
    : { ...project, share: { key: share.sharedKey, side: share.side, peerName: '' } satisfies ProjectShare }

  const docs = store.docs.filter((d) => d.projectId === project.id)
  const documents = new Map<string, SyncPoolDocument>()
  for (const d of docs) {
    if (!d.documentKey || documents.has(d.documentKey)) continue
    const document = await readDoc(d.documentKey)
    documents.set(d.documentKey, { document, documentNotes: document ? await readDocNotes(d.documentKey) : null })
  }

  const { snapshot, attachmentNames, mediaRefs } = buildSyncExport({
    project: armed,
    tickets: store.tickets.filter((t) => t.projectId === project.id),
    docs,
    documents,
    exportedAt,
  })
  for (const name of attachmentNames) {
    const p = join(ATTACHMENTS_DIR, name)
    if (existsSync(p)) snapshot.attachments.push({ name, base64: readFileSync(p).toString('base64') })
  }
  for (const ref of mediaRefs) {
    const p = ref.notes ? notesMediaPath(ref.docKey, ref.name) : mediaPath(ref.docKey, ref.name)
    if (existsSync(p)) snapshot.media.push({ ...ref, base64: readFileSync(p).toString('base64') })
  }
  return snapshot
}

/**
 * Apply one incoming snapshot to the local shared project: run the pure
 * engine over freshly-loaded state, then perform its IO plan — attachment
 * and media bytes, pool bodies, absence-deletions — and persist the
 * replacement store. Returns the pull's change summary.
 */
export async function performSyncApply(
  projectId: string,
  snapshot: SyncSnapshot,
): Promise<{ summary: SyncChangeSummary; dropped: string[] }> {
  const store = loadStore()
  const project = store.projects.find((p) => p.id === projectId)
  if (!project) throw new Error('project not found')

  // The engine diffs incoming bodies against the pool by final key; a full
  // map is a safe superset (a miss only means an extra idempotent write).
  const localDocuments = new Map<string, SyncPoolDocument>()
  const existingDocumentKeys: string[] = []
  for (const meta of await listDocs()) {
    existingDocumentKeys.push(meta.key)
    const document = await readDoc(meta.key)
    localDocuments.set(meta.key, { document, documentNotes: document ? await readDocNotes(meta.key) : null })
  }

  const result = applySyncSnapshot({
    project,
    tickets: store.tickets.filter((t) => t.projectId === project.id),
    docs: store.docs.filter((d) => d.projectId === project.id),
    counters: { ticket: store.counters.ticket, doc: store.counters.doc },
    takenTicketKeys: store.tickets.map((t) => t.key),
    takenDocKeys: store.docs.map((d) => d.key),
    existingDocumentKeys,
    localDocuments,
    localAttachments: {
      get(name) {
        const p = join(ATTACHMENTS_DIR, name)
        return existsSync(p) ? readFileSync(p).toString('base64') : undefined
      },
    },
    snapshot,
  })

  // The IO plan, same order as the bundle importer: bytes first, then pool
  // bodies, then deletions — so a doc never points at media that isn't there.
  if (result.attachmentWrites.length) mkdirSync(ATTACHMENTS_DIR, { recursive: true })
  for (const att of result.attachmentWrites) {
    const buf = Buffer.from(att.base64, 'base64')
    if (!buf.length) continue
    const p = join(ATTACHMENTS_DIR, att.name)
    if (!existsSync(p) || !readFileSync(p).equals(buf)) writeFileSync(p, buf)
  }
  for (const m of result.mediaWrites) {
    const buf = Buffer.from(m.base64, 'base64')
    if (!buf.length) continue
    const p = m.notes ? notesMediaPath(m.docKey, m.name) : mediaPath(m.docKey, m.name)
    if (existsSync(p) && readFileSync(p).equals(buf)) continue
    mkdirSync(dirname(p), { recursive: true })
    writeFileSync(p, buf)
  }
  for (const w of result.documentWrites) {
    await writeDoc(w.key, w.document)
    if (w.documentNotes) await writeDocNotes(w.key, w.documentNotes)
  }
  for (const key of result.documentDeletes) await deleteDoc(key)

  const idx = store.projects.findIndex((p) => p.id === project.id)
  store.projects[idx] = result.project
  store.tickets = [...store.tickets.filter((t) => t.projectId !== project.id), ...result.tickets]
  store.docs = [...store.docs.filter((d) => d.projectId !== project.id), ...result.docs]
  store.counters.ticket = result.counters.ticket
  store.counters.doc = result.counters.doc
  saveStore(store)

  return { summary: result.summary, dropped: result.dropped }
}
