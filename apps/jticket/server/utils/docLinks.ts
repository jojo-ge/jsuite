import { readDoc } from '@jsuite/documents/store'
import { saveStore, type Store } from './store'

/**
 * Point doc records at the *identity* of their backing document, not just its
 * slug.
 *
 * Records written before documents had ids carry `documentKey` alone. The key
 * is derived from the title and unique only within one pool, so it can't
 * survive a rename or tell two pools' "q3-planning" apart — anything that has
 * to reconcile (publish, sync, import) needs `documentId`.
 *
 * Runs on read rather than as a one-shot migration so a pool restored from an
 * older backup heals itself. It's a no-op once every record is linked, and it
 * leaves `documentId` empty when the body is missing or hasn't been assigned an
 * id yet — the next read picks it up.
 */
export async function backfillDocumentIds(store: Store): Promise<void> {
  const pending = store.docs.filter((d) => d.documentKey && !d.documentId)
  if (!pending.length) return

  let linked = false
  for (const doc of pending) {
    const document = await readDoc(doc.documentKey)
    if (!document?.id) continue
    doc.documentId = document.id
    linked = true
  }
  if (linked) saveStore(store)
}
