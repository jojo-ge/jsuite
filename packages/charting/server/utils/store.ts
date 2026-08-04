import { readFile, readdir, mkdir, rm, stat } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { appDataDir, writeJsonAtomic } from '@jsuite/data'
import { snapshotData } from '@jsuite/data/history'

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
  /**
   * Stable identity — minted once, never derived from anything mutable. `key`
   * is a *slug*: it comes from the title and is unique only against this
   * machine's pool, so two people diagramming "Deploy topology" both land on
   * `deploy-topology`. Anything reconciling two pools (publish, sync, import)
   * matches on `id`; `key` is only an address.
   */
  id: string
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
  id: string
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

/**
 * Mint a chart identity. Random, never derived from the key or title —
 * deriving it would give two independently-drawn "Deploy topology" charts the
 * same id and silently merge them the first time two pools meet.
 */
export function newChartId(): string {
  return `cht_${randomUUID().replace(/-/g, '')}`
}

/**
 * Charts written before ids existed get one stamped in on first read. The
 * write-back is what makes the id *stable* — re-minting per read would be no
 * better than the key it replaces.
 */
async function backfillChartId(key: string, chart: Chart): Promise<Chart> {
  if (typeof chart.id === 'string' && chart.id) return chart
  const stamped = { ...chart, id: newChartId() }
  await writeChart(key, stamped)
  return stamped
}

export function blankChart(opts: { key: string; title: string; source?: ChartSource }): Chart {
  const now = new Date().toISOString()
  return {
    format: 'j-chart',
    version: 1,
    id: newChartId(),
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
    return await backfillChartId(key, JSON.parse(await readFile(p, 'utf8')) as Chart)
  } catch {
    return null
  }
}

export async function writeChart(key: string, chart: Chart): Promise<void> {
  await ensureDir()
  const withId: Chart = chart.id ? chart : { ...chart, id: newChartId() }
  await writeJsonAtomic(chartPath(key), withId)
  snapshotData(`chart: ${key}`)
}

export async function deleteChart(key: string): Promise<void> {
  for (const p of [chartPath(key), notesPath(key)]) {
    if (existsSync(p)) await rm(p)
  }
  snapshotData(`chart: delete ${key}`)
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
  await writeJsonAtomic(notesPath(key), notes)
  snapshotData(`chart notes: ${key}`)
}

export async function listCharts(): Promise<ChartMeta[]> {
  await ensureDir()
  const files = (await readdir(DATA_DIR)).filter((f) => f.endsWith('.json') && !f.endsWith('.notes.json'))
  const out: ChartMeta[] = []
  for (const f of files) {
    const key = f.replace(/\.json$/, '')
    try {
      const parsed = JSON.parse(await readFile(join(DATA_DIR, f), 'utf8')) as Chart
      if (parsed.format !== 'j-chart') continue
      const doc = await backfillChartId(key, parsed)
      const { notes } = await readNotes(key)
      const elements = Array.isArray(doc.scene?.elements) ? doc.scene.elements : []
      out.push({
        id: doc.id,
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
