// Setting a project's worktree up is minutes of work — `git worktree add` over
// a monorepo, then a fleet slot claim, then a stack boot that walks deps,
// devenv and codegen. None of that fits in a request, so it runs here as a
// background job and reports by writing the project's worktree record.
//
// The UI needs no polling for that: the store is a watched file (changes.ts),
// so every step's save reaches open boards over /api/stream on its own.
import { createError } from 'h3'
import {
  adoptFleetSlot,
  bootFleetSlot,
  ensureWorktree,
  fleetLauncher,
  isSafeSlug,
  readFleetSlot,
  suggestWorktreeSlug,
  worktreeDir,
} from './worktrees'
import { loadStore, now, saveStore } from './store'
import type { Project, ProjectWorktree, WorktreeStatus } from './store'

// projectId → the job in flight. One per project: a second POST while a boot
// is running joins the existing job rather than racing it.
const running = new Map<string, Promise<void>>()

/** Is a worktree job in flight for this project, in THIS process? */
export function isJobRunning(projectId: string): boolean {
  return running.has(projectId)
}

export interface WorktreeJobInput {
  projectId: string
  repoPath: string
  branch: string
  slug: string
  dir: string
  /** Boot the fleet slot's stack after claiming it. */
  boot: boolean
}

/**
 * Read-modify-write one project's worktree record. Every step reloads the
 * store first: the job outlives the request that started it, and tickets, PRs
 * and merges keep being written while a boot runs.
 */
function patch(projectId: string, fields: Partial<ProjectWorktree>): void {
  const store = loadStore()
  const project = store.projects.find((p) => p.id === projectId)
  if (!project?.worktree) return
  project.worktree = { ...project.worktree, ...fields, updatedAt: now() }
  project.updatedAt = now()
  saveStore(store)
}

function step(projectId: string, status: WorktreeStatus): void {
  patch(projectId, { status })
}

/**
 * Start (or join) the job that brings a project's worktree up. Returns
 * immediately; the caller has already written the 'creating' record that makes
 * the work visible.
 */
export function startWorktreeJob(input: WorktreeJobInput): void {
  if (running.has(input.projectId)) return
  const job = runJob(input)
    .catch((err: any) => {
      const message = String(err?.stderr || err?.statusMessage || err?.message || err).trim()
      patch(input.projectId, { status: 'failed', error: message.slice(0, 500) })
    })
    .finally(() => { running.delete(input.projectId) })
  running.set(input.projectId, job)
}

/**
 * Write the project's "setting up" worktree record and hand back the thunk
 * that starts the work. Two callers want this — POST .../worktree and the
 * branch cut that offers a worktree in the same breath — and both must save
 * the store before the job runs, since every step reloads it.
 */
export function beginWorktree(
  project: Project,
  repoPath: string,
  branch: string,
  opts: { slug?: string; boot?: boolean } = {},
): { worktree: ProjectWorktree; start: () => void } {
  const existing = project.worktree
  const slug = (opts.slug ?? '').trim() || existing?.slug || suggestWorktreeSlug(project)
  if (!isSafeSlug(slug)) {
    throw createError({
      statusCode: 400,
      statusMessage: `not a usable worktree name: ${slug} (lowercase, digits and hyphens)`,
    })
  }
  const dir = worktreeDir(repoPath, slug)
  const boot = opts.boot !== false
  const ts = now()

  const worktree: ProjectWorktree = {
    path: dir,
    slug,
    // A retry under the same name keeps whatever the last attempt claimed.
    slot: existing?.slug === slug ? (existing?.slot ?? 0) : 0,
    host: existing?.slug === slug ? (existing?.host ?? '') : '',
    status: 'creating',
    error: '',
    createdAt: existing?.createdAt || ts,
    updatedAt: ts,
  }
  project.worktree = worktree
  project.updatedAt = ts

  return {
    worktree,
    start: () => startWorktreeJob({ projectId: project.id, repoPath, branch, slug, dir, boot }),
  }
}

async function runJob(input: WorktreeJobInput): Promise<void> {
  const { projectId, repoPath, branch, slug, dir, boot } = input

  step(projectId, 'creating')
  const { path } = await ensureWorktree(repoPath, branch, dir)
  patch(projectId, { path })

  // No fleet in this repo: the checkout IS the feature, and it is done.
  if (!fleetLauncher(repoPath)) {
    patch(projectId, { status: 'ready', error: '' })
    return
  }

  step(projectId, 'adopting')
  await adoptFleetSlot(path, slug)
  const claimed = readFleetSlot(repoPath, path)
  if (claimed) patch(projectId, { slot: claimed.slot, host: claimed.host })

  if (!boot) {
    patch(projectId, { status: 'ready', error: '' })
    return
  }

  step(projectId, 'booting')
  await bootFleetSlot(path, slug)
  const booted = readFleetSlot(repoPath, path)
  patch(projectId, {
    status: 'ready',
    error: '',
    ...(booted ? { slot: booted.slot, host: booted.host } : {}),
  })
}

/**
 * A job's status is only true while its process is alive. After a restart a
 * record left mid-flight describes work that no longer exists — say so instead
 * of spinning forever. Returns the corrected record, or null when nothing
 * needed correcting.
 */
export function reconcileWorktree(
  projectId: string,
  worktree: ProjectWorktree | null,
): ProjectWorktree | null {
  if (!worktree) return null
  const inFlight = worktree.status === 'creating' || worktree.status === 'adopting' || worktree.status === 'booting'
  if (!inFlight || isJobRunning(projectId)) return null
  return {
    ...worktree,
    status: 'failed',
    error: `the ${worktree.status} step was interrupted (jTicket restarted) — retry it`,
    updatedAt: now(),
  }
}
