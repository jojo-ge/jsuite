import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { appDataDir } from '@jsuite/data'
import type { ReviewRating } from './aiArtifacts'

export interface SavedRating {
  repo: string
  number: string
  rating: ReviewRating
  createdAt: string
  // sha256 of the full diff the rating was computed from — lets the
  // consistency review pass detect "same code, new run" and pin the score.
  diffHash?: string
}

// Latest rating per resolved repo path + PR number; re-rating overwrites.
const DIR = appDataDir('jdiff')
const FILE = join(DIR, 'ratings.json')

export function loadRating(repo: string, number: string): SavedRating | null {
  return loadAll().find((r) => r.repo === repo && r.number === number) ?? null
}

export function saveRating(entry: SavedRating): void {
  mkdirSync(DIR, { recursive: true })
  const rest = loadAll().filter((r) => !(r.repo === entry.repo && r.number === entry.number))
  writeFileSync(FILE, JSON.stringify([...rest, entry], null, 2))
}

function loadAll(): SavedRating[] {
  try {
    return JSON.parse(readFileSync(FILE, 'utf8'))
  } catch {
    return []
  }
}
