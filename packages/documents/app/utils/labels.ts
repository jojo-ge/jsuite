/** A document to read labels off, or a bare label already in hand. */
export type LabelSource = string | { labels: string[] }

/**
 * Every label in use, deduped and sorted — the one definition of "the pool's
 * labels", behind the library filter chip bars and the editor's suggestions.
 *
 * Takes documents, bare labels, or a mix, because its callers hold the pool by
 * different ends: a list of documents in the libraries, an accumulating set of
 * strings in the label editor.
 */
export function labelPool(sources: readonly LabelSource[]): string[] {
  return [...new Set(sources.flatMap((s) => (typeof s === 'string' ? [s] : s.labels)))].sort()
}
