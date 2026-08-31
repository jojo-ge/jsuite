import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { appDataDir } from '@jsuite/data'

// A failure recorded against the last run of a job for a target — either
// reported by the herdr session itself (per tool), or recorded here when a
// dispatch went stale without ever posting results.
export interface AiJobFailure {
  // Which dispatch failed: 'analyze', 'detail', 'chains-scope', 'chain:<slug>'.
  jobKind: string
  // Set for a per-tool failure ('rating', 'risk', …); absent when the whole
  // run died.
  tool?: string
  message: string
  at: string
}

// Why the last run failed, per job kind. The dispatch registry is in-memory,
// so a finished run's reason died with it — and in dev, a Nitro rebuild wiped
// it mid-session. Failures are the one thing a reviewer needs *after* the
// fact, so they outlive the process here, next to the artifacts they replace.
export interface SavedFailure {
  repo: string
  number: string
  failures: AiJobFailure[]
}

// One row per resolved repo path + target, holding failures for every job
// kind. A new run of a job replaces only that job's failures (jobs for the
// same target fail independently: a dead chain walker must not erase why the
// analyze run failed, and vice versa).
const DIR = appDataDir('jdiff')
const FILE = join(DIR, 'failures.json')

export function loadFailures(repo: string, number: string): AiJobFailure[] {
  return loadAll().find((r) => r.repo === repo && r.number === number)?.failures ?? []
}

/** Record failures, replacing prior ones with the same jobKind. */
export function appendFailures(repo: string, number: string, failures: AiJobFailure[]): void {
  if (!failures.length) return
  const kinds = new Set(failures.map((f) => f.jobKind))
  const kept = loadFailures(repo, number).filter((f) => !kinds.has(f.jobKind))
  writeRow(repo, number, [...kept, ...failures])
}

/** Drop failures whose jobKind matches; a superseding run clears its slate. */
export function clearFailures(repo: string, number: string, match: (jobKind: string) => boolean): void {
  writeRow(repo, number, loadFailures(repo, number).filter((f) => !match(f.jobKind)))
}

function writeRow(repo: string, number: string, failures: AiJobFailure[]): void {
  mkdirSync(DIR, { recursive: true })
  const rest = loadAll().filter((r) => !(r.repo === repo && r.number === number))
  // An empty failure list clears the old row rather than leaving a stale one
  // behind to be read as current.
  const rows = failures.length ? [...rest, { repo, number, failures }] : rest
  writeFileSync(FILE, JSON.stringify(rows, null, 2))
}

function loadAll(): SavedFailure[] {
  try {
    return JSON.parse(readFileSync(FILE, 'utf8'))
  } catch {
    return []
  }
}
