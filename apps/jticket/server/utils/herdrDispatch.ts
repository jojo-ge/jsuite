// The herdr hand-offs jTicket makes, as functions: a ticket's session, a batch
// of tickets in one session, the project's merge sweep, and the ticket branch a
// local-PR hand-off names.
//
// The endpoints (tickets/[id]/herdr, projects/[id]/herdr-merge,
// tickets/[id]/branch) are thin wrappers over these, and the auto loop
// (autoLoop.ts) calls them directly — one code path, so a loop dispatch is
// guarded, framed and laid out exactly like a button press. They throw h3
// errors; callers that must not throw catch them.
import type { Store, Ticket, Project } from './store'
import {
  resolveBuildPlanPrompt,
  resolveMergePrompt,
  resolveTicketPrompt,
  type PromptOverrides,
} from '../../app/utils/prompts'

export interface TicketDispatch {
  workspaceId: string
  tabId: string
  paneId: string
  agent: string
  ticket: string
}

/**
 * Run one whole workspace → pane → claude sequence under the suite-wide herdr
 * lock (no other dispatch, in this process or another app, interleaves with
 * it), logging a failure before rethrowing — toasts and auto.paused are not
 * the only record of why a ticket never started.
 */
async function lockedDispatch<T>(what: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await withHerdrLock(fn)
  } catch (err: any) {
    console.error(`[jticket] herdr dispatch failed for ${what}:`, err?.message ?? err)
    throw err
  }
}

/** `--model` / `--effort` for claude, or nothing (the CLI's defaults) when neither is pinned. */
function modelArgs(model?: string, effort?: string) {
  const args = [...(model ? ['--model', model] : []), ...(effort ? ['--effort', effort] : [])]
  return args.length ? { args } : undefined
}

/**
 * Start a ticket's claude session in the project's herdr workspace. Refuses
 * mid-transfer (409) and peer-owned (403) tickets; frames collaborator content
 * on shared projects. `ownTab` gives it a single-pane tab (HITL work) instead
 * of a quarter of a packed 'PROJ-n' tab.
 */
export async function dispatchTicketSession(
  store: Store,
  ticket: Ticket,
  prompt: string,
  opts: { ownTab?: boolean; model?: string; effort?: string } = {},
): Promise<TicketDispatch> {
  const project = store.projects.find((p) => p.id === ticket.projectId)
  if (!project) throw createError({ statusCode: 400, statusMessage: `${ticket.key} has no project — herdr workspaces are per-project` })

  // Hard invariant (spec DOC-30): no remote-originated content ever reaches a
  // dispatch endpoint. A peer-owned ticket is refused here at the API — if its
  // work is yours to do, mint your own ticket (a human rewrite in between).
  // Transfer is the one point where remote-authored text would become
  // runnable by local agents — a pending offer stays undispatchable until the
  // human has reviewed and accepted it (spec DOC-30). Before the peer guard:
  // the transferor's pending copy is peer-owned too, and "frozen" is why.
  const frozen = transferFreezeError(ticket, project.share)
  if (frozen) throw createError({ statusCode: 409, statusMessage: frozen })
  const refused = peerDispatchError(ticket, project.share)
  if (refused) throw createError({ statusCode: 403, statusMessage: refused })

  // Untrusted-content framing (spec DOC-30): dispatching a local ticket on a
  // shared project still puts peer-authored text in front of the agent — the
  // project's description (creator-owned metadata) and any peer-owned doc the
  // ticket links. It rides along wrapped as collaborator content: data, not
  // instructions. Local-only projects pass the prompt through byte-identical.
  const framing = await collaboratorFramingFor(ticket, project, store.docs, readDoc)
  const framedPrompt = framedDispatchPrompt(prompt, framing)

  const cwd = resolveRepoDir(project.repo)

  return lockedDispatch(ticket.key, async () => {
    const { workspaceId, freshTab } = await ensureHerdrWorkspace(project.title, cwd)
    let tabId: string, paneId: string
    if (opts.ownTab) {
      const label = `${project.key} · ${ticket.key}`
      if (freshTab) {
        await herdrJson(['tab', 'rename', freshTab.tabId, label])
        ;({ tabId, paneId } = freshTab)
      } else {
        ;({ tabId, paneId } = await createJobTab(workspaceId, label, cwd))
      }
    } else {
      ;({ tabId, paneId } = await acquireTicketPane(workspaceId, project.key, cwd, freshTab))
    }
    // Name the pane after its ticket: in a packed 2×2 tab the four panes are
    // otherwise four identical claude spinners with nothing saying which ticket
    // each is working. Cosmetic and best-effort — never fails the dispatch.
    await renamePane(paneId, ticket.title ? `${ticket.key} · ${ticket.title}` : ticket.key)
    const agent = await startClaudeIn(paneId, ticket.key, framedPrompt, modelArgs(opts.model, opts.effort))

    return { workspaceId, tabId, paneId, agent, ticket: ticket.key }
  })
}

