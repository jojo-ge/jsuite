import { readFile, writeFile, readdir, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { appDataDir } from '@jsuite/data'
import type { CodeMap, MapMeta } from '../../app/utils/mapTypes'

// One map per pretty-printed file in .data/jmap/<key>.json — the jChart/
// jExplain store layout, so an LLM can read maps straight off disk.
// Function names are deliberately distinct from the charting and documents
// stores (readChart, readDoc, …), which are auto-imported into this server
// context too via the extended layers.
const DATA_DIR = appDataDir('jmap')

export type * from '../../app/utils/mapTypes'

export function sanitizeMapKey(key: unknown): string {
  return String(key ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
}

const mapPath = (key: string) => join(DATA_DIR, sanitizeMapKey(key) + '.json')

export async function uniqueMapKey(base: string): Promise<string> {
  const root = sanitizeMapKey(base) || 'map'
  if (!existsSync(mapPath(root))) return root
  for (let i = 2; i < 500; i++) {
    const candidate = `${root}-${i}`
    if (!existsSync(mapPath(candidate))) return candidate
  }
  return `${root}-${Date.now()}`
}

export async function readMap(key: string): Promise<CodeMap | null> {
  const p = mapPath(key)
  if (!existsSync(p)) return null
  try {
    const map = JSON.parse(await readFile(p, 'utf8')) as CodeMap
    // v1 maps (in-app scoping/dispatch) predate the jTicket flow and can't be
    // driven any more — surface them unreadable rather than half-working.
    if (map.version !== 2) return null
    return map
  } catch {
    return null
  }
}

export async function writeMap(map: CodeMap): Promise<void> {
  map.updatedAt = new Date().toISOString()
  await writeFile(mapPath(map.key), JSON.stringify(map, null, 2) + '\n', 'utf8')
}

export async function deleteMap(key: string): Promise<void> {
  const p = mapPath(key)
  if (existsSync(p)) await rm(p)
}

export async function listMaps(): Promise<MapMeta[]> {
  const files = (await readdir(DATA_DIR)).filter((f) => f.endsWith('.json'))
  const out: MapMeta[] = []
  for (const f of files) {
    try {
      const m = JSON.parse(await readFile(join(DATA_DIR, f), 'utf8')) as CodeMap
      if (m.format !== 'j-map' || m.version !== 2) continue
      out.push({
        key: m.key,
        title: m.title,
        repoPath: m.repoPath,
        projectKey: m.projectKey,
        status: m.status,
        createdAt: m.createdAt,
        updatedAt: m.updatedAt,
      })
    } catch {
      // An unparseable file just doesn't appear in the list.
    }
  }
  return out.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
}
