// Build-tour sessions in flight, and why the last one failed. Ported from
// jDiff's dispatch registry (herdrReview.ts) and failure store, cut to the one
// job jTicket keeps: the detail tour.
//
// The registry only *tracks* a run. The claude session belongs to herdr and
// outlives a jTicket restart, so losing an entry loses the spinner, never the
// tour: the artifact POST saves whether or not the run is remembered.
//
// Failures outlive the process in `.data/jdiff/failures.json`, jDiff's file and
// shape (rows per repo + target key, `jobKind: 'detail'`), next to the tours.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { appDataDir } from '@jsuite/data'

export interface TourJob {
  repo: string
  key: string
  startedAt: number
  agent: string
  tabId: string
}

/** The one job kind jTicket runs; jDiff's file holds others for the same targets. */
export const TOUR_JOB = 'detail'

/** A session that never posts (closed pane, wedged prompt) is dropped after this, with a recorded reason. */
export const TOUR_STALE_MS = 60 * 60 * 1000

const jobs = new Map<string, TourJob>()
const keyOf = (repo: string, key: string) => `${repo}\n${key}`

function sweep(now = Date.now()): void {
  for (const [k, j] of jobs) {
    if (now - j.startedAt < TOUR_STALE_MS) continue
    jobs.delete(k)
    recordTourFailure(j.repo, j.key, `the tour session (agent ${j.agent}) never reported back — its herdr pane may have been closed or interrupted`)
  }
}

export function getTourJob(repo: string, key: string): TourJob | null {
  sweep()
  return jobs.get(keyOf(repo, key)) ?? null
}

/** A new run: tracked, and the last run's failure cleared. */
export function registerTourJob(job: TourJob): TourJob {
  jobs.set(keyOf(job.repo, job.key), job)
  clearTourFailure(job.repo, job.key)
  return job
}

export function clearTourJob(repo: string, key: string): TourJob | null {
  const j = jobs.get(keyOf(repo, key)) ?? null
  jobs.delete(keyOf(repo, key))
  return j
}

// ── Failures ──

interface AiJobFailure {
  jobKind: string
  tool?: string
  message: string
  at: string
}
interface FailureRow {
  repo: string
  number: string
  failures: AiJobFailure[]
}

const FILE = join(appDataDir('jdiff'), 'failures.json')

function loadRows(): FailureRow[] {
  try {
    const rows = JSON.parse(readFileSync(FILE, 'utf8'))
    return Array.isArray(rows) ? rows : []
  } catch {
    return []
  }
}

function writeRow(repo: string, key: string, failures: AiJobFailure[]): void {
  const rest = loadRows().filter((r) => !(r.repo === repo && r.number === key))
  mkdirSync(join(FILE, '..'), { recursive: true })
  writeFileSync(FILE, JSON.stringify(failures.length ? [...rest, { repo, number: key, failures }] : rest, null, 2))
}

const rowFailures = (repo: string, key: string) =>
  loadRows().find((r) => r.repo === repo && r.number === key)?.failures ?? []

/** Why the last tour build for a target failed ('' when it didn't). */
export function tourFailure(repo: string, key: string): string {
  return rowFailures(repo, key).find((f) => f.jobKind === TOUR_JOB)?.message ?? ''
}

export function recordTourFailure(repo: string, key: string, message: string): void {
  const kept = rowFailures(repo, key).filter((f) => f.jobKind !== TOUR_JOB)
  writeRow(repo, key, [...kept, { jobKind: TOUR_JOB, tool: 'tour', message: message.slice(0, 500), at: new Date().toISOString() }])
}

export function clearTourFailure(repo: string, key: string): void {
  const all = rowFailures(repo, key)
  const kept = all.filter((f) => f.jobKind !== TOUR_JOB)
  if (kept.length !== all.length) writeRow(repo, key, kept)
}
