import { docKeyFromTitle, uniqueDocKey, readDoc, writeDoc, newDocId, type Explainer } from '../../utils/store'
import { materialiseBlocks, cleanGlossary } from '../../utils/materialise'

/**
 * Create a document in the shared pool. Body: { title, subtitle?, kicker?,
 * blocks, glossary?, key?, replace? }
 *
 * Chart blocks may carry inline `mermaid`; they're materialised into the shared
 * jChart store and stored as { chartKey } references. `replace: true`
 * overwrites the named doc in place (keeping createdAt and its notes sidecar)
 * so a skill can re-publish a revision at the same URL. The returned `path`
 * is the jExplain reader route — the pool's canonical reading surface.
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
    // `replace: true` republishes a revision of the same document, so it keeps
    // the identity (and createdAt); anything else is a new document.
    id: existing?.id ?? newDocId(),
    key,
    title,
    subtitle: typeof body.subtitle === 'string' && body.subtitle.trim() ? body.subtitle.trim() : undefined,
    kicker: typeof body.kicker === 'string' && body.kicker.trim() ? body.kicker.trim() : undefined,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    blocks: await materialiseBlocks(key, Array.isArray(body.blocks) ? body.blocks : []),
    glossary: cleanGlossary(body.glossary),
  }
  await writeDoc(key, doc)

  return { id: doc.id, key, title, path: `/e/${key}`, blocks: doc.blocks.length }
})
