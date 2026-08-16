import { readDoc, writeDoc, cleanDocLabels, sanitizeDocKey } from '../../utils/store'

/**
 * Refile a document without republishing it. Body: { labels }.
 *
 * Filing changes far more often than a body does — a document is marked
 * `ready`, or picks up a `wayfinder:asset` after the fact — and going through
 * POST for that would mean resending every block just to add a word. Only
 * `labels` is patchable: the blocks are the authoring skill's output and stay
 * a whole-document write.
 */
export default defineEventHandler(async (event) => {
  // Sanitised once and used for both the read and the write, so a document
  // whose stored `key` somehow disagrees with its filename can't have its
  // labels written to a different file than they were read from.
  const key = sanitizeDocKey(getRouterParam(event, 'key') || '')
  const doc = await readDoc(key)
  if (!doc) throw createError({ statusCode: 404, statusMessage: 'No such document' })

  const body = (await readBody(event)) ?? {}
  if (body.labels === undefined) {
    throw createError({ statusCode: 400, statusMessage: 'Nothing to patch — send { labels }' })
  }

  doc.labels = cleanDocLabels(body.labels)
  doc.updatedAt = new Date().toISOString()
  await writeDoc(key, doc)
  return { key, labels: doc.labels }
})
