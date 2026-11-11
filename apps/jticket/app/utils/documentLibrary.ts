// The All documents library — every document in the shared pool
// (`.data/jexplain/`), not just the ones a DOC-n tracker record wraps:
// reviewer and triage reports, explain.py articles, grilling debriefs, docs.
// Each opens in the reader at /e/<key> (pages/e/[key].vue).
import type { ExplainerMeta } from '@jsuite/documents/types'

/** The slice of a tracker doc (DOC-n) the library needs. */
export interface TrackerDocRef {
  key: string
  documentKey: string
}

export interface LibraryEntry extends ExplainerMeta {
  /** The DOC-n that wraps this document, if any. */
  trackedAs: string | null
}

/** The reader route for a pool document — the URL every skill and link uses. */
export function readerPath(key: string): string {
  return `/e/${encodeURIComponent(key)}`
}

/** The tracker doc (DOC-n) whose content is this pool document, if one is. */
export function trackerDocFor<T extends TrackerDocRef>(key: string, docs: readonly T[]): T | undefined {
  return docs.find((d) => d.documentKey && d.documentKey === key)
}

/** The confirm text for deleting a pool document — names the DOC-n it would leave empty. */
export function deleteDocumentPrompt(title: string, trackedAs: string | null | undefined): string {
  const wrapped = trackedAs ? ` ${trackedAs} wraps it and will be left with no content.` : ''
  return `Delete "${title}" and its notes from the document pool?${wrapped} Charts it references stay.`
}

/** Every pool document, in the pool's order (newest first), marked with its DOC-n. */
export function libraryEntries(pool: readonly ExplainerMeta[], docs: readonly TrackerDocRef[]): LibraryEntry[] {
  const byDocument = new Map<string, string>()
  for (const d of docs) if (d.documentKey && !byDocument.has(d.documentKey)) byDocument.set(d.documentKey, d.key)
  return pool.map((m) => ({ ...m, trackedAs: byDocument.get(m.key) ?? null }))
}

/** Every whitespace-separated word must appear in the title, subtitle, kicker, pool key or DOC key. */
export function filterLibrary(entries: readonly LibraryEntry[], query: string): LibraryEntry[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (!words.length) return [...entries]
  return entries.filter((e) => {
    const hay = [e.title, e.subtitle, e.kicker, e.key, e.trackedAs].filter(Boolean).join(' ').toLowerCase()
    return words.every((w) => hay.includes(w))
  })
}
