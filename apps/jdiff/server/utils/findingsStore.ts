import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { appDataDir } from '@jsuite/data'
import type { Finding } from '../../app/utils/findings'

export interface SavedFindings {
  repo: string
  number: string
  findings: Finding[]
  createdAt: string
}

// Latest findings per resolved repo path + target; re-running overwrites.
// An empty findings array is a real result (a clean review), not a miss.
const DIR = appDataDir('jdiff')
const FILE = join(DIR, 'findings.json')

export function loadFindings(repo: string, number: string): SavedFindings | null {
  return loadAll().find((r) => r.repo === repo && r.number === number) ?? null
}

export function saveFindings(entry: SavedFindings): void {
  mkdirSync(DIR, { recursive: true })
  const rest = loadAll().filter((r) => !(r.repo === entry.repo && r.number === entry.number))
  writeFileSync(FILE, JSON.stringify([...rest, entry], null, 2))
}

function loadAll(): SavedFindings[] {
  try {
    return JSON.parse(readFileSync(FILE, 'utf8'))
  } catch {
    return []
  }
}
