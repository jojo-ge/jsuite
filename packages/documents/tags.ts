// Tags and search over the shared document pool — pure, importable from both
// client and server code via `@jsuite/documents/tags`.
//
// A document's `tags` say what KIND of document it is — one lowercase
// kebab-case word (`explainer`, `decision`, `slice-report`, `review-output`)
// on the pool document itself, so every document has one, tracked by a DOC-n
// or not. They are NOT a tracker doc's `labels`: those are markers the engine
// reads (`slice`, `outcome`, `plan:asset`) and nothing here touches them.
//
// The vocabulary is the tags in use (`tagCounts`): a writer picks from it.
import type { Block, Explainer } from './types'

/**
 * The kinds the library lists and searches without being asked — what a person
 * wrote, or asked for, to be read. Every other kind (slice, outcome and status
 * reports, review outputs and briefs, reproductions) is filed, not browsed: it
 * stays out of the list and out of search until the library's switch is on.
 */
export const LIBRARY_KINDS: readonly string[] = ['explainer', 'research', 'decision', 'spec', 'proposal']

export function isLibraryKind(tag: string): boolean {
  return LIBRARY_KINDS.includes(tag)
}

/**
 * Whether the library lists a document by default: it carries one of
 * LIBRARY_KINDS — or no tag at all, so a document nobody has filed yet cannot
 * silently vanish.
 */
export function listedByDefault(doc: { tags?: readonly string[] }): boolean {
  const tags = doc.tags ?? []
  return !tags.length || tags.some(isLibraryKind)
}

export const TAGS_MAX = 8
const TAG_LENGTH_MAX = 40

/** One tag, normalised: lowercase kebab-case, or '' when nothing is left. */
export function cleanTag(input: unknown): string {
  return String(input ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, TAG_LENGTH_MAX)
    .replace(/-+$/, '')
}

/** A tag list as stored: normalised, deduped, in the order given, capped. */
export function cleanTags(input: unknown): string[] {
  const raw = Array.isArray(input) ? input : typeof input === 'string' ? input.split(',') : []
  const out: string[] = []
  for (const t of raw) {
    const tag = cleanTag(t)
    if (tag && !out.includes(tag)) out.push(tag)
    if (out.length === TAGS_MAX) break
  }
  return out
}

export interface TagCount {
  tag: string
  count: number
}

/** Every tag in use, most used first (ties alphabetical). */
export function tagCounts(docs: readonly { tags?: readonly string[] }[]): TagCount[] {
  const counts = new Map<string, number>()
  for (const d of docs) for (const t of d.tags ?? []) counts.set(t, (counts.get(t) ?? 0) + 1)
  return [...counts.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag))
}

// ── Search ────────────────────────────────────────────────────────────────────

/** A query's words: whitespace-separated, lowercased. Every one must match. */
export function searchWords(query: unknown): string[] {
  return String(query ?? '').toLowerCase().split(/\s+/).filter(Boolean)
}

// Block fields that are plumbing, not something a reader would search for.
const NOT_TEXT = new Set(['id', 'type', 'chartKey', 'src', 'lang', 'tone', 'height', 'startLine', 'highlight'])

function collectText(value: unknown, out: string[]): void {
  if (typeof value === 'string') {
    if (value.trim()) out.push(value)
  } else if (Array.isArray(value)) {
    for (const v of value) collectText(v, out)
  } else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) if (!NOT_TEXT.has(k)) collectText(v, out)
  }
}

/** Everything a reader can see in the blocks, as one string. */
export function blocksText(blocks: readonly Block[] | undefined): string {
  const out: string[] = []
  collectText(blocks ?? [], out)
  return out.join('\n')
}

/** What the library row already shows: title, subtitle, kicker, key and tags. */
export function headText(doc: Pick<Explainer, 'key' | 'title'> & Partial<Pick<Explainer, 'subtitle' | 'kicker' | 'tags'>>): string {
  return [doc.title, doc.subtitle, doc.kicker, doc.key, ...(doc.tags ?? [])].filter(Boolean).join(' ')
}

const SNIPPET_BEFORE = 50
const SNIPPET_AFTER = 110

/** A one-line excerpt of `text` around the first occurrence of `word`. */
export function snippetAround(text: string, word: string): string {
  const at = text.toLowerCase().indexOf(word)
  if (at < 0) return ''
  const start = Math.max(0, at - SNIPPET_BEFORE)
  const end = Math.min(text.length, at + word.length + SNIPPET_AFTER)
  const body = text.slice(start, end).replace(/\s+/g, ' ').trim()
  return `${start > 0 ? '…' : ''}${body}${end < text.length ? '…' : ''}`
}

export interface DocumentMatch {
  /** Where the body matched — only when the row's own text didn't cover the query. */
  snippet?: string
}

/**
 * Full-text match: every word of the query must appear somewhere in the
 * document — its title, subtitle, kicker, key, tags or block text. Returns
 * null on a miss. An empty query matches everything.
 */
export function matchDocument(doc: Explainer, query: unknown): DocumentMatch | null {
  const words = searchWords(query)
  if (!words.length) return {}
  const head = headText(doc).toLowerCase()
  const inBodyOnly = words.filter((w) => !head.includes(w))
  if (!inBodyOnly.length) return {}
  const body = blocksText(doc.blocks)
  const lower = body.toLowerCase()
  if (!inBodyOnly.every((w) => lower.includes(w))) return null
  return { snippet: snippetAround(body, inBodyOnly[0]!) }
}
