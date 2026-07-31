import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { appDataDir } from '@jsuite/data'
import type { SavedAsk } from '../../app/utils/askQuestions'

// Asks live in a single local JSON file, keyed by resolved repo path + PR
// number. This is per-machine state, deliberately not pushed to GitHub.
const DIR = appDataDir('jdiff')
const FILE = join(DIR, 'asks.json')

export function loadAsks(repo: string, number: string): SavedAsk[] {
  return loadAll().filter((a) => a.repo === repo && a.number === number)
}

export function saveAsk(ask: SavedAsk): void {
  mkdirSync(DIR, { recursive: true })
  const all = loadAll()
  all.push(ask)
  writeFileSync(FILE, JSON.stringify(all, null, 2))
}

function loadAll(): SavedAsk[] {
  try {
    return JSON.parse(readFileSync(FILE, 'utf8'))
  } catch {
    return []
  }
}
