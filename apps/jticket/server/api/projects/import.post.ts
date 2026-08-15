import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { extname, join } from 'node:path'
import type { Explainer } from '@jsuite/documents/store'

// Import a bundle produced by GET /api/projects/:id/export. Always creates a
// new project — fresh ids and keys minted on this tracker, titles, statuses,
// comments and timestamps preserved. Doc bodies land in the shared document
// pool, charts in the chart pool, attachments on disk; anything whose key or
// name collides with different content gets a suffixed copy (byte-identical
// content is reused, and every reference is rewritten to the new key/name).
export default defineEventHandler(async (event) => {
  const bundle = await readBody<ProjectBundle>(event)
  if (bundle?.format !== BUNDLE_FORMAT || !bundle.project?.title?.trim()) {
    throw createError({ statusCode: 400, statusMessage: 'not a jticket project bundle' })
  }
  const store = loadStore()
  const ts = now()

  // 1. Attachments — suffix names that collide with different bytes.
  const attachmentRenames = new Map<string, string>()
  if (bundle.attachments?.length) mkdirSync(ATTACHMENTS_DIR, { recursive: true })
  for (const att of bundle.attachments ?? []) {
    const name = safeAttachmentName(att.name)
    const buf = Buffer.from(String(att.base64 ?? ''), 'base64')
    if (!buf.length) continue
    const path = join(ATTACHMENTS_DIR, name)
    if (!existsSync(path)) {
      writeFileSync(path, buf)
    } else if (!readFileSync(path).equals(buf)) {
      const renamed = uniqueAttachmentName(name)
      writeFileSync(join(ATTACHMENTS_DIR, renamed), buf)
      attachmentRenames.set(name, renamed)
    }
  }
  const fixAttachments = (text: string): string =>
    attachmentRenames.size
      ? text.replace(/\/attachments\/([\w.-]+)/g, (whole, n: string) =>
          attachmentRenames.has(n) ? `/attachments/${attachmentRenames.get(n)}` : whole,
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

  // 3. Project.
  const project: Project = {
    id: newId('proj'),
    key: nextKey(store, 'project'),
    title: bundle.project.title.trim(),
    description: fixAttachments(String(bundle.project.description ?? '')),
    mode: bundle.project.mode === 'wayfinder' ? 'wayfinder' : 'standard',
    createdAt: bundle.project.createdAt || ts,
    updatedAt: bundle.project.updatedAt || ts,
  }
  store.projects.push(project)

  // 4. Epics, keeping a bundle-id → new-id map for the tickets.
  const epicIdMap = new Map<string, string>()
  let epicCount = 0
  for (const e of bundle.epics ?? []) {
    if (!e?.title?.trim()) continue
    const epic: Epic = {
      id: newId('epic'),
      key: nextKey(store, 'epic'),
      title: e.title.trim(),
      description: fixAttachments(String(e.description ?? '')),
      projectId: project.id,
      labels: cleanLabels(e.labels),
      createdAt: e.createdAt || ts,
      updatedAt: e.updatedAt || ts,
    }
    if (e.id) epicIdMap.set(e.id, epic.id)
    store.epics.push(epic)
    epicCount++
  }

  // 5. Tickets — comments come along; blockedBy is remapped once all exist.
  const ticketIdMap = new Map<string, string>()
  const pairs: Array<{ ticket: Ticket; src: Ticket }> = []
  for (const t of bundle.tickets ?? []) {
    if (!t?.title?.trim()) continue
    const ticket: Ticket = {
      id: newId('tick'),
      key: nextKey(store, 'ticket'),
      title: t.title.trim(),
      description: fixAttachments(String(t.description ?? '')),
      acceptanceCriteria: (t.acceptanceCriteria ?? []).map((s) => String(s)).filter(Boolean),
      type: t.type === 'HITL' ? 'HITL' : 'AFK',
      status: isStatus(t.status) ? t.status : 'todo',
      epicId: (t.epicId && epicIdMap.get(t.epicId)) || null,
      assignee: typeof t.assignee === 'string' ? t.assignee.trim() : '',
      labels: cleanLabels(t.labels),
      resolution: fixAttachments(String(t.resolution ?? '')),
      blockedBy: [],
      comments: (t.comments ?? [])
        .filter((c) => c?.body)
        .map((c) => ({
          id: newId('cmt'),
          author: c.author?.trim() || 'anonymous',
          body: fixAttachments(String(c.body)),
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

  // 6. Docs — bodies into the shared pool (rewriting chart keys + attachment
  // urls), tracker records pointing at wherever the body landed.
  let docCount = 0
  for (const d of bundle.docs ?? []) {
    const record = d?.record
    if (!record?.title?.trim()) continue
    let documentKey = ''
    if (d.document) {
      const document = JSON.parse(fixAttachments(JSON.stringify(d.document))) as Explainer
      for (const b of document.blocks ?? []) {
        if (b.type === 'chart' && chartRenames.has(b.chartKey)) b.chartKey = chartRenames.get(b.chartKey)!
      }
      const desired = sanitizeDocKey(d.document.key || record.documentKey) || docKeyFromTitle(record.title)
      const existing = await readDoc(desired)
      if (existing && JSON.stringify(existing) === JSON.stringify({ ...document, key: desired })) {
        documentKey = desired
      } else {
        documentKey = existing ? await uniqueDocKey(desired) : desired
        await writeDoc(documentKey, { ...document, key: documentKey })
        if (d.documentNotes) await writeDocNotes(documentKey, d.documentNotes)
      }
    } else if (record.documentKey && (await readDoc(record.documentKey))) {
      documentKey = record.documentKey // body wasn't bundled but this pool already has it
    }
    const doc: Doc = {
      id: newId('doc'),
      key: nextKey(store, 'doc'),
      title: record.title.trim(),
      documentKey,
      projectId: project.id,
      labels: cleanLabels(record.labels),
      status: isDocStatus(record.status) ? record.status : 'draft',
      createdAt: record.createdAt || ts,
      updatedAt: record.updatedAt || ts,
    }
    store.docs.push(doc)
    docCount++
  }

  saveStore(store)
  setResponseStatus(event, 201)
  return {
    project,
    imported: { epics: epicCount, tickets: pairs.length, docs: docCount },
  }
})

function uniqueAttachmentName(name: string): string {
  const ext = extname(name)
  const base = name.slice(0, name.length - ext.length)
  for (let i = 2; i < 500; i++) {
    const candidate = `${base}-${i}${ext}`
    if (!existsSync(join(ATTACHMENTS_DIR, candidate))) return candidate
  }
  return `${base}-${Date.now()}${ext}`
}
