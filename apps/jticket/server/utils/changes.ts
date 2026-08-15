import { mkdirSync, statSync, watch } from 'node:fs'
import { basename, dirname } from 'node:path'
import { DATA_FILE } from './store'

/**
 * "Something in the tracker moved" — the signal /api/stream broadcasts so open
 * boards stop needing a manual refresh.
 *
 * It is deliberately built on **watching the store file**, not on hooking
 * saveStore(): the store is one human-editable JSON file, so a hand edit is as
 * real a change as a PATCH from an agent, and a watcher catches both with no
 * coupling to the write paths. Callers get a revision number that only ever
 * goes up; what actually changed is left to the client to diff, which keeps
 * this a notification channel rather than a second copy of the data model.
 */

type Listener = (revision: number) => void

const listeners = new Set<Listener>()
let revision = 0
// mtime+size of the last state we announced — the watcher fires on writes that
// change nothing (and, on some platforms, twice per write), so the stat is what
// decides whether a revision is real.
let stamp = ''
let watching = false
let pending: ReturnType<typeof setTimeout> | null = null

function fileStamp(): string {
  try {
    const s = statSync(DATA_FILE)
    return `${s.mtimeMs}:${s.size}`
  } catch {
    return ''
  }
}

// Coalesce a burst of writes (a bulk import rewrites the file once per entity)
// into a single revision — clients refetch the whole store anyway.
function scheduleCheck(): void {
  if (pending) return
  pending = setTimeout(() => {
    pending = null
    const next = fileStamp()
    if (next === stamp) return
    stamp = next
    revision += 1
    for (const listener of [...listeners]) {
      try {
        listener(revision)
      } catch {
        // A broken listener is a dead connection; never let it stop the others.
      }
    }
  }, 80)
  pending.unref?.()
}

// Watch the *directory*, not the file: a directory watch survives the file
// being replaced rather than truncated, and it also works before the store has
// ever been written.
function watchStore(): void {
  if (watching) return
  watching = true
  const dir = dirname(DATA_FILE)
  const file = basename(DATA_FILE)
  stamp = fileStamp()
  try {
    mkdirSync(dir, { recursive: true })
    const watcher = watch(dir, (_event, name) => {
      if (!name || name === file) scheduleCheck()
    })
    watcher.on('error', () => {
      watcher.close()
      watching = false
    })
    watcher.unref?.()
  } catch {
    // No watcher (odd filesystem, permissions) — the stream still connects and
    // heartbeats; the board just falls back to manual refresh.
    watching = false
  }
}

export function currentRevision(): number {
  watchStore()
  return revision
}

export function onStoreChange(cb: Listener): () => void {
  watchStore()
  listeners.add(cb)
  return () => {
    listeners.delete(cb)
  }
}
