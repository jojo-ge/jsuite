// Backfilling the session ledger from transcripts that predate it. Sessions
// dispatched before jTicket chose their ids left no ledger row, but their
// transcripts are still under ~/.claude/projects/<repo-slug*>/ and their
// first user message is the hand-off jTicket sent: `/jimplement TICK-7 …`,
// `/jorchestrate PROJ-4 …`, the batch prompt naming its tickets, the merge
// sweep naming its PRs, the slice/outcome report prompts. This matches those
// shapes to the projects' tickets and writes ledger rows marked
// source: 'backfill'. Idempotent: a session already in the ledger is skipped.
//
// What it can't know is left at its default: effort is '', loop is inferred
// from the auto loop's history when the session started inside a recorded
// loop (else 0), and the model comes from the transcript itself.
import type { Project, Store } from './store'
import { projectRepoPath } from './codebases'
import { loadSessions, saveSessions, sessionRow, type SessionRecord, type SessionRole } from './sessions'
import { listTranscriptPaths, readTranscript, transcriptDirsForRepo } from './transcripts'

export interface BackfillResult {
  scanned: number
  added: number
  skipped: { known: number; unmatched: number; unreadable: number }
  byRole: Record<string, number>
}

interface Match {
  role: SessionRole
  projectId: string
  projectKey: string
  ticketKey: string
  tickets: string[]
  orchestrator: number
}

const KEY = /\b([A-Z][A-Z0-9]*-\d+)\b/g

/**
 * What a first prompt says the session was. `projects` are the codebase's
 * projects, with their ticket keys. Exported for the tests.
 */
export function matchPrompt(prompt: string, projects: { id: string; key: string; tickets: string[] }[]): Match | null {
  const text = prompt.replace(/<[^>]+>/g, ' ')
  const keys = [...new Set([...text.matchAll(KEY)].map((m) => m[1]!))]
  const byTicket = new Map<string, { id: string; key: string }>()
  const byProject = new Map<string, { id: string; key: string }>()
  for (const p of projects) {
    byProject.set(p.key, p)
    for (const t of p.tickets) byTicket.set(t, p)
  }
  const projectKey = keys.find((k) => byProject.has(k))
  const project = projectKey ? byProject.get(projectKey)! : null
  const ticketKeys = keys.filter((k) => byTicket.has(k))
  const slash = /(?:^|\s|<command-name>)(\/j[a-z-]+)\b/.exec(text)?.[1] ?? /^\s*(\/j[a-z-]+)/.exec(text)?.[1] ?? ''

  const base = (role: SessionRole, p: { id: string; key: string }, ticketKey = '', tickets: string[] = ticketKey ? [ticketKey] : []): Match => ({ role, projectId: p.id, projectKey: p.key, ticketKey, tickets, orchestrator: 0 })

  if (slash === '/jorchestrate' && project) {
    const slot = /orchestrator\s*(?:=|\s)\s*(\d+)/i.exec(text)
    return { ...base('orchestrate', project, '', ticketKeys), orchestrator: slot ? parseInt(slot[1]!, 10) : 1 }
  }
  if (slash === '/jslice-report' && project) return base('slice-report', project)
  if (slash === '/jrunplan' && project) return base('runplan-build', project)
  if (slash === '/jreview-assess' && project) return base('pr-assess', project)
  if (slash === '/jdiff-tour' && project) return base('tour', project)
  if (/outcome report for jTicket project/i.test(text) && project) return base('outcome-report', project)
  if (/\bone session\b|\bone after another\b/i.test(text) && ticketKeys.length > 1) {
    const p = byTicket.get(ticketKeys[0]!)!
    return base('batch', p, '', ticketKeys)
  }
  if (slash === '/jimplement' && ticketKeys.length) {
    const first = /\/jimplement\s+([A-Z][A-Z0-9]*-\d+)/.exec(text)?.[1]
    const key = first && byTicket.has(first) ? first : ticketKeys[0]!
    return base('implement', byTicket.get(key)!, key)
  }
  if (/\bmerge sweep\b|open local jTicket PRs|\bland (every|each|the) (open )?(local )?PRs?\b|\/api\/prs\/[^/\s]+\/merge\b/i.test(text) && project) return base('merge', project)
  // A hand-off that names exactly one ticket and reads like work (branch, PR, worktree) — an older implement prompt.
  if (ticketKeys.length === 1 && /\bworktree\b|\bPR\b|\bbranch\b|\bimplement/i.test(text)) return base('implement', byTicket.get(ticketKeys[0]!)!, ticketKeys[0]!)
  return null
}

/** The loop a session started inside, from the project's auto history (0 when none). */
export function loopAt(project: Project, startedAt: string): number {
  for (const h of project.auto?.history ?? []) {
    if (h.startedAt <= startedAt && startedAt <= h.endedAt) return h.loop
  }
  const auto = project.auto
  if (auto?.enabled && auto.loopStartedAt && auto.loopStartedAt <= startedAt) return auto.loop
  return 0
}

/**
 * Scan every codebase's transcript directories (or one project's codebase)
 * and add ledger rows for the sessions that look like jTicket dispatches.
 */
export async function backfillSessions(store: Store, opts: { projectIds?: Set<string> } = {}): Promise<BackfillResult> {
  const existing = loadSessions()
  const known = new Set(existing.map((s) => s.id))
  const result: BackfillResult = { scanned: 0, added: 0, skipped: { known: 0, unmatched: 0, unreadable: 0 }, byRole: {} }
  const added: SessionRecord[] = []

  // Codebases in scope, each with its projects and their ticket keys.
  const repos = new Map<string, Project[]>()
  for (const p of store.projects) {
    if (opts.projectIds && !opts.projectIds.has(p.id)) continue
    const repo = projectRepoPath(p)
    if (!repo) continue
    repos.set(repo, [...(repos.get(repo) ?? []), p])
  }
  for (const [repo, projects] of repos) {
    // The whole codebase's projects are candidates — a session in scope by
    // repo may belong to a project outside opts.projectIds; those are skipped below.
    const all = store.projects.filter((p) => projectRepoPath(p) === repo)
    const candidates = all.map((p) => ({ id: p.id, key: p.key, tickets: store.tickets.filter((t) => t.projectId === p.id).map((t) => t.key) }))
    const allowed = new Set(projects.map((p) => p.id))
    for (const dir of transcriptDirsForRepo(repo)) {
      for (const path of listTranscriptPaths(dir)) {
        result.scanned++
        const id = path.slice(path.lastIndexOf('/') + 1, -'.jsonl'.length)
        if (known.has(id)) {
          result.skipped.known++
          continue
        }
        const t = await readTranscript(path)
        if (!t || !t.firstPrompt) {
          result.skipped.unreadable++
          continue
        }
        const m = matchPrompt(t.firstPrompt, candidates)
        if (!m || !allowed.has(m.projectId)) {
          result.skipped.unmatched++
          continue
        }
        const project = all.find((p) => p.id === m.projectId)!
        const row = sessionRow({
          id,
          role: m.role,
          ticketKey: m.ticketKey,
          tickets: m.tickets,
          projectId: m.projectId,
          projectKey: m.projectKey,
          repo,
          cwd: t.cwd || dir,
          loop: loopAt(project, t.startedAt),
          orchestrator: m.orchestrator,
          model: t.models[0] ?? '',
          dispatchedAt: t.startedAt,
          source: 'backfill',
        })
        added.push(row)
        known.add(id)
        result.added++
        result.byRole[m.role] = (result.byRole[m.role] ?? 0) + 1
      }
    }
  }
  if (added.length) saveSessions([...existing, ...added])
  return result
}
