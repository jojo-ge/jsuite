// The All documents library — every document in the shared pool
// (`.data/jexplain/`), not just the ones a DOC-n tracker record wraps:
// reviewer and triage reports, explain.py articles, docs.
// Each opens in the reader at /e/<key> (pages/e/[key].vue).
import { isLibraryKind, listedByDefault, searchWords, tagCounts, type TagCount } from '@jsuite/documents/tags'
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

// The kinds the engine files itself, as each report comes back — so these
// documents are out of the library whether or not the session that wrote
// them remembered its tag.
export const REVIEW_OUTPUT_TAG = 'review-output'
export const SLICE_REPORT_TAG = 'slice-report'
export const OUTCOME_REPORT_TAG = 'outcome-report'

// ── Kinds, as the eye reads them ──
// One colour and glyph per kind, the way tickets have them (TICKET_TYPE_META):
// a kind reads by colour alone, with the icon as the second cue. Research and
// decision share their ticket type's look, and a review output the review
// ticket's, so the same idea is the same colour across the app. Literal
// Tailwind hues, kept as whole class strings so Tailwind sees them.
export interface DocumentKindMeta {
  label: string
  hint: string
  icon: string
  text: string
  bg: string
}

export const DOCUMENT_KIND_META: Record<string, DocumentKindMeta> = {
  explainer: { label: 'Explainer', hint: 'How something works — a tour or a branch walkthrough', icon: 'i-lucide-lightbulb', text: 'text-emerald-600 dark:text-emerald-400', bg: 'bg-emerald-500/15' },
  research: { label: 'Research', hint: 'Findings, audits and inventories', icon: 'i-lucide-book-open', text: 'text-amber-600 dark:text-amber-400', bg: 'bg-amber-500/15' },
  decision: { label: 'Decision', hint: 'Options weighed, or a decision record', icon: 'i-lucide-signpost', text: 'text-fuchsia-600 dark:text-fuchsia-400', bg: 'bg-fuchsia-500/15' },
  spec: { label: 'Spec', hint: 'What is to be built, and how', icon: 'i-lucide-clipboard-list', text: 'text-blue-600 dark:text-blue-400', bg: 'bg-blue-500/15' },
  proposal: { label: 'Proposal', hint: 'A plan put forward', icon: 'i-lucide-drafting-compass', text: 'text-orange-600 dark:text-orange-400', bg: 'bg-orange-500/15' },
  'review-output': { label: 'Review output', hint: 'A reviewer, triage or consensus report', icon: 'i-lucide-scan-eye', text: 'text-violet-600 dark:text-violet-400', bg: 'bg-violet-500/15' },
  'review-brief': { label: 'Review brief', hint: 'What a review\'s reviewers read first', icon: 'i-lucide-file-search', text: 'text-indigo-600 dark:text-indigo-400', bg: 'bg-indigo-500/15' },
  'slice-report': { label: 'Slice report', hint: 'What a run plan had built before a step', icon: 'i-lucide-layers', text: 'text-cyan-600 dark:text-cyan-400', bg: 'bg-cyan-500/15' },
  'outcome-report': { label: 'Outcome report', hint: 'What a finished project delivered', icon: 'i-lucide-flag', text: 'text-lime-600 dark:text-lime-400', bg: 'bg-lime-500/15' },
  'status-report': { label: 'Status report', hint: 'Where a piece of work stands', icon: 'i-lucide-activity', text: 'text-sky-600 dark:text-sky-400', bg: 'bg-sky-500/15' },
  reproduction: { label: 'Reproduction', hint: 'A suspected bug reproduced as a failing test', icon: 'i-lucide-bug', text: 'text-red-600 dark:text-red-400', bg: 'bg-red-500/15' },
}

const UNFILED_KIND = { icon: 'i-lucide-file-text', text: 'text-muted', bg: 'bg-elevated' }

/**
 * How a kind looks. A tag with no entry above keeps its own name on a neutral
 * tile, and a document with no tag at all reads "Untagged" — neither is hidden
 * or dressed up as something it isn't.
 */
export function documentKindMeta(tag: string | null | undefined): DocumentKindMeta {
  if (!tag) return { label: 'Untagged', hint: 'No kind set yet — add one from the reader', ...UNFILED_KIND }
  return DOCUMENT_KIND_META[tag] ?? { label: tag, hint: 'A kind with no icon of its own', ...UNFILED_KIND }
}

export interface LibraryFilter {
  /** Tags a document must ALL carry. */
  tags?: readonly string[]
  /**
   * List and search every kind. Off by default: the library is the five kinds
   * people read (LIBRARY_KINDS); reports and review outputs are most of the
   * pool and rarely what is being looked for.
   */
  all?: boolean
  /** Keys the server's full-text search matched (`GET /api/documents?q=`), for hits in the body. */
  contentHits?: ReadonlySet<string>
}

/** Whether the filter lets the other kinds through — asked for outright, or by picking one of their tags. */
export function showsEverything(filter: LibraryFilter): boolean {
  return !!filter.all || (filter.tags ?? []).some((t) => !isLibraryKind(t))
}

/**
 * The library's rows for a query and filter. Every whitespace-separated word
 * must appear in the title, subtitle, kicker, pool key, tags or DOC key — or
 * the document is one the server's full-text search matched. Kinds outside
 * LIBRARY_KINDS are neither listed nor searched unless the filter asks.
 */
export function filterLibrary(entries: readonly LibraryEntry[], query: string, filter: LibraryFilter = {}): LibraryEntry[] {
  const words = searchWords(query)
  const tags = filter.tags ?? []
  const everything = showsEverything(filter)
  return entries.filter((e) => {
    if (!everything && !listedByDefault(e)) return false
    if (!tags.every((t) => e.tags?.includes(t))) return false
    if (!words.length || filter.contentHits?.has(e.key)) return true
    const hay = [e.title, e.subtitle, e.kicker, e.key, e.trackedAs, ...(e.tags ?? [])].filter(Boolean).join(' ').toLowerCase()
    return words.every((w) => hay.includes(w))
  })
}

/** The tag chips over the library: the tags in use on the given rows, most used first. */
export function libraryTags(entries: readonly LibraryEntry[]): TagCount[] {
  return tagCounts(entries)
}

/** A tag list with one tag flipped — the chip click. */
export function toggleTag(tags: readonly string[], tag: string): string[] {
  return tags.includes(tag) ? tags.filter((t) => t !== tag) : [...tags, tag]
}
