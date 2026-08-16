import type { Explainer } from '@jsuite/documents/store'

// Create a tracker doc backed by a document in the shared @jsuite/documents
// pool (the jExplain block format — see the to-jdoc / j-explain skills).
// Either link an existing shared document via `documentKey`, or author one
// inline: `blocks` (+ optional `subtitle`, `kicker`, `glossary`) creates it.
// `project` accepts a project id, key, or exact title; `projectId` also works.
export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  if (!body?.title?.trim()) {
    throw createError({ statusCode: 400, statusMessage: 'title is required' })
  }
  const title = String(body.title).trim()
  const store = loadStore()

  let projectId: string | null = null
  const ref = body.project ?? body.projectId
  if (ref) {
    const project = findProjectRef(store, ref)
    if (!project) throw createError({ statusCode: 400, statusMessage: `unknown project: ${ref}` })
    projectId = project.id
  }

  const ts = now()

  // Resolve the backing document: link an existing one, or create it.
  let documentKey = typeof body.documentKey === 'string' ? sanitizeDocKey(body.documentKey) : ''
  if (documentKey) {
    if (!(await readDoc(documentKey))) {
      throw createError({ statusCode: 400, statusMessage: `unknown document: ${documentKey}` })
    }
  } else {
    documentKey = await uniqueDocKey(docKeyFromTitle(title))
    const document: Explainer = {
      format: 'j-explain',
      version: 1,
      key: documentKey,
      title,
      subtitle: typeof body.subtitle === 'string' && body.subtitle.trim() ? body.subtitle.trim() : undefined,
      kicker: typeof body.kicker === 'string' && body.kicker.trim() ? body.kicker.trim() : undefined,
      createdAt: ts,
      updatedAt: ts,
      blocks: await materialiseBlocks(documentKey, Array.isArray(body.blocks) ? body.blocks : []),
      glossary: cleanGlossary(body.glossary),
    }
    await writeDoc(documentKey, document)
  }

  const doc: Doc = {
    id: newId('doc'),
    key: nextKey(store, 'doc'),
    title,
    documentKey,
    projectId,
    labels: cleanLabels(body.labels),
    status: isDocStatus(body.status) ? body.status : 'draft',
    createdAt: ts,
    updatedAt: ts,
  }
  store.docs.push(doc)
  saveStore(store)
  setCreated(event)
  return doc
})
