import { readFile, readdir, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { appDataDir, writeJsonAtomic } from '@jsuite/data'
import { snapshotData } from '@jsuite/data/history'
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

/**
 * Mint a document identity. Random, never derived from the key or title —
 * deriving it would give two independently-authored "Q3 Planning" documents
 * the same id and silently merge them the first time two pools meet.
 */
export function newDocId(): string {
  return `doc_${randomUUID().replace(/-/g, '')}`
}

/**
 * Documents written before ids existed get one stamped in on first read. The
 * write-back is what makes the id *stable* — an id that were re-minted per
 * read would be no better than the key it replaces.
 */
async function backfillDocId(key: string, doc: Explainer): Promise<Explainer> {
  if (typeof doc.id === 'string' && doc.id) return doc
  const stamped = { ...doc, id: newDocId() }
  await writeDoc(key, stamped)
  return stamped
}

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
    return await backfillDocId(key, JSON.parse(await readFile(p, 'utf8')) as Explainer)
  } catch {
    return null
  }
}

export async function writeDoc(key: string, doc: Explainer): Promise<void> {
  const withId: Explainer = doc.id ? doc : { ...doc, id: newDocId() }
  await writeJsonAtomic(docPath(key), withId)
  snapshotData(`document: ${key}`)
}

export async function deleteDoc(key: string): Promise<void> {
  for (const p of [docPath(key), docNotesPath(key)]) {
    if (existsSync(p)) await rm(p)
  }
  snapshotData(`document: delete ${key}`)
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
  await writeJsonAtomic(docNotesPath(key), notes)
  snapshotData(`document notes: ${key}`)
}

export async function listDocs(): Promise<ExplainerMeta[]> {
  const files = (await readdir(DATA_DIR)).filter((f) => f.endsWith('.json') && !f.endsWith('.notes.json'))
  const out: ExplainerMeta[] = []
  for (const f of files) {
    const key = f.replace(/\.json$/, '')
    try {
      const parsed = JSON.parse(await readFile(join(DATA_DIR, f), 'utf8')) as Explainer
      if (parsed.format !== 'j-explain') continue
      const doc = await backfillDocId(key, parsed)
      const { notes } = await readDocNotes(key)
      const blocks = Array.isArray(doc.blocks) ? doc.blocks : []
      out.push({
        id: doc.id,
        key,
        title: doc.title || key,
        subtitle: doc.subtitle,
        kicker: doc.kicker,
        createdAt: doc.createdAt,
        updatedAt: doc.updatedAt,
        blockCount: blocks.length,
        chartCount: blocks.filter((b) => b.type === 'chart').length,
        noteCount: notes.filter((n) => (n.text || '').trim()).length,
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
