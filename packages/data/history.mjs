// @jsuite/data/history — a git repo inside `.data`, so local state has a past.
//
// Every app overwrites entity files in place, which means that without this
// there is no record of what a file looked like before the last write. That
// costs three things:
//
//   • undo — an agent that mangles a document has destroyed it
//   • diffing — "what changed since I last published?" is unanswerable
//   • a *base version* — merging a local and a remote edit needs the common
//     ancestor, and two-way merges can only ever ask a human to pick a side
//
// This is deliberately NOT the parent repo: `.data` is gitignored there, so a
// nested repo is invisible to it and to `git status` at the workspace root.
//
// Best-effort by design. History is a safety net, never a gate — if git is
// missing, the repo is wedged, or a commit races another process, the write
// that triggered it has already succeeded and must not be failed retroactively.
// Set JSUITE_HISTORY=0 to disable.

import { execFile } from 'node:child_process'
import { existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { dataRoot } from './index.mjs'

const run = promisify(execFile)

const enabled = () => process.env.JSUITE_HISTORY !== '0'

/** Set once git proves unusable, so we stop shelling out on every write. */
let disabled = false
let initialised = false

async function git(args, cwd) {
  return run('git', args, {
    cwd,
    // Keep the caller's git identity and hooks out of it — this repo is
    // machine-local bookkeeping, not something anyone signs or pushes.
    env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' },
  })
}

async function ensureRepo(root) {
  if (initialised) return true
  if (existsSync(join(root, '.git'))) {
    initialised = true
    return true
  }
  await git(['init', '-q'], root)
  await git(['config', 'user.name', 'jSuite'], root)
  await git(['config', 'user.email', 'jsuite@localhost'], root)
  // Atomic writes land a transient `<file>.tmp` beside the target; it is never
  // state, only an artefact of write-then-rename.
  writeFileSync(join(root, '.gitignore'), '*.tmp\n', 'utf8')
  initialised = true
  return true
}

// Bursts (a canvas autosaving, an import writing 40 files) collapse into one
// commit: messages queue up while a run is in flight and the next run takes
// them all. Without this, dragging one box would produce a commit per frame.
let pending = []
let inFlight = null

async function commitPending(root) {
  const messages = pending
  pending = []
  if (!messages.length) return

  const unique = [...new Set(messages)]
  const subject = unique.length === 1 ? unique[0] : `${unique.length} changes`
  const body = unique.length === 1 ? [] : ['-m', unique.join('\n')]

  await git(['add', '-A'], root)
  // Nothing staged means nothing actually changed on disk — a write that
  // re-wrote identical bytes. `git commit` would exit non-zero; skip instead.
  const staged = await git(['diff', '--cached', '--quiet'], root).then(
    () => true,
    (err) => err.code !== 1,
  )
  if (staged) return
  await git(['commit', '-q', '-m', subject, ...body], root)
}

/**
 * Record the current state of `.data` as a commit. Fire-and-forget: callers
 * don't await it, and it never rejects.
 *
 * @param {string} message what changed, e.g. `jticket: TICK-5`
 */
export function snapshotData(message) {
  if (!enabled() || disabled) return
  pending.push(String(message || 'update'))
  if (inFlight) return

  const root = dataRoot()
  inFlight = (async () => {
    try {
      await ensureRepo(root)
      // Drain: a message queued while committing gets its own pass rather than
      // waiting for the next write to come along and carry it.
      while (pending.length) await commitPending(root)
    } catch (err) {
      // ENOENT means no git binary — there's no recovering from that, so stop
      // trying. Anything else (a lock race, a wedged index) may well clear, so
      // leave history enabled and let the next write retry.
      if (err?.code === 'ENOENT') disabled = true
      pending = []
    } finally {
      inFlight = null
    }
  })()
}

/** Wait for any in-flight snapshot. For tests and shutdown, not request paths. */
export async function flushHistory() {
  while (inFlight) await inFlight
}
