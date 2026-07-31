import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { appDataDir } from '@jsuite/data'
import type { Tour } from '../../app/utils/tour'

export interface SavedTour {
  repo: string
  number: string
  tour: Tour
  createdAt: string
}

// Latest tour per resolved repo path + PR number; regenerating overwrites.
const DIR = appDataDir('jdiff')
const FILE = join(DIR, 'tours.json')

export function loadTour(repo: string, number: string): SavedTour | null {
  return loadAll().find((t) => t.repo === repo && t.number === number) ?? null
}

export function saveTour(entry: SavedTour): void {
  mkdirSync(DIR, { recursive: true })
  const rest = loadAll().filter((t) => !(t.repo === entry.repo && t.number === entry.number))
  writeFileSync(FILE, JSON.stringify([...rest, entry], null, 2))
}

function loadAll(): SavedTour[] {
  try {
    return JSON.parse(readFileSync(FILE, 'utf8'))
  } catch {
    return []
  }
}
