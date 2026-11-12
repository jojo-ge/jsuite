// The run journal on disk: one JSON line per event, appended as the store
// saves a project's loop state that differs from the one it last saved.
// app/utils/runJournal.ts derives the events; this file keeps the "last
// saved" state, names the run, and reads the file back.
//
// Called from saveStore (store.ts) and nowhere else — so this module must not
// import the store (it would be a cycle), and it must never throw: a journal
// that can't be written is logged and the save goes ahead.
import { appendFileSync, existsSync, readFileSync } from 'node:fs'
import { appDataFile } from '@jsuite/data'
import type { AutoLoop } from '../../app/utils/autoLoop'
import { journalEvents, newRunId, type JournalLine } from '../../app/utils/runJournal'

export const JOURNAL_FILE = appDataFile('jticket', 'harness', 'run-journal.jsonl')

/** What the journal needs of a project. */
export interface JournalProject {
  id: string
  key: string
  repo: string
  auto: AutoLoop | null
}

/** projectId → the loop state last saved, as JSON (the store's objects are mutated in place, so a reference won't do). */
const lastSaved = new Map<string, string>()
/** projectId → the run in progress. */
const openRuns = new Map<string, string>()
let primed = false

/** Forget everything held in memory — tests, and the id migration (its keys are project ids). */
export function resetJournalState(): void {
  lastSaved.clear()
  openRuns.clear()
  primed = false
}

export function readJournal(file = JOURNAL_FILE): JournalLine[] {
  if (!existsSync(file)) return []
  const out: JournalLine[] = []
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue
    try {
      const l = JSON.parse(line)
      if (l && typeof l.kind === 'string' && typeof l.runId === 'string') out.push(l as JournalLine)
    } catch {
      // A torn line (the server died mid-append): skip it.
    }
  }
  return out
}

/**
 * The id of the project's run in progress. After a restart mid-run it is read
 * back from the journal (the project's last line, unless that closed its run);
 * a run already going when the journal first existed gets an id from now.
 */
function runIdFor(p: JournalProject, at: string): string {
  const known = openRuns.get(p.id)
  if (known) return known
  const last = readJournal().findLast((l) => l.projectId === p.id)
  const id = last && last.kind !== 'run-ended' ? last.runId : newRunId(p.key, at)
  openRuns.set(p.id, id)
  return id
}

/**
 * Journal what changed in the projects about to be saved. `readPrevious` is
 * the store as it sits on disk — read once, the first time through, so a
 * restart (or a dev reload) diffs against the truth rather than against
 * nothing. Returns the lines it appended.
 */
export function journalStoreSave(projects: JournalProject[], readPrevious: () => JournalProject[], at = new Date().toISOString()): JournalLine[] {
  try {
    if (!primed) {
      for (const p of readPrevious()) lastSaved.set(p.id, JSON.stringify(p.auto ?? null))
      primed = true
    }
    const lines: JournalLine[] = []
    for (const p of projects) {
      const json = JSON.stringify(p.auto ?? null)
      const was = lastSaved.get(p.id)
      if (was === json) continue
      lastSaved.set(p.id, json)
      const before = was ? (JSON.parse(was) as AutoLoop | null) : null
      for (const e of journalEvents(before, p.auto, at)) {
        if (e.kind === 'run-started') openRuns.set(p.id, newRunId(p.key, at))
        lines.push({ ...e, runId: runIdFor(p, at), projectId: p.id, projectKey: p.key, repo: p.repo })
        if (e.kind === 'run-ended') openRuns.delete(p.id)
      }
    }
    if (lines.length) appendFileSync(JOURNAL_FILE, lines.map((l) => JSON.stringify(l)).join('\n') + '\n', 'utf8')
    return lines
  } catch (err) {
    console.error('[jticket] run journal: could not record a save —', err)
    return []
  }
}
