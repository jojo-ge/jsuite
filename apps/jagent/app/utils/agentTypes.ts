// Client mirrors of the server store types (server/utils/agentStore.ts) plus
// the jTicket shapes the board picker renders.
import type { FilePayload } from '@jsuite/diff/types'

export type { FilePayload }

export interface QueueEntry {
  key: string
  force: boolean
  error?: string
}

export interface Workspace {
  id: string
  name: string
  repo: string
  base: string
  setup: string
  fleet: boolean
  fleetSlots: number
  maxWorktrees: number
  queue: QueueEntry[]
  createdAt: string
  updatedAt: string
  live?: number
  reviews?: number
}

export type RunStatus = 'starting' | 'running' | 'needs_review' | 'accepted' | 'discarded' | 'failed'

export interface Run {
  id: string
  workspaceId: string
  ticketKey: string
  ticketTitle: string
  branch: string
  worktree: string
  session: string
  status: RunStatus
  resolutionSeen: string
  resolution: string
  needsYou: boolean
  needsYouSince: string | null
  lastActivityAt: string | null
  diffStat: { files: number; additions: number; deletions: number } | null
  error: string | null
  prUrl: string | null
  createdAt: string
  updatedAt: string
}

export interface BoardTicket {
  id: string
  key: string
  title: string
  status: 'todo' | 'in_progress' | 'done'
  epicId: string | null
  assignee: string
  resolution: string
  blocked?: boolean
  claimed?: boolean
  frontier?: boolean
}

export const STATUS_META: Record<RunStatus, { label: string; dot: string; badge: string }> = {
  starting: { label: 'starting', dot: 'bg-amber-400 animate-pulse', badge: 'text-amber-600 dark:text-amber-400' },
  running: { label: 'running', dot: 'bg-emerald-500', badge: 'text-emerald-600 dark:text-emerald-400' },
  needs_review: { label: 'needs review', dot: 'bg-violet-500', badge: 'text-violet-600 dark:text-violet-400' },
  accepted: { label: 'accepted', dot: 'bg-slate-400', badge: 'text-slate-500' },
  discarded: { label: 'discarded', dot: 'bg-slate-300 dark:bg-slate-600', badge: 'text-slate-400' },
  failed: { label: 'failed', dot: 'bg-red-500', badge: 'text-red-600 dark:text-red-400' },
}

export function agoLabel(iso: string | null): string {
  if (!iso) return ''
  const s = Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / 1000))
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}m`
  if (s < 86400) return `${Math.floor(s / 3600)}h`
  return `${Math.floor(s / 86400)}d`
}