/**
 * Start the merge sweep in a NEW single-pane tab of the project's workspace
 * ('PROJ-n · merge') — land every open local PR on the integration branch,
 * rebasing through conflicts.
 */
export async function dispatchMergeSession(project: Project, prompt: string, opts: { model?: string; effort?: string } = {}) {
  return dispatchProjectSession(project, 'merge', prompt, opts)
}

/**
 * Start a project-level session (not tied to one ticket) in a NEW single-pane
 * tab of the project's workspace, named 'PROJ-n · <job>'.
 */
export async function dispatchProjectSession(
  project: Project,
  job: string,
  prompt: string,
  opts: { model?: string; effort?: string; agent?: string; paneLabel?: string } = {},
) {
  const cwd = resolveRepoDir(project.repo)
  const label = `${project.key} · ${job}`
  return lockedDispatch(label, async () => {
    const { workspaceId, freshTab } = await ensureHerdrWorkspace(project.title, cwd)
    // A fresh workspace's root tab becomes the job's tab; otherwise cut a new one.
    let tabId: string, paneId: string
    if (freshTab) {
      await herdrJson(['tab', 'rename', freshTab.tabId, label])
      ;({ tabId, paneId } = freshTab)
    } else {
      ;({ tabId, paneId } = await createJobTab(workspaceId, label, cwd))
    }
    await renamePane(paneId, opts.paneLabel ?? label)
    const agent = await startClaudeIn(paneId, opts.agent ?? `${job}-${project.key}`, prompt, modelArgs(opts.model, opts.effort))
    return { workspaceId, tabId, paneId, agent, project: project.key }
  })
}

/** How a batch names its tab: the first keys, then a count for the rest. */
export function batchJobLabel(keys: string[], shown = 3): string {
  const head = keys.slice(0, shown).join(', ')
  const rest = keys.length - shown
  return `batch · ${head}${rest > 0 ? ` +${rest}` : ''}`
}

/**
 * Start ONE claude session over several tickets — the board's One session
 * button. A single-pane tab of the project's workspace ('PROJ-n · batch · …'),
 * running the batch prompt the client built (each ticket's own resolved
 * hand-off inlined, see resolveBatchPrompt). Not the orchestrator: no claims,
 * no budget, no subagents — one agent working a short list in order, for the
 * small tasks and decision tickets that don't each deserve a model of their own.
 *
 * Every ticket must be the project's; the same per-ticket guards as a single
 * dispatch apply (mid-transfer 409, peer-owned 403), and the collaborator
 * framing covers the peer docs every ticket in the batch links.
 */
export async function dispatchBatchSession(
  store: Store,
  project: Project,
  tickets: Ticket[],
  prompt: string,
  opts: { model?: string; effort?: string } = {},
) {
  if (!tickets.length) throw createError({ statusCode: 400, statusMessage: 'a batch needs at least one ticket' })
  for (const ticket of tickets) {
    if (ticket.projectId !== project.id) {
      throw createError({ statusCode: 400, statusMessage: `${ticket.key} is not a ${project.key} ticket — a batch runs in one project's workspace` })
    }
    const frozen = transferFreezeError(ticket, project.share)
    if (frozen) throw createError({ statusCode: 409, statusMessage: frozen })
    const refused = peerDispatchError(ticket, project.share)
    if (refused) throw createError({ statusCode: 403, statusMessage: refused })
  }

  // One appendix for the whole batch: the peer docs linked from any of its
  // tickets' descriptions, framed once (spec DOC-30), same as a single dispatch.
  const framing = await collaboratorFramingFor(
    { description: tickets.map((t) => t.description).join('\n'), projectId: project.id },
    project,
    store.docs,
    readDoc,
  )
  const framedPrompt = framedDispatchPrompt(prompt, framing)

  const keys = tickets.map((t) => t.key)
  const res = await dispatchProjectSession(project, batchJobLabel(keys), framedPrompt, {
    ...opts,
    agent: `batch-${project.key}`,
    paneLabel: `${project.key} · batch · ${keys.join(', ')}`,
  })
  return { ...res, tickets: keys }
}

