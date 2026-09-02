import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { appDataDir } from '@jsuite/data'
import type { HuntIssue } from '../../app/utils/tour'

// The hunt manifest for a target: every suspected bug and vulnerability the
// /jdiff-hunt scoping session found in the change, worst first. Saving a new
// manifest starts a new generation — per-issue tours from the old one are
// deleted so the UI never mixes issues from different hunts.
export interface SavedHunt {
  repo: string
  number: string
  overview: string
  issues: HuntIssue[]
  createdAt: string
}

// Latest hunt per resolved repo path + target; re-hunting overwrites. An
// empty issues array is a real result (a clean hunt), not a miss.
const DIR = appDataDir('jdiff')
const FILE = join(DIR, 'hunts.json')

export function loadHunt(repo: string, number: string): SavedHunt | null {
  return loadAll().find((h) => h.repo === repo && h.number === number) ?? null
}

export function saveHunt(entry: SavedHunt): void {
  mkdirSync(DIR, { recursive: true })
  const rest = loadAll().filter((h) => !(h.repo === entry.repo && h.number === entry.number))
  writeFileSync(FILE, JSON.stringify([...rest, entry], null, 2))
  deleteIssueTours(entry.repo, entry.number)
}

/** The issues a walker session is dispatched for: the high-severity ones. */
export function walkableIssues(issues: HuntIssue[]): HuntIssue[] {
  return issues.filter((i) => i.severity === 'high')
}

function loadAll(): SavedHunt[] {
  try {
    return JSON.parse(readFileSync(FILE, 'utf8'))
  } catch {
    return []
  }
}
