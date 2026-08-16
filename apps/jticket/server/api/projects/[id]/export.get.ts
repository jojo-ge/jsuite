import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

// Export one project (id or key) as a self-contained bundle for sharing:
// project + tickets (comments included) + the shared-pool bodies of every
// document and chart they attach + the charts those documents embed +
// uploaded files referenced from any markdown. Round-trips through
// POST /api/projects/import.
//
// Diff attachments travel as bare refs: a review target is a PR number or a
// branch in a specific repo, which means nothing on the machine importing it.
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  const store = loadStore()
  const project = store.projects.find((p) => p.id === id || p.key === id)
  if (!project) throw createError({ statusCode: 404, statusMessage: 'project not found' })

  const tickets = store.tickets.filter((t) => t.projectId === project.id)

  // Every artifact the project or one of its tickets links, de-duplicated.
  const attached = [...project.attachments, ...tickets.flatMap((t) => t.attachments)]
  const documentKeys = new Set(attached.filter((a) => a.type === 'document').map((a) => a.id))
  const chartKeys = new Set(attached.filter((a) => a.type === 'chart').map((a) => a.id))

  const documents: BundleDocument[] = []
  for (const key of documentKeys) {
    const document = await readDoc(key)
    documents.push({ key, document, notes: document ? await readDocNotes(key) : null })
    // A document's own chart blocks come along too — the article is only whole
    // with the charts it embeds.
    for (const b of document?.blocks ?? []) {
      if (b.type === 'chart' && b.chartKey) chartKeys.add(b.chartKey)
    }
  }

  const charts: BundleChart[] = []
  for (const key of chartKeys) {
    const chart = await readChart(key)
    if (chart) charts.push({ key, chart, notes: await readNotes(key) })
  }

  const bundle: ProjectBundle = {
    format: BUNDLE_FORMAT,
    version: 1,
    exportedAt: now(),
    // The repo path is local to this machine, so it doesn't travel; the
    // integration branch (a branch on the shared remote) does.
    project: { ...project, repo: '' },
    tickets,
    documents,
    charts,
    attachments: [],
  }

  // Sweep every markdown surface (descriptions, resolutions, comments, doc
  // bodies) for /attachments/<name> references and inline the files.
  for (const name of attachmentRefs(JSON.stringify(bundle))) {
    const p = join(ATTACHMENTS_DIR, name)
    if (existsSync(p)) bundle.attachments.push({ name, base64: readFileSync(p).toString('base64') })
  }

  const slug = sanitizeDocKey(project.title) || 'project'
  setResponseHeaders(event, {
    'content-type': 'application/json',
    'content-disposition': `attachment; filename="${project.key.toLowerCase()}-${slug}.jticket.json"`,
  })
  return bundle
})
