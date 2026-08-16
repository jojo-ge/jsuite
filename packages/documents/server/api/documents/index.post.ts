import { docKeyFromTitle, uniqueDocKey, readDoc, writeDoc, cleanDocLabels, type Explainer } from '../../utils/store'
import { materialiseBlocks, cleanGlossary } from '../../utils/materialise'
import { documentPath } from '../../../routes'

/**
 * Create a document in the shared pool. Body: { title, subtitle?, kicker?,
 * blocks, glossary?, labels?, key?, replace? }
 *
 * Chart blocks may carry inline `mermaid`; they're materialised into the shared
 * jChart store and stored as { chartKey } references. `replace: true`
 * overwrites the named doc in place (keeping createdAt and its notes sidecar)
 * so a skill can re-publish a revision at the same URL. The returned `path` is
 * this app's own reader route: the pool is mounted in three apps and the layer's
 * `/documents/<key>` is the one reader all three serve, so that — and not
 * jExplain's branded `/e/<key>` — is what an answer from any of them can
 * truthfully name (TICK-190). It comes from `documentPath()`, with the rest of
 * the routing knowledge, rather than being spelled out here.
 *
 * On a replace, omitting `labels` keeps the ones already on the document —
 * re-publishing a revision is about the body, and a skill that rewrites blocks
 * shouldn't silently unfile the document. Send `labels: []` to clear them, or
 * PATCH the document to change filing without touching the body.
 */
export default defineEventHandler(async (event) => {
  const body = (await readBody(event)) ?? {}
  const title = String(body.title || '').trim() || 'Untitled document'
  const requested = body.key ? String(body.key) : docKeyFromTitle(title)
  const key = body.replace ? docKeyFromTitle(requested) : await uniqueDocKey(requested)

  const existing = body.replace ? await readDoc(key) : null
  const now = new Date().toISOString()

  const doc: Explainer = {
    format: 'j-explain',
    version: 1,
    key,
    title,
    subtitle: typeof body.subtitle === 'string' && body.subtitle.trim() ? body.subtitle.trim() : undefined,
    kicker: typeof body.kicker === 'string' && body.kicker.trim() ? body.kicker.trim() : undefined,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    blocks: await materialiseBlocks(key, Array.isArray(body.blocks) ? body.blocks : []),
    glossary: cleanGlossary(body.glossary),
    labels: body.labels === undefined ? (existing?.labels ?? []) : cleanDocLabels(body.labels),
  }
  await writeDoc(key, doc)

  return { key, title, path: documentPath(key), blocks: doc.blocks.length, labels: doc.labels }
})
