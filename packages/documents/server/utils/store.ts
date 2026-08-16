import { readFile, writeFile, readdir, rm } from 'node:fs/promises'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { appDataDir } from '@jsuite/data'
import type { Block, Explainer, DocNote, DocNotes, ExplainerMeta } from '../../types'

// The shared document pool: one document per pretty-printed file in
// .data/jexplain/<key>.json, with review notes in a sidecar
// .data/jexplain/<key>.notes.json — the same layout as jChart's store, so an
// LLM can read both straight off disk. The directory keeps the name of the app
// the pool was born in (jExplain), exactly like the chart pool keeps jChart's;
// every consumer of this layer (jExplain, jTicket) reads and writes the same
// files through its own copy of these routes.
//
// Function names are deliberately distinct from the chart store's (readChart,
// writeChart, …) and from jTicket's tracker store (loadStore, saveStore) —
// all of them are Nitro-auto-imported into a consumer's server context.
const DATA_DIR = appDataDir('jexplain')

export type * from '../../types'

// ── Persistence ───────────────────────────────────────────────────────────────

export function sanitizeDocKey(key: unknown): string {
  return String(key ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
}

export function docKeyFromTitle(title: string): string {
  return sanitizeDocKey(title) || 'document'
}

/**
 * Normalise a document's labels: trimmed, lowercased, deduped, in the order
 * first given, capped at 24 of 60 characters each.
 *
 * Lowercasing is what makes `?label=Spec` find a document filed as `spec` — a
 * label is a filing key, not prose, so two spellings of one word must not
 * become two labels. Anything that isn't a string is dropped rather than
 * coerced, so a malformed body can't put `[object Object]` in the pool.
 *
 * Named `cleanDocLabels` rather than `cleanLabels` because jTicket's tracker
 * store exports a `cleanLabels` for *ticket* labels, and both land in the same
 * Nitro auto-import namespace — one would silently shadow the other, and
 * ticket labels are deliberately not lowercased.
 */
export function cleanDocLabels(input: unknown): string[] {
  if (!Array.isArray(input)) return []
  const out: string[] = []
  for (const raw of input) {
    if (typeof raw !== 'string') continue
    const label = raw.trim().toLowerCase().slice(0, 60)
    if (label && !out.includes(label)) out.push(label)
    if (out.length >= 24) break
  }
  return out
}

const docPath = (key: string) => join(DATA_DIR, sanitizeDocKey(key) + '.json')
const docNotesPath = (key: string) => join(DATA_DIR, sanitizeDocKey(key) + '.notes.json')

export async function uniqueDocKey(base: string): Promise<string> {
  const root = sanitizeDocKey(base) || 'document'
  if (!existsSync(docPath(root))) return root
  for (let i = 2; i < 500; i++) {
    const candidate = `${root}-${i}`
    if (!existsSync(docPath(candidate))) return candidate
  }
  return `${root}-${Date.now()}`
}

export async function readDoc(key: string): Promise<Explainer | null> {
  const p = docPath(key)
  if (!existsSync(p)) return null
  try {
    const doc = JSON.parse(await readFile(p, 'utf8')) as Explainer
    // Documents written before labels existed have none; normalising on read
    // (rather than rewriting the pool) means every caller sees an array and
    // the file only gains the field the next time it's written.
    doc.labels = cleanDocLabels(doc.labels)
    return doc
  } catch {
    return null
  }
}

export async function writeDoc(key: string, doc: Explainer): Promise<void> {
  await writeFile(docPath(key), JSON.stringify(doc, null, 2) + '\n', 'utf8')
}

/**
 * Add labels to a document already in the pool, keeping the ones it has.
 *
 * Synchronous on purpose, and the one sync writer here: jTicket's store
 * migration is a synchronous read of a single JSON file, and this is how the
 * labels its dissolved Doc wrapper carried land on the documents themselves.
 * A missing, unparseable or foreign-format file is a silent no-op — a
 * migration must never be the thing that fails a boot — and re-running it
 * changes nothing, since the labels are already there.
 */
export function addDocLabelsSync(key: string, labels: unknown): void {
  const add = cleanDocLabels(labels)
  if (!add.length) return
  const p = docPath(key)
  if (!existsSync(p)) return
  try {
    const doc = JSON.parse(readFileSync(p, 'utf8')) as Explainer
    if (doc.format !== 'j-explain') return
    const before = cleanDocLabels(doc.labels)
    const merged = cleanDocLabels([...before, ...add])
    if (merged.length === before.length) return
    doc.labels = merged
    writeFileSync(p, JSON.stringify(doc, null, 2) + '\n', 'utf8')
  } catch {
    // Leave the document exactly as it was.
  }
}

export async function deleteDoc(key: string): Promise<void> {
  for (const p of [docPath(key), docNotesPath(key)]) {
    if (existsSync(p)) await rm(p)
  }
}

export async function readDocNotes(key: string): Promise<DocNotes> {
  const p = docNotesPath(key)
  if (!existsSync(p)) return { general: '', notes: [] }
  try {
    const parsed = JSON.parse(await readFile(p, 'utf8')) as Partial<DocNotes>
    return {
      general: typeof parsed.general === 'string' ? parsed.general : '',
      notes: Array.isArray(parsed.notes) ? (parsed.notes as DocNote[]) : [],
    }
  } catch {
    return { general: '', notes: [] }
  }
}

export async function writeDocNotes(key: string, notes: DocNotes): Promise<void> {
  await writeFile(docNotesPath(key), JSON.stringify(notes, null, 2) + '\n', 'utf8')
}

export async function listDocs(): Promise<ExplainerMeta[]> {
  const files = (await readdir(DATA_DIR)).filter((f) => f.endsWith('.json') && !f.endsWith('.notes.json'))
  const out: ExplainerMeta[] = []
  for (const f of files) {
    const key = f.replace(/\.json$/, '')
    try {
      const doc = JSON.parse(await readFile(join(DATA_DIR, f), 'utf8')) as Explainer
      if (doc.format !== 'j-explain') continue
      const { notes } = await readDocNotes(key)
      const blocks = Array.isArray(doc.blocks) ? doc.blocks : []
      out.push({
        key,
        title: doc.title || key,
        subtitle: doc.subtitle,
        kicker: doc.kicker,
        createdAt: doc.createdAt,
        updatedAt: doc.updatedAt,
        blockCount: blocks.length,
        chartCount: blocks.filter((b) => b.type === 'chart').length,
        noteCount: notes.filter((n) => (n.text || '').trim()).length,
        labels: cleanDocLabels(doc.labels),
      })
    } catch {
      // An unparseable file just doesn't appear in the list.
    }
  }
  return out.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
}

/** A short human label for a block, captured onto notes when they're created. */
export function labelForBlock(b: Block, index: number): string {
  const trim = (s: string, n = 48) => (s.length > n ? s.slice(0, n - 1) + '…' : s)
  switch (b.type) {
    case 'prose': {
      const first = (b.md || '').trim().split('\n')[0]?.replace(/^#+\s*/, '') ?? ''
      return trim(first || `Prose #${index + 1}`)
    }
    case 'callout':
      return trim(b.title || `Callout #${index + 1}`)
    case 'code':
      return trim(b.file || `Code #${index + 1}`)
    case 'diff':
      return trim(b.file || `Diff #${index + 1}`)
    case 'chart':
      return trim(b.title || b.chartKey)
    case 'image':
      return trim(b.title || b.alt || `Image #${index + 1}`)
    case 'steps':
      return trim(b.title || `Steps #${index + 1}`)
    case 'compare':
      return trim(b.title || `Comparison #${index + 1}`)
    case 'timeline':
      return trim(b.title || `Timeline #${index + 1}`)
    case 'takeaway':
      return trim(b.title || 'Key takeaways')
  }
}
