import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { appDataDir } from '@jsuite/data'
import type { Tour, TourVariant } from '../../app/utils/tour'

export interface SavedTour {
  repo: string
  number: string
  // Absent on rows written before variants existed — read as 'overview'.
  variant?: TourVariant
  tour: Tour
  createdAt: string
}

// Latest tour per resolved repo path + target + variant; regenerating a
// variant overwrites only that variant, so the analyze run's overview tour,
// the detail tour, and the per-chain tours coexist and age independently.
const DIR = appDataDir('jdiff')
const FILE = join(DIR, 'tours.json')

const variantOf = (t: SavedTour): TourVariant => t.variant ?? 'overview'

export function loadTour(repo: string, number: string, variant: TourVariant = 'overview'): SavedTour | null {
  return loadAll().find((t) => t.repo === repo && t.number === number && variantOf(t) === variant) ?? null
}

/** Which variants exist for a target, and when each landed. */
export function loadTourVariants(repo: string, number: string): { variant: TourVariant; createdAt: string }[] {
  return loadAll()
    .filter((t) => t.repo === repo && t.number === number)
    .map((t) => ({ variant: variantOf(t), createdAt: t.createdAt }))
}

export function saveTour(entry: SavedTour): void {
  const variant = variantOf(entry)
  writeAll([
    ...loadAll().filter((t) => !(t.repo === entry.repo && t.number === entry.number && variantOf(t) === variant)),
    entry,
  ])
}

/** A new chains manifest invalidates every prior chain tour for the target. */
export function deleteChainTours(repo: string, number: string): void {
  writeAll(loadAll().filter((t) =>
    !(t.repo === repo && t.number === number && variantOf(t).startsWith('chain:'))))
}

function writeAll(rows: SavedTour[]): void {
  mkdirSync(DIR, { recursive: true })
  writeFileSync(FILE, JSON.stringify(rows, null, 2))
}

function loadAll(): SavedTour[] {
  try {
    return JSON.parse(readFileSync(FILE, 'utf8'))
  } catch {
    return []
  }
}
