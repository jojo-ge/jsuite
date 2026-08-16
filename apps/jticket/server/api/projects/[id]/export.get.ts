import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

// Export one project (id or key) as a self-contained bundle for sharing:
// project + tickets (comments included) + docs with their shared-pool bodies
// inlined + the charts those docs embed + attachments referenced from any
// markdown. Round-trips through POST /api/projects/import.
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  const store = loadStore()
  const project = store.projects.find((p) => p.id === id || p.key === id)
  if (!project) throw createError({ statusCode: 404, statusMessage: 'project not found' })

  const tickets = store.tickets.filter((t) => t.projectId === project.id)

  const docs: BundleDoc[] = []
  for (const record of store.docs.filter((d) => d.projectId === project.id)) {
    const document = record.documentKey ? await readDoc(record.documentKey) : null
    docs.push({
      record,
      document,
      documentNotes: document ? await readDocNotes(record.documentKey) : null,
    })
  }

  const chartKeys = new Set<string>()
  for (const d of docs) {
    for (const b of d.document?.blocks ?? []) {
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
    docs,
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
