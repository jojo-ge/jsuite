import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { appDataDir } from '@jsuite/data'
import type { AiJobFailure } from './aiJobs'

// Why the last run for a target failed. The job registry is in-memory, so a
// finished job's reason died with it — and in dev, a Nitro rebuild wiped it
// mid-session. Failures are the one thing a reviewer needs *after* the fact,
// so they outlive the process here, next to the artifacts they replace.
export interface SavedFailure {
  repo: string
  number: string
  failures: AiJobFailure[]
}

// Latest failure set per resolved repo path + target; a new run overwrites.
const DIR = appDataDir('jdiff')
const FILE = join(DIR, 'failures.json')

export function loadFailures(repo: string, number: string): AiJobFailure[] {
  return loadAll().find((r) => r.repo === repo && r.number === number)?.failures ?? []
}

export function saveFailures(entry: SavedFailure): void {
  mkdirSync(DIR, { recursive: true })
  const rest = loadAll().filter((r) => !(r.repo === entry.repo && r.number === entry.number))
  // A run that failed for no recorded reason should clear the old entry
  // rather than leave a stale one behind to be read as current.
  const rows = entry.failures.length ? [...rest, entry] : rest
  writeFileSync(FILE, JSON.stringify(rows, null, 2))
}

function loadAll(): SavedFailure[] {
  try {
    return JSON.parse(readFileSync(FILE, 'utf8'))
  } catch {
    return []
  }
}
