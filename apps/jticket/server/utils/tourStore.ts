// The guided-tour store, carried over from jDiff: `.data/jdiff/tours.json`, one
// row per (resolved repo path, target key, variant), latest wins. The file and
// its shape are jDiff's unchanged, so every detail tour jDiff saved still walks
// here. Only detail tours survived the move: jDiff's overview and chain rows
// stay in the file but nothing in jTicket reads them.
// Like jReview's records (`.data/jreview/`), the data stays where its app put it.
//
// Target keys follow jDiff's: a GitHub PR is its bare number, a branch is
// 'branch/<name>'. jTicket adds local PRs ('PR-n') — server/utils/tours.ts.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { appDataDir } from '@jsuite/data'
import type { Tour, TourVariant } from '../../app/utils/tour'

export interface SavedTour {
  repo: string
  /** The target key ('123', 'branch/<name>', 'PR-n'). Named `number` because that is jDiff's row shape. */
  number: string
  /** Absent on rows written before jDiff had variants — read as 'overview'. */
  variant?: TourVariant
  tour: Tour
  createdAt: string
  /** The head commit the tour was written against. Absent on jDiff's rows and on tours built before jTicket recorded it. */
  headOid?: string
}

const DIR = appDataDir('jdiff')
const FILE = join(DIR, 'tours.json')

const variantOf = (t: SavedTour): TourVariant => t.variant ?? 'overview'

export function loadTour(repo: string, number: string, variant: TourVariant = 'detail'): SavedTour | null {
  return loadAll().find((t) => t.repo === repo && t.number === number && variantOf(t) === variant) ?? null
}

/** Save a tour, replacing only the same (repo, target, variant) row. */
export function saveTour(entry: SavedTour): void {
  const variant = variantOf(entry)
  writeAll([
    ...loadAll().filter((t) => !(t.repo === entry.repo && t.number === entry.number && variantOf(t) === variant)),
    entry,
  ])
}

function writeAll(rows: SavedTour[]): void {
  mkdirSync(DIR, { recursive: true })
  writeFileSync(FILE, JSON.stringify(rows, null, 2))
}

function loadAll(): SavedTour[] {
  try {
    const rows = JSON.parse(readFileSync(FILE, 'utf8'))
    return Array.isArray(rows) ? rows : []
  } catch {
    return []
  }
}
