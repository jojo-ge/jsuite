// Update a tracker doc. Metadata fields (title, labels, status, project)
// update the record; content fields (blocks, glossary, subtitle, kicker)
// rewrite the backing shared document in place — same replace semantics as
// POST /api/documents with replace:true (createdAt and the notes sidecar
// survive). `documentKey` relinks the record to a different shared document.
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  const body = await readBody(event)
  const store = loadStore()
  const doc = store.docs.find((d) => d.id === id || d.key === id)
  if (!doc) throw createError({ statusCode: 404, statusMessage: 'doc not found' })

  if (body.title !== undefined) doc.title = String(body.title).trim()
  if (body.labels !== undefined) doc.labels = cleanLabels(body.labels)
  if (body.status !== undefined) {
    if (!isDocStatus(body.status)) {
      throw createError({ statusCode: 400, statusMessage: 'status must be draft or ready' })
    }
    doc.status = body.status
  }
  const ref = body.project !== undefined ? body.project : body.projectId
  if (ref !== undefined) {
    if (ref === null || ref === '') {
      doc.projectId = null
    } else {
      const project = findProjectRef(store, ref)
      if (!project) throw createError({ statusCode: 400, statusMessage: `unknown project: ${ref}` })
      doc.projectId = project.id
    }
  }

  if (body.documentKey !== undefined) {
    const key = sanitizeDocKey(body.documentKey)
    if (!key || !(await readDoc(key))) {
      throw createError({ statusCode: 400, statusMessage: `unknown document: ${body.documentKey}` })
    }
    doc.documentKey = key
  }

  // Content updates rewrite the backing shared document.
  const touchesContent =
    body.blocks !== undefined || body.glossary !== undefined || body.subtitle !== undefined || body.kicker !== undefined
  if (touchesContent) {
    const existing = await readDoc(doc.documentKey)
    const ts = now()
    await writeDoc(doc.documentKey, {
      format: 'j-explain',
      version: 1,
      key: doc.documentKey,
      title: doc.title,
      subtitle:
        body.subtitle !== undefined
          ? (typeof body.subtitle === 'string' && body.subtitle.trim() ? body.subtitle.trim() : undefined)
          : existing?.subtitle,
      kicker:
        body.kicker !== undefined
          ? (typeof body.kicker === 'string' && body.kicker.trim() ? body.kicker.trim() : undefined)
          : existing?.kicker,
      createdAt: existing?.createdAt ?? now(),
      updatedAt: ts,
      blocks:
        body.blocks !== undefined
          ? await materialiseBlocks(doc.documentKey, Array.isArray(body.blocks) ? body.blocks : [])
          : (existing?.blocks ?? []),
      glossary: body.glossary !== undefined ? cleanGlossary(body.glossary) : (existing?.glossary ?? {}),
    })
  }

  doc.updatedAt = now()
  saveStore(store)
  return doc
})
