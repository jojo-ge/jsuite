import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { appDataDir, appDataFile } from '@jsuite/data'

// One pretty-printed file at .data/jagent/jagent.json — the jTicket store
// layout, so a human (or an LLM) can read the fleet's state straight off disk.
// Function names are deliberately distinct from the @jsuite/diff layer's
// auto-imported exports (run, loadDiff, …), which share this Nitro namespace.

export interface Workspace {
  id: string
  name: string
  repo: string // absolute path to the main checkout
  base: string // branch runs are cut from and PRs target
  setup: string // command run once in each fresh worktree
  fleet: boolean // drain the queue unattended
  fleetSlots: number // max concurrently RUNNING agents
  maxWorktrees: number // max live worktrees (running + waiting for review)
  queue: QueueEntry[] // drained top-down by fleet mode
  createdAt: string
  updatedAt: string
}

export interface QueueEntry {
  key: string // TICK-7
  force: boolean // dispatch even if blocked
  error?: string // why the last dispatch attempt failed (entry is kept, skipped)
}

export type RunStatus =
  | 'starting' // claimed; worktree + setup + spawn in flight
  | 'running' // live agent in tmux
  | 'needs_review' // resolution landed on the ticket; agent idle at its prompt
  | 'accepted' // PR opened, ticket done, worktree gone
  | 'discarded' // torn down, ticket released
  | 'failed' // setup/spawn/session died — error says why

export interface Run {
  id: string
  workspaceId: string
  ticketKey: string
  ticketTitle: string
  branch: string
  worktree: string // absolute path
  session: string // tmux session name
  status: RunStatus
  // The ticket's resolution as of dispatch (or last nudge). needs_review fires
  // when the live resolution is non-empty AND differs from this — so a nudged
  // run doesn't instantly flip back on its old resolution.
  resolutionSeen: string
  resolution: string // latest resolution text observed on the ticket
  needsYou: boolean // a permission prompt is on screen
  needsYouSince: string | null
  lastActivityAt: string | null // pane last changed (idle badge feeds off this)
  diffStat: { files: number; additions: number; deletions: number } | null
  error: string | null
  prUrl: string | null
  createdAt: string
  updatedAt: string
}

interface State {
  workspaces: Workspace[]
  runs: Run[]
}

const FILE = () => appDataFile('jagent', 'jagent.json')

export function loadAgentState(): State {
  try {
    return JSON.parse(readFileSync(FILE(), 'utf8'))
  } catch {
    return { workspaces: [], runs: [] }
  }
}

export function saveAgentState(state: State): void {
  writeFileSync(FILE(), JSON.stringify(state, null, 2))
}

// All mutations funnel through here: load, mutate, persist, return.
export function mutateAgentState<T>(fn: (state: State) => T): T {
  const state = loadAgentState()
  const out = fn(state)
  saveAgentState(state)
  return out
}

export function newAgentId(prefix: string): string {
  return `${prefix}_${randomBytes(4).toString('hex')}`
}

export function nowIso(): string {
  return new Date().toISOString()
}

export function findWorkspace(state: State, id: string): Workspace {
  const ws = state.workspaces.find((w) => w.id === id)
  if (!ws) throw createError({ statusCode: 404, message: `no such workspace: ${id}` })
  return ws
}

export function findRun(state: State, id: string): Run {
  const run = state.runs.find((r) => r.id === id)
  if (!run) throw createError({ statusCode: 404, message: `no such run: ${id}` })
  return run
}

// A run whose worktree is still on disk.
export function isLive(run: Run): boolean {
  return run.status === 'starting' || run.status === 'running' || run.status === 'needs_review'
}

// A run holding a fleet slot: live agents, minus reviews and minus agents
// that have been stuck on a permission prompt past the grace period.
const NEEDS_YOU_GRACE_MS = 2 * 60 * 1000

export function holdsSlot(run: Run): boolean {
  if (run.status !== 'starting' && run.status !== 'running') return false
  if (run.needsYou && run.needsYouSince) {
    return Date.now() - Date.parse(run.needsYouSince) < NEEDS_YOU_GRACE_MS
  }
  return true
}

// Where a workspace's worktrees live: state, not source — never inside an app.
export function worktreeRoot(ws: Workspace): string {
  const dir = join(appDataDir('jagent'), 'worktrees', ws.id)
  mkdirSync(dir, { recursive: true })
  return dir
}

export function runDir(runId: string): string {
  const dir = join(appDataDir('jagent'), 'runs', runId)
  mkdirSync(dir, { recursive: true })
  return dir
}
