import { readFile, writeFile, readdir, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { appDataDir } from '@jsuite/data'
import type { GrillMeta, GrillSession } from '../../app/utils/grillTypes'

// One session per pretty-printed file in .data/jgrilling/<key>.json — the
// jChart/jExplain store layout, so an LLM can read sessions straight off disk.
// Function names are deliberately distinct from the charting and documents
// stores (readChart, readDoc, …), which are auto-imported into this server
// context too via the extended layers.
const DATA_DIR = appDataDir('jgrilling')

export type * from '../../app/utils/grillTypes'

export function sanitizeGrillKey(key: unknown): string {
  return String(key ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
}

const grillPath = (key: string) => join(DATA_DIR, sanitizeGrillKey(key) + '.json')

export async function uniqueGrillKey(base: string): Promise<string> {
  const root = sanitizeGrillKey(base) || 'session'
  if (!existsSync(grillPath(root))) return root
  for (let i = 2; i < 500; i++) {
    const candidate = `${root}-${i}`
    if (!existsSync(grillPath(candidate))) return candidate
  }
  return `${root}-${Date.now()}`
}

export async function readGrill(key: string): Promise<GrillSession | null> {
  const p = grillPath(key)
  if (!existsSync(p)) return null
  try {
    return JSON.parse(await readFile(p, 'utf8')) as GrillSession
  } catch {
    return null
  }
}

export async function writeGrill(session: GrillSession): Promise<void> {
  session.updatedAt = new Date().toISOString()
  await writeFile(grillPath(session.key), JSON.stringify(session, null, 2) + '\n', 'utf8')
}

export async function deleteGrill(key: string): Promise<void> {
  const p = grillPath(key)
  if (existsSync(p)) await rm(p)
}

export async function listGrills(): Promise<GrillMeta[]> {
  const files = (await readdir(DATA_DIR)).filter((f) => f.endsWith('.json'))
  const out: GrillMeta[] = []
  for (const f of files) {
    try {
      const s = JSON.parse(await readFile(join(DATA_DIR, f), 'utf8')) as GrillSession
      if (s.format !== 'j-grilling') continue
      out.push({
        key: s.key,
        title: s.title,
        status: s.status,
        turnCount: s.turns.length,
        answeredCount: s.turns.filter((t) => t.answer != null).length,
        documentKey: s.documentKey,
        createdAt: s.createdAt,
        updatedAt: s.updatedAt,
      })
    } catch {
      // An unparseable file just doesn't appear in the list.
    }
  }
  return out.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
}

/** The open question, if the latest turn hasn't been answered yet. */
export function openTurn(session: GrillSession) {
  const last = session.turns[session.turns.length - 1]
  return last && last.answer == null ? last : null
}
