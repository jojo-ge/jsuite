import { readFile, writeFile, readdir, mkdir, rename, rm, stat } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { appDataDir } from '@jsuite/data'

// One chart per pretty-printed file in .data/jchart/<key>.json, with review notes
// in a sidecar .data/jchart/<key>.notes.json. Both are plain JSON so an LLM can
// read them straight off disk without going through the HTTP API.
const DATA_DIR = appDataDir('jchart')

export interface ChartSource {
  type: 'mermaid' | 'blank'
  text: string
}

export interface ChartScene {
  elements: unknown[]
  appState: Record<string, unknown>
  files: Record<string, unknown>
}

export interface Chart {
  format: 'j-chart'
  version: 1
  key: string
  title: string
  createdAt: string
  updatedAt: string
  source: ChartSource
  /** Empty elements means "not converted yet" — the editor imports on first open. */
  scene: ChartScene
}

export interface ChartNote {
  id: string
  elementId: string
  label: string
  text: string
}

export interface ChartNotes {
  general: string
  notes: ChartNote[]
}

export interface ChartMeta {
  key: string
  title: string
  createdAt: string
  updatedAt: string
  elementCount: number
  noteCount: number
  hasSource: boolean
  imported: boolean
}

export function sanitizeKey(key: unknown): string {
  return String(key ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
}

/** Turn a human title into a key, guaranteeing something non-empty. */
export function keyFromTitle(title: string): string {
  return sanitizeKey(title) || 'chart'
}

async function ensureDir() {
  if (!existsSync(DATA_DIR)) await mkdir(DATA_DIR, { recursive: true })
}

/**
 * Write through a temp file and rename over the target.
 *
 * The editor saves on a debounce and the Mermaid import saves as well, so two
 * PUTs for one chart can be in flight at once. Writing both straight to the
 * path lets the shorter one land inside the longer one's bytes — the JSON ends
 * where it ends and the tail of the previous save is still sitting after it,
 * which is an unparseable file and a chart that silently vanishes from the
 * list. A rename is atomic: the loser is overwritten whole, never spliced.
 */
async function writeAtomic(path: string, body: string): Promise<void> {
  const tmp = `${path}.${process.pid}.${Math.random().toString(36).slice(2, 8)}.tmp`
  try {
    await writeFile(tmp, body, 'utf8')
    await rename(tmp, path)
  } catch (err) {
    await rm(tmp, { force: true }).catch(() => {})
    throw err
  }
}

const chartPath = (key: string) => join(DATA_DIR, sanitizeKey(key) + '.json')
const notesPath = (key: string) => join(DATA_DIR, sanitizeKey(key) + '.notes.json')

export function chartFilePath(key: string): string {
  return chartPath(key)
}

export async function uniqueKey(base: string): Promise<string> {
  await ensureDir()
  const root = sanitizeKey(base) || 'chart'
  if (!existsSync(chartPath(root))) return root
  for (let i = 2; i < 500; i++) {
    const candidate = `${root}-${i}`
    if (!existsSync(chartPath(candidate))) return candidate
  }
  return `${root}-${Date.now()}`
}

export function blankChart(opts: { key: string; title: string; source?: ChartSource }): Chart {
  const now = new Date().toISOString()
  return {
    format: 'j-chart',
    version: 1,
    key: opts.key,
    title: opts.title,
    createdAt: now,
    updatedAt: now,
    source: opts.source ?? { type: 'blank', text: '' },
    scene: { elements: [], appState: {}, files: {} },
  }
}

export async function readChart(key: string): Promise<Chart | null> {
  const p = chartPath(key)
  if (!existsSync(p)) return null
  try {
    return JSON.parse(await readFile(p, 'utf8')) as Chart
  } catch {
    return null
  }
}

export async function writeChart(key: string, chart: Chart): Promise<void> {
  await ensureDir()
  await writeAtomic(chartPath(key), JSON.stringify(chart, null, 2) + '\n')
}

export async function deleteChart(key: string): Promise<void> {
  for (const p of [chartPath(key), notesPath(key)]) {
    if (existsSync(p)) await rm(p)
  }
}

export async function readNotes(key: string): Promise<ChartNotes> {
  const p = notesPath(key)
  if (!existsSync(p)) return { general: '', notes: [] }
  try {
    const parsed = JSON.parse(await readFile(p, 'utf8')) as Partial<ChartNotes>
    return {
      general: typeof parsed.general === 'string' ? parsed.general : '',
      notes: Array.isArray(parsed.notes) ? (parsed.notes as ChartNote[]) : [],
    }
  } catch {
    return { general: '', notes: [] }
  }
}

export async function writeNotes(key: string, notes: ChartNotes): Promise<void> {
  await ensureDir()
  await writeAtomic(notesPath(key), JSON.stringify(notes, null, 2) + '\n')
}

export async function listCharts(): Promise<ChartMeta[]> {
  await ensureDir()
  const files = (await readdir(DATA_DIR)).filter((f) => f.endsWith('.json') && !f.endsWith('.notes.json'))
  const out: ChartMeta[] = []
  for (const f of files) {
    const key = f.replace(/\.json$/, '')
    try {
      const doc = JSON.parse(await readFile(join(DATA_DIR, f), 'utf8')) as Chart
      if (doc.format !== 'j-chart') continue
      const { notes } = await readNotes(key)
      const elements = Array.isArray(doc.scene?.elements) ? doc.scene.elements : []
      out.push({
        key,
        title: doc.title || key,
        createdAt: doc.createdAt,
        updatedAt: doc.updatedAt,
        // Deleted shapes stay in the array as tombstones; don't count them.
        elementCount: elements.filter((e) => !(e as { isDeleted?: boolean })?.isDeleted).length,
        noteCount: notes.filter((n) => (n.text || '').trim()).length,
        hasSource: doc.source?.type === 'mermaid' && !!doc.source.text.trim(),
        imported: elements.length > 0,
      })
    } catch {
      // An unparseable file just doesn't appear in the list.
    }
  }
  // Newest activity first — this list is a "what was I just looking at" index.
  return out.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
}

/** mtime of the chart file, used to warn when disk drifted from the open tab. */
export async function chartMtime(key: string): Promise<number | null> {
  const p = chartPath(key)
  if (!existsSync(p)) return null
  return (await stat(p)).mtimeMs
}
