import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { appDataDir } from '@jsuite/data'
import { CHAIN_SLUG } from './aiArtifacts'
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
// the detail tour, the per-chain tours and the per-issue hunt tours coexist
// and age independently.
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
  deleteVariantTours(repo, number, 'chain:')
}

/** A new hunt manifest likewise invalidates every prior issue tour. */
export function deleteIssueTours(repo: string, number: string): void {
  deleteVariantTours(repo, number, 'issue:')
}

function deleteVariantTours(repo: string, number: string, prefix: string): void {
  writeAll(loadAll().filter((t) =>
    !(t.repo === repo && t.number === number && variantOf(t).startsWith(prefix))))
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

// ?variant= → a TourVariant, rejecting anything that isn't one. Distinct from
// aiArtifacts' parseTourVariant, which additionally checks a POSTed variant
// against the target's saved manifests; a read only needs the grammar. The
// two must not share a name — Nitro auto-imports by name.
export function parseVariantParam(raw: unknown): TourVariant {
  if (raw === undefined || raw === 'overview') return 'overview'
  if (raw === 'detail') return 'detail'
  for (const prefix of ['chain:', 'issue:']) {
    if (typeof raw === 'string' && raw.startsWith(prefix) && CHAIN_SLUG.test(raw.slice(prefix.length))) {
      return raw as TourVariant
    }
  }
  throw createError({ statusCode: 400, message: 'bad variant' })
}
