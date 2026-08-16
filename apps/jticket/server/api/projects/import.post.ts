import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { extname, join } from 'node:path'
import type { Explainer } from '@jsuite/documents/store'

// Import a bundle produced by GET /api/projects/:id/export. Always creates a
// new project — fresh ids and keys minted on this tracker, titles, statuses,
// comments and timestamps preserved. Document bodies land in the shared
// document pool, charts in the chart pool, uploaded files on disk; anything
// whose key or name collides with different content gets a suffixed copy
// (byte-identical content is reused, and every reference — including the
// attachment refs on the project and its tickets — is rewritten to the new
// key/name).
export default defineEventHandler(async (event) => {
  const bundle = await readBody<
    ProjectBundle & { epics?: LegacyBundleEpic[]; docs?: LegacyBundleDoc[] }
  >(event)
  if (bundle?.format !== BUNDLE_FORMAT || !bundle.project?.title?.trim()) {
    throw createError({ statusCode: 400, statusMessage: 'not a jticket project bundle' })
  }
  const store = loadStore()
  const ts = now()

  // 1. Uploaded files — suffix names that collide with different bytes. The
  // bundle field is still called `attachments` (see BundleAttachment).
  const uploadRenames = new Map<string, string>()
  if (bundle.attachments?.length) mkdirSync(UPLOADS_DIR, { recursive: true })
  for (const att of bundle.attachments ?? []) {
    const name = safeUploadName(att.name)
    const buf = Buffer.from(String(att.base64 ?? ''), 'base64')
    if (!buf.length) continue
    const path = join(UPLOADS_DIR, name)
    if (!existsSync(path)) {
      writeFileSync(path, buf)
    } else if (!readFileSync(path).equals(buf)) {
      const renamed = uniqueUploadName(name)
      writeFileSync(join(UPLOADS_DIR, renamed), buf)
      uploadRenames.set(name, renamed)
    }
  }
  // Only the renamed files are rewritten, and each keeps whichever prefix the
  // markdown already used — a bundle authored before the rename stays on
  // /attachments/<name>, which the legacy redirect resolves.
  const fixUploads = (text: string): string =>
    uploadRenames.size
      ? text.replace(uploadRefPattern(), (whole, prefix: string, n: string) =>
          uploadRenames.has(n) ? `/${prefix}/${uploadRenames.get(n)}` : whole,
        )
      : text

  // 2. Charts — into the shared jChart pool, suffixing colliding keys.
  const chartRenames = new Map<string, string>()
  for (const entry of bundle.charts ?? []) {
    const key = sanitizeKey(entry?.key)
    if (!key || entry?.chart?.format !== 'j-chart') continue
    const existing = await readChart(key)
    if (existing && JSON.stringify(existing) === JSON.stringify(entry.chart)) continue
    const target = existing ? await uniqueKey(key) : key
    if (target !== key) chartRenames.set(key, target)
    await writeChart(target, { ...entry.chart, key: target })
    if (entry.notes) await writeNotes(target, entry.notes)
  }

  // 3. Documents — bodies into the shared pool (rewriting chart keys and
  // uploaded-file urls), suffixing colliding keys. Bundles exported before the
  // Doc wrapper dissolved carry `docs` instead: same bodies, each behind a
  // tracker record whose only surviving meaning is "this belongs to the
  // project" — so those become document attachments on the imported project.
  const legacyDocs: LegacyBundleDoc[] = bundle.docs ?? []
  const incoming: BundleDocument[] = [
    ...(bundle.documents ?? []),
    ...legacyDocs.map((d) => ({
      key: d?.document?.key || d?.record?.documentKey || '',
      document: d?.document ?? null,
      notes: d?.documentNotes ?? null,
    })),
  ]

  const documentRenames = new Map<string, string>()
  const landedDocumentKeys = new Set<string>()
  for (const entry of incoming) {
    const key = sanitizeDocKey(entry?.key)
    if (!key) continue
    if (!entry.document) {
      // The body wasn't bundled. If this pool already has it, the ref still
      // points at something real; otherwise it lands dangling, which is a
      // state attachments are built to survive.
      if (await readDoc(key)) landedDocumentKeys.add(key)
      continue
    }
    const document = JSON.parse(fixUploads(JSON.stringify(entry.document))) as Explainer
    for (const b of document.blocks ?? []) {
      if (b.type === 'chart' && chartRenames.has(b.chartKey)) b.chartKey = chartRenames.get(b.chartKey)!
    }
    const existing = await readDoc(key)
    if (existing && JSON.stringify(existing) === JSON.stringify({ ...document, key })) {
      landedDocumentKeys.add(key)
      continue
    }
    const target = existing ? await uniqueDocKey(key) : key
    if (target !== key) documentRenames.set(key, target)
    await writeDoc(target, { ...document, key: target })
    if (entry.notes) await writeDocNotes(target, entry.notes)
    landedDocumentKeys.add(target)
  }

  // Attachment refs follow their artifact to wherever it landed.
  const remapAttachments = (list: unknown): Attachment[] =>
    cleanAttachments(list).map((a) => {
      if (a.type === 'chart') return { ...a, id: chartRenames.get(a.id) ?? a.id }
      if (a.type === 'document') return { ...a, id: documentRenames.get(a.id) ?? a.id }
      return a
    })

  // 4. Project. Bundles exported before the epic layer was removed carried the
  // epic bodies separately — fold them into the description, as loadStore does.
  let description = String(bundle.project.description ?? '').trim()
  for (const e of bundle.epics ?? []) {
    const body = String(e?.description ?? '').trim()
    if (body) description = description ? `${description}\n\n${body}` : body
  }
  const project: Project = {
    id: newId('proj'),
    key: nextKey(store, 'project'),
    title: bundle.project.title.trim(),
    description: fixUploads(description),
    mode: bundle.project.mode === 'wayfinder' ? 'wayfinder' : 'standard',
    // The integration branch travels with the bundle (it names a branch on the
    // shared remote); the repo path does not — it's local to the machine that
    // exported it, so the importer points the project at their own clone.
    repo: '',
    integrationBranch: bundle.project.integrationBranch?.trim() ?? '',
    attachments: remapAttachments([
      ...(bundle.project.attachments ?? []),
      // Legacy wrapper records were the project↔document link; keep it.
      ...legacyDocs.map((d) => ({
        type: 'document',
        id: d?.document?.key || d?.record?.documentKey || '',
      })),
    ]),
    createdAt: bundle.project.createdAt || ts,
    updatedAt: bundle.project.updatedAt || ts,
  }
  store.projects.push(project)

  // 5. Tickets — comments come along; blockedBy is remapped once all exist.
  // Every bundled ticket belonged to the exported project, so they all land in
  // the new one (legacy bundles referenced the project through an epic).
  const ticketIdMap = new Map<string, string>()
  const pairs: Array<{ ticket: Ticket; src: Ticket }> = []
  for (const t of bundle.tickets ?? []) {
    if (!t?.title?.trim()) continue
    const ticket: Ticket = {
      id: newId('tick'),
      key: nextKey(store, 'ticket'),
      title: t.title.trim(),
      description: fixUploads(String(t.description ?? '')),
      acceptanceCriteria: (t.acceptanceCriteria ?? []).map((s) => String(s)).filter(Boolean),
      type: t.type === 'HITL' ? 'HITL' : 'AFK',
      status: isStatus(t.status) ? t.status : 'todo',
      projectId: project.id,
      assignee: typeof t.assignee === 'string' ? t.assignee.trim() : '',
      labels: cleanLabels(t.labels),
      resolution: fixUploads(String(t.resolution ?? '')),
      blockedBy: [],
      attachments: remapAttachments(t.attachments),
      comments: (t.comments ?? [])
        .filter((c) => c?.body)
        .map((c) => ({
          id: newId('cmt'),
          author: c.author?.trim() || 'anonymous',
          body: fixUploads(String(c.body)),
          createdAt: c.createdAt || ts,
        })),
      // The bundle carries the original completion stamp; bundles exported
      // before completedAt existed fall back to updatedAt, as loadStore does.
      completedAt: t.status === 'done' ? (t.completedAt ?? t.updatedAt ?? ts) : null,
      createdAt: t.createdAt || ts,
      updatedAt: t.updatedAt || ts,
    }
    if (t.id) ticketIdMap.set(t.id, ticket.id)
    store.tickets.push(ticket)
    pairs.push({ ticket, src: t })
  }
  for (const { ticket, src } of pairs) {
    const edges = new Set<string>()
    for (const ref of src.blockedBy ?? []) {
      const mapped = ticketIdMap.get(String(ref))
      if (mapped && mapped !== ticket.id) edges.add(mapped)
    }
    ticket.blockedBy = [...edges]
  }

  saveStore(store)
  setResponseStatus(event, 201)
  return {
    project,
    imported: { tickets: pairs.length, documents: landedDocumentKeys.size, charts: bundle.charts?.length ?? 0 },
  }
})

function uniqueUploadName(name: string): string {
  const ext = extname(name)
  const base = name.slice(0, name.length - ext.length)
  for (let i = 2; i < 500; i++) {
    const candidate = `${base}-${i}${ext}`
    if (!existsSync(join(UPLOADS_DIR, candidate))) return candidate
  }
  return `${base}-${Date.now()}${ext}`
}