/**
 * Cut the ticket's work branch: a LOCAL branch off the project's integration
 * branch, recorded on the ticket (ticket.branch — the caller saves the store).
 * Idempotent: a branch that already exists (here or cut by hand) is adopted.
 */
export async function cutTicketBranch(store: Store, ticket: Ticket, requested = '') {
  const project = store.projects.find((p) => p.id === ticket.projectId)
  if (!project) throw createError({ statusCode: 400, statusMessage: `${ticket.key} has no project — branches are cut in a project's repo` })

  // Cutting a branch writes ticket.branch and is the first step of working a
  // ticket — peer-owned work isn't yours to start.
  // Mid-transfer = frozen: starting work on an unanswered offer would put a
  // branch on a ticket that may bounce back or change hands (spec DOC-30).
  // Before the peer guard — the transferor's pending copy is peer-owned too.
  const frozen = transferFreezeError(ticket, project.share)
  if (frozen) throw createError({ statusCode: 409, statusMessage: frozen })
  const refused = peerWriteError(ticket, project.share)
  if (refused) throw createError({ statusCode: 403, statusMessage: refused })

  const path = resolveRepoDir(project.repo)
  const base = project.integrationBranch.trim()
  if (!base) throw createError({ statusCode: 400, statusMessage: `${project.key} has no integration branch — cut that first` })

  const branch = requested.trim() || ticket.branch.trim() || suggestTicketBranchName(ticket)
  if (!isSafeRef(branch)) throw createError({ statusCode: 400, statusMessage: `not a usable branch name: ${branch}` })

  // The local integration branch is the source of truth for ticket work; only
  // when it hasn't been checked out here yet does origin's copy stand in.
  const existed = !!(await branchOid(path, branch))
  if (!existed) {
    const startPoint = (await branchOid(path, base)) ? base : `refs/remotes/origin/${base}`
    await run('git', ['branch', branch, startPoint], path)
  }

  ticket.branch = branch
  ticket.updatedAt = now()
  return { branch, base, path, created: !existed, adopted: existed }
}

// ── Prompts, server-side ────────────────────────────────────────────────────
// The browser normally renders hand-off prompts (it owns the target picker).
// The auto loop has no browser, so it resolves the same layers here from the
// store: ticket → project → codebase → global default → built-in.

function codebasePromptsFor(store: Store, project: Project): { prompts?: PromptOverrides } | null {
  const path = projectRepoPath(project)
  return path ? (findKnownRepo(store, path) ?? null) : null
}

/** The standard local-PR hand-off (`standard:local`) for one ticket, every layer applied. */
export function localPrPrompt(store: Store, project: Project, ticket: Ticket): string {
  return resolveTicketPrompt({
    ticket,
    project: { ...project, repoPath: projectRepoPath(project) },
    mode: 'standard',
    target: 'local',
    defaults: store.promptDefaults,
    codebase: codebasePromptsFor(store, project),
  }).text
}

/** The Run setup tab's Build hand-off (`runplan:build`), layers 2–5 applied. */
export function buildPlanPrompt(store: Store, project: Project): string {
  return resolveBuildPlanPrompt({ ...project, repoPath: projectRepoPath(project) }, store.promptDefaults, codebasePromptsFor(store, project))
}

/** The project's merge sweep over `prKeys`, layers 2–5 applied. */
export function mergeSweepPrompt(store: Store, project: Project, prKeys: string[]): string {
  return resolveMergePrompt(
    { ...project, repoPath: projectRepoPath(project) },
    prKeys,
    store.promptDefaults,
    codebasePromptsFor(store, project),
  )
}
