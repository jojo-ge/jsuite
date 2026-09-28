// Auto mode's engine: gathers what a tick needs to know, asks planStep
// (app/utils/autoLoop.ts) what happens next, and does it.
//
// Discipline, borrowed from jReview's review watcher:
//   - the store is the only state; every tick re-reads it, so a restart
//     resumes wherever the loop was
//   - CLAIM, THEN ACT: a step's new state is saved before its side effect
//     (dispatch, review request) runs, so a second tick — or a restart
//     mid-dispatch — never fires it twice
//   - never throw: a failed side effect becomes `paused`, shown on the page
//     with a Retry step button
//   - store writes are synchronous load → mutate → save with no await in
//     between (the store has no lock); async work happens outside them
import { basename } from 'node:path'
import {
  CARRYOVER_LABEL,
  CLEANUP_STEPS,
  OUTCOME_LABEL,
  coerceMergeReport,
  finishLoop,
  finishedReviews,
  newAutoLoop,
  panesToClean,
  planStep,
  retryStep,
  type AutoAgentSeen,
  type AutoLoop,
  type AutoPause,
  type AutoStep,
  type AutoWorld,
  type HerdrPaneSeen,
} from '../../app/utils/autoLoop'
import type { Project, Store, Ticket } from './store'
import type { JreviewReview } from './jreview'
import { outcomeReportPrompt } from './outcomeReport'
import { outcomeDocOf } from '../../app/utils/projectGraphs'

/** Consensus reviews are two reviewers: a finding both raise is worth a fix ticket. */
export const AUTO_REVIEWERS = 2

function findProject(store: Store, projectId: string) {
  return store.projects.find((p) => p.id === projectId || p.key === projectId)
}

/**
 * Load, mutate the project's loop state, save — synchronously. `fn` returns
 * false to skip the write. Returns the saved state (null when the project or
 * its loop is gone).
 */
function updateAuto(projectId: string, fn: (auto: AutoLoop, store: Store, project: Project) => void | false): AutoLoop | null {
  const store = loadStore()
  const project = findProject(store, projectId)
  if (!project?.auto) return null
  if (fn(project.auto, store, project) === false) return project.auto
  project.updatedAt = now()
  saveStore(store)
  return project.auto
}

function pause(projectId: string, reason: AutoPause['reason'], detail: string) {
  updateAuto(projectId, (auto) => {
    if (auto.paused?.reason === reason && auto.paused.detail === detail) return false
    auto.paused = { reason, detail: detail.slice(0, 500), at: now() }
  })
}

const errText = (err: any) => String(err?.statusMessage ?? err?.data?.message ?? err?.message ?? err).slice(0, 300)

/** The integration branch tip, or null when there's no repo / branch to resolve. */
async function integrationTip(project: Project): Promise<string | null> {
  const branch = project.integrationBranch.trim()
  if (!branch || !project.repo.trim()) return null
  try {
    return await branchOid(resolveRepoDir(project.repo), branch)
  } catch {
    return null
  }
}

async function reviewState(key: string | null): Promise<AutoWorld['review']> {
  if (!key) return null
  try {
    const review = await jreviewFetch<JreviewReview>(`/api/reviews/${encodeURIComponent(key)}`)
    return { status: review.status, ticketKeys: review.tickets?.ticketKeys ?? [] }
  } catch (err: any) {
    return err?.statusCode === 404 ? 'missing' : 'unreachable'
  }
}

/**
 * herdr's view of each open ticket the loop dispatched this phase, keyed by
 * ticket (see resolveAgent for which session counts as the ticket's). A
 * ticket left out is unknown; herdr down → {} and the watchdog stands still.
 */
async function agentsSeen(auto: AutoLoop, store: Store, project: Project): Promise<Record<string, AutoAgentSeen>> {
  if (auto.phase !== 'implementing' && auto.phase !== 'fixing') return {}
  const keys = (auto.phase === 'implementing' ? auto.tickets : auto.fixTickets).filter((k) => {
    const t = store.tickets.find((x) => x.key === k && x.projectId === project.id)
    return auto.dispatched[k] && t && t.status !== 'done' && t.status !== 'merged'
  })
  if (!keys.length) return {}
  const byName = await herdrAgents()
  if (!byName) return {}
  const seen: Record<string, AutoAgentSeen> = {}
  for (const k of keys) {
    const agent = resolveAgent(k, auto.agents[k], byName)
    if (agent === 'gone') seen[k] = 'gone'
    else if (agent?.status === 'working') seen[k] = 'working'
    else if (agent?.status === 'idle' || agent?.status === 'done' || agent?.status === 'blocked') seen[k] = 'stopped'
  }
  return seen
}

/** herdr's named agents → status; null when herdr can't be asked. */
async function herdrAgents(): Promise<Map<string, string> | null> {
  try {
    const agents: Array<{ name?: string; agent_status?: string }> = (await herdrJson<any>(['agent', 'list']))?.result?.agents ?? []
    return new Map(agents.filter((a) => a.name).map((a) => [a.name!, a.agent_status ?? 'unknown']))
  } catch {
    return null
  }
}

/**
 * A ticket's session: the recorded name when herdr still lists it. Otherwise
 * the ticket's sessions by name ('tick-7', 'tick-7-2', …): exactly one is
 * taken as its session (a re-dispatch by hand, or a dispatch from before
 * names were recorded); several are ambiguous → null, so the watchdog leaves
 * the ticket alone rather than nudge — or close — the wrong one. 'gone' =
 * the recorded session is gone and nothing else carries the ticket's name.
 */
function resolveAgent(key: string, recorded: string | undefined, byName: Map<string, string>): { name: string; status: string } | 'gone' | null {
  if (recorded && byName.has(recorded)) return { name: recorded, status: byName.get(recorded)! }
  const base = key.toLowerCase()
  const mine = [...byName.keys()].filter((n) => n === base || new RegExp(`^${base}-\\d+$`).test(n))
  if (mine.length === 1) return { name: mine[0]!, status: byName.get(mine[0]!)! }
  return !mine.length && recorded ? 'gone' : null
}

/** The synchronous half of the world: tickets and PRs, straight off the store. */
function storeWorld(store: Store, project: Project): Pick<AutoWorld, 'tickets' | 'prs'> {
  const all = store.tickets
  const mine = all.filter((t) => t.projectId === project.id)
  const keyOf = new Map(mine.map((t) => [t.id, t.key]))
  return {
    tickets: mine.map((t) => ({
      key: t.key,
      status: t.status,
      frontier: ticketIsFrontier(t, all, project.share),
      hitl: isHitl(t),
      claimed: !!t.assignee,
    })),
    prs: store.prs
      .filter((p) => keyOf.has(p.ticketId))
      .map((p) => ({ key: p.key, ticketKey: keyOf.get(p.ticketId)!, status: p.status })),
  }
}

/**
 * One tick for one project. Safe to call at any time — does nothing unless
 * auto mode is on — and never throws.
 */
const advancing = new Set<string>()

export async function advanceAutoLoop(projectId: string): Promise<AutoStep | null> {
  // One tick per project at a time: the plugin's timer and the endpoint's
  // nudge must never plan from the same stale state.
  if (advancing.has(projectId)) return null
  advancing.add(projectId)
  try {
    // The async half of the world first (git, jReview), then everything else
    // off a fresh store read, so the plan and the write see the same state.
    const before = loadStore()
    const p0 = findProject(before, projectId)
    if (!p0?.auto?.enabled) return null
    const tip = await integrationTip(p0)
    const review = p0.auto.phase === 'reviewing' ? await reviewState(p0.auto.reviewKey) : null
    const agents = await agentsSeen(p0.auto, before, p0)

    const store = loadStore()
    const project = findProject(store, projectId)
    if (!project?.auto?.enabled) return null
    const step = planStep(project.auto, { ...storeWorld(store, project), tip, review, now: Date.now(), agents })
    await apply(project.id, step)
    if (CLEANUP_STEPS.has(step.kind)) await cleanUpHerdr(project.id)
    return step
  } catch (err) {
    console.error(`[jticket] auto loop tick failed for ${projectId}:`, err)
    return null
  } finally {
    advancing.delete(projectId)
  }
}

async function apply(projectId: string, step: AutoStep): Promise<void> {
  const at = now()
  switch (step.kind) {
    case 'wait':
      return

    case 'pause':
      return pause(projectId, step.reason, step.detail)

    case 'complete':
      updateAuto(projectId, (auto) => {
        Object.assign(auto, newAutoLoop(at, auto), { enabled: false, ended: { reason: 'complete', at } })
      })
      return

    case 'turnOff':
      updateAuto(projectId, (auto) => {
        Object.assign(auto, newAutoLoop(at, auto), { enabled: false, ended: { reason: 'stopped', at } })
      })
      return

    case 'startLoop':
      updateAuto(projectId, (auto) => {
        Object.assign(auto, {
          phase: 'implementing',
          phaseStartedAt: at,
          loopStartedAt: at,
          paused: null,
          baseSha: step.baseSha,
          tickets: step.tickets,
          fixTickets: [],
          dispatched: {},
          agents: {},
          watch: {},
          forced: [],
          prs: [],
          prChecks: 0,
          prCheckAt: '',
          mergeDispatchedAt: '',
          mergeReportedAt: '',
          mergeReport: null,
          reviewRequestedAt: '',
          reviewKey: null,
        } satisfies Partial<AutoLoop>)
      })
      return

    case 'dispatchTickets':
      return dispatchTickets(projectId, step.keys)

    case 'recheckPrs':
      updateAuto(projectId, (auto) => {
        auto.prChecks += 1
        auto.prCheckAt = at
      })
      return

    case 'enterMerge':
      updateAuto(projectId, (auto) => {
        auto.phase = auto.phase === 'fixing' ? 'merging-fixes' : 'merging'
        auto.phaseStartedAt = at
        auto.prs = step.prs
        auto.prChecks = 0
        auto.prCheckAt = ''
        auto.mergeDispatchedAt = ''
        auto.mergeReportedAt = ''
        auto.mergeReport = null
      })
      return

    case 'dispatchMerge':
      return dispatchMerge(projectId, step.prs)

    case 'enterReview':
      updateAuto(projectId, (auto) => {
        auto.phase = 'reviewing'
        auto.phaseStartedAt = at
        auto.reviewRequestedAt = ''
        auto.reviewKey = null
      })
      return

    case 'startReview':
      return startReview(projectId)

    case 'enterFix':
      updateAuto(projectId, (auto) => {
        auto.phase = 'fixing'
        auto.phaseStartedAt = at
        auto.fixTickets = step.tickets
        auto.prChecks = 0
        auto.prCheckAt = ''
      })
      return

    case 'finishLoop':
      updateAuto(projectId, (auto) => {
        Object.assign(auto, finishLoop(auto, at))
      })
      return

    case 'enterReport':
      updateAuto(projectId, (auto) => {
        auto.phase = 'reporting'
        auto.phaseStartedAt = at
        auto.paused = null
        auto.reportDispatchedAt = ''
        auto.reportedAt = ''
        auto.reportDoc = ''
      })
      return

    case 'dispatchReport':
      return dispatchReport(projectId)

    case 'watch':
      updateAuto(projectId, (auto) => {
        const w = auto.watch[step.key] ?? { stoppedSince: '', nudgedAt: '' }
        auto.watch = { ...auto.watch, [step.key]: { ...w, stoppedSince: step.stoppedSince } }
      })
      return

    case 'nudge':
      return nudgeTicket(projectId, step.key)

    case 'forceClose':
      updateAuto(projectId, (auto, store, project) => {
        forceCloseTicket(store, project, step.key, step.reason)
        if (!auto.forced.includes(step.key)) auto.forced = [...auto.forced, step.key]
      })
      return
  }
}

/**
 * Hand each ticket to herdr, one after another (pane packing reads the tab's
 * layout, so parallel splits would race). Each is claimed in `dispatched`
 * before its session starts; a failure un-claims it and pauses the loop.
 */
async function dispatchTickets(projectId: string, keys: string[]) {
  for (const key of keys) {
    // Cut the ticket's local branch first, as the hand-off button does — the
    // local-PR prompt names it. Best-effort: a failed cut still hands off.
    {
      const store = loadStore()
      const ticket = store.tickets.find((t) => t.key === key)
      if (ticket && !ticket.branch) {
        const cut = await cutTicketBranch(store, ticket).catch(() => null)
        if (cut) {
          const fresh = loadStore()
          const t = fresh.tickets.find((x) => x.key === key)
          if (t && !t.branch) {
            t.branch = cut.branch
            t.updatedAt = now()
            saveStore(fresh)
          }
        }
      }
    }

    let prompt = ''
    let claimed = false as boolean
    const state = updateAuto(projectId, (auto, store, project) => {
      if (!auto.enabled || auto.paused || auto.dispatched[key]) return false
      const ticket = store.tickets.find((t) => t.key === key)
      if (!ticket) return false
      prompt = `${localPrPrompt(store, project, ticket)} ${autoTicketInstruction(ticket.key, project.key)}`
      auto.dispatched[key] = now()
      claimed = true
    })
    if (!state?.enabled || !claimed) continue

    try {
      const store = loadStore()
      const ticket = store.tickets.find((t) => t.key === key)
      if (!ticket) throw new Error(`${key} no longer exists`)
      const { agent } = await dispatchTicketSession(store, ticket, prompt, { model: IMPLEMENT_MODEL })
      updateAuto(projectId, (auto) => {
        auto.agents = { ...auto.agents, [key]: agent }
      })
    } catch (err) {
      updateAuto(projectId, (auto) => {
        delete auto.dispatched[key]
        auto.paused = { reason: 'dispatch-failed', detail: `${key}: ${errText(err)}`, at: now() }
      })
      return
    }
  }
}

async function dispatchMerge(projectId: string, prs: string[]) {
  let prompt = ''
  let project = undefined as Project | undefined
  const state = updateAuto(projectId, (auto, store, p) => {
    if (!auto.enabled || auto.paused || auto.mergeDispatchedAt) return false
    prompt = `${mergeSweepPrompt(store, p, prs)} ${mergeReportInstruction(p.key)}`
    project = p
    auto.mergeDispatchedAt = now()
  })
  if (!state?.enabled || !project) return
  try {
    await dispatchMergeSession(project, prompt, { model: MERGE_MODEL })
  } catch (err) {
    updateAuto(projectId, (auto) => {
      auto.mergeDispatchedAt = ''
      auto.paused = { reason: 'dispatch-failed', detail: `merge sweep: ${errText(err)}`, at: now() }
    })
  }
}

/**
 * Appended to every ticket the loop dispatches (whatever overrides shaped the
 * rest): in auto mode nobody watches the pane, and the loop waits on the
 * ticket — so it always ends done, with anything unfinished filed as a new
 * ticket. One line — herdr submits the prompt as typed input.
 */
export function autoTicketInstruction(ticketKey: string, projectKey: string): string {
  return (
    `This ticket was dispatched by jTicket's auto loop, which is waiting on it and has nobody watching this pane: ` +
    `always finish with ${ticketKey} marked done. If you can't complete it, record what's done and what's left in its resolution, ` +
    `file the remainder as a new AFK ticket in ${projectKey}, and still mark ${ticketKey} done. ` +
    `Never end your turn with ${ticketKey} still open or with a question for the human — a session that stops with the ticket open gets prompted, then has the ticket closed for it.`
  )
}

/** What the watchdog types into a session that stopped with its ticket open. One line. */
export function autoNudgePrompt(ticketKey: string, projectKey: string): string {
  return (
    `jTicket's auto loop is still waiting on ${ticketKey}, which is not done. Finish it now: if the work is complete, make sure its local PR is open and mark ${ticketKey} done. ` +
    `If it can't be completed, record what's done and what's left in its resolution, file the remainder as a new AFK ticket in ${projectKey}, and mark ${ticketKey} done anyway. ` +
    `Don't ask a question — nobody is watching this pane. If you stop again with ${ticketKey} open, the loop closes it for you.`
  )
}

/** Prompt a stalled session to finish. Claimed first; a failed prompt still counts (the force-close follows). */
async function nudgeTicket(projectId: string, key: string) {
  const byName = await herdrAgents()
  let agent = ''
  let projectKey = ''
  const state = updateAuto(projectId, (auto, _store, project) => {
    const w = auto.watch[key]
    if (!auto.enabled || !w || w.nudgedAt) return false
    const found = byName && resolveAgent(key, auto.agents[key], byName)
    agent = found && found !== 'gone' ? found.name : ''
    projectKey = project.key
    auto.watch = { ...auto.watch, [key]: { ...w, nudgedAt: now() } }
  })
  if (!state?.enabled || !agent) return
  try {
    await herdrJson(['agent', 'prompt', agent, autoNudgePrompt(key, projectKey)])
  } catch (err) {
    console.error(`[jticket] auto loop could not nudge ${key} (${agent}):`, errText(err))
  }
}

/**
 * The watchdog's last resort, inside one synchronous store write: mark the
 * ticket done with a comment saying why, and file what it may have left as a
 * carryover ticket in the same project — which inherits the closed ticket's
 * place in front of anything it blocked, so dependents (in this project or
 * another) still wait for the real work. A carryover that itself gets closed
 * this way files its own as HITL: the loop stops retrying and waits on you.
 */
export function forceCloseTicket(store: Store, project: Project, key: string, reason: string): Ticket | null {
  const ticket = store.tickets.find((t) => t.key === key && t.projectId === project.id)
  if (!ticket || ticket.status === 'done' || ticket.status === 'merged') return null
  const at = now()
  const pr = store.prs.find((p) => p.ticketId === ticket.id && (p.status === 'open' || p.status === 'conflicted'))
  const repeat = ticket.labels.includes(CARRYOVER_LABEL)

  const carry: Ticket = {
    id: newId('tick'),
    key: project.share
      ? sharedTicketKey(project.share, store.tickets.filter((t) => t.projectId === project.id))
      : nextKey(store, 'ticket'),
    title: `Finish ${ticket.key}: ${ticket.title}`.slice(0, 200),
    description: [
      `Carried over by the auto loop: ${ticket.key} was closed unfinished because ${reason}.`,
      `Check how far it got — its resolution and comments${ticket.branch ? `, branch \`${ticket.branch}\`` : ''}${pr ? `, and ${pr.key} (merged by the loop's sweep if it was open)` : ''} — and finish what's left.`,
      repeat ? `This is the second time this work was closed unfinished, so it's HITL: look at why before handing it to an agent again.` : '',
      ticket.description ? `---\n\n${ticket.description}` : '',
    ]
      .filter(Boolean)
      .join('\n\n'),
    acceptanceCriteria: [...ticket.acceptanceCriteria],
    type: ticket.type,
    status: 'todo',
    projectId: project.id,
    assignee: '',
    labels: [...ticket.labels.filter((l) => l !== 'afk' && l !== 'hitl' && l !== CARRYOVER_LABEL), repeat ? 'hitl' : 'afk', CARRYOVER_LABEL],
    resolution: '',
    blockedBy: [],
    comments: [],
    branch: '',
    prompt: ticket.prompt,
    promptMode: ticket.promptMode,
    completedAt: null,
    ...entityOwnership(project.share),
    transfer: '',
    transferAt: '',
    createdAt: at,
    updatedAt: at,
  }
  store.tickets.push(carry)
  for (const t of store.tickets) {
    if (t.id !== carry.id && t.blockedBy.includes(ticket.id) && t.status !== 'done' && t.status !== 'merged' && !t.blockedBy.includes(carry.id)) {
      t.blockedBy = [...t.blockedBy, carry.id]
      t.updatedAt = at
    }
  }

  const note = `Closed by the auto loop: ${reason}. Whatever is left is ${carry.key}.`
  ticket.comments.push({ id: newId('cmt'), author: 'jticket auto loop', body: note, createdAt: at, ...entityOwnership(project.share) })
  ticket.resolution = ticket.resolution.trim() ? `${ticket.resolution.trim()}\n\n---\n\n**${note}**` : `**${note}**`
  ticket.completedAt = stampCompletion(ticket, 'done', at)
  ticket.status = 'done'
  ticket.updatedAt = at
  return carry
}

/**
 * Appended to the auto loop's sweep prompt (whatever overrides shaped the
 * rest): the loop waits on this report, not on PR statuses, to know the sweep
 * is finished. One line — herdr submits the prompt as typed input.
 */
export function mergeReportInstruction(projectKey: string): string {
  return (
    `When you are finished — every PR merged, or stopped on one you could not land — report back to jTicket's auto loop: ` +
    `POST http://localhost:43000/api/projects/${projectKey}/auto/merge-report with JSON {"unmerged": [{"pr": "<PR key>", "reason": "<why it did not land>"}]} ` +
    `(an empty list when everything landed). The loop waits for this report before it moves on.`
  )
}

/**
 * The sweep's "I'm finished" (POST /api/projects/:id/auto/merge-report).
 * Throws 409 when no sweep is waiting on a report; a repeat report is a no-op.
 */
export function recordMergeReport(project: Project, raw: unknown): AutoLoop {
  const auto = project.auto
  const sweeping = auto?.enabled && (auto.phase === 'merging' || auto.phase === 'merging-fixes') && !!auto.mergeDispatchedAt
  if (!auto || !sweeping) {
    throw createError({ statusCode: 409, statusMessage: `no auto-loop merge sweep is waiting on a report for ${project.key}` })
  }
  if (auto.mergeReportedAt) return auto
  auto.mergeReportedAt = now()
  auto.mergeReport = coerceMergeReport(raw) ?? { unmerged: [] }
  project.updatedAt = auto.mergeReportedAt
  return auto
}

async function dispatchReport(projectId: string) {
  let prompt = ''
  let project = undefined as Project | undefined
  const state = updateAuto(projectId, (auto, store, p) => {
    if (!auto.enabled || auto.paused || auto.reportDispatchedAt) return false
    const ticketOf = new Map(store.tickets.map((t) => [t.id, t]))
    prompt = outcomeReportPrompt({
      project: p,
      existingDoc: outcomeDocOf(store.docs, p.id)?.key ?? null,
      merged: store.prs
        .filter((pr) => pr.projectId === p.id && pr.status === 'merged' && pr.mergeCommit)
        .sort((a, b) => (a.mergedAt ?? '').localeCompare(b.mergedAt ?? ''))
        .map((pr) => ({ pr: pr.key, sha: pr.mergeCommit, title: pr.title || ticketOf.get(pr.ticketId)?.title || '' })),
    })
    project = p
    auto.reportDispatchedAt = now()
  })
  if (!state?.enabled || !project) return
  try {
    await dispatchProjectSession(project, 'outcome report', prompt, { model: REPORT_MODEL })
  } catch (err) {
    updateAuto(projectId, (auto) => {
      auto.reportDispatchedAt = ''
      auto.paused = { reason: 'dispatch-failed', detail: `outcome report: ${errText(err)}`, at: now() }
    })
  }
}

/**
 * The outcome report session's "I'm finished" (POST
 * /api/projects/:id/auto/outcome-report, body {doc}). The doc must be one of
 * the project's; it becomes the project's one 'outcome'-labelled doc. Throws
 * 409 when no report is being waited on; a repeat report is a no-op.
 */
export function recordOutcomeReport(store: Store, project: Project, raw: any): AutoLoop {
  const auto = project.auto
  if (!auto?.enabled || auto.phase !== 'reporting' || !auto.reportDispatchedAt) {
    throw createError({ statusCode: 409, statusMessage: `no auto-loop outcome report is being waited on for ${project.key}` })
  }
  if (auto.reportedAt) return auto
  const ref = typeof raw?.doc === 'string' ? raw.doc.trim() : ''
  const doc = store.docs.find((d) => d.key === ref || d.id === ref)
  if (!doc) throw createError({ statusCode: 400, statusMessage: `unknown doc: ${ref || '(none given)'} — send {"doc": "DOC-n"}` })
  if (doc.projectId !== project.id) throw createError({ statusCode: 400, statusMessage: `${doc.key} is not one of ${project.key}'s docs` })
  const at = now()
  for (const d of store.docs) {
    if (d.projectId !== project.id) continue
    const want = d.id === doc.id
    if (want !== d.labels.includes(OUTCOME_LABEL)) {
      d.labels = want ? [...d.labels, OUTCOME_LABEL] : d.labels.filter((l) => l !== OUTCOME_LABEL)
      d.updatedAt = at
    }
  }
  doc.updatedAt = at
  auto.reportedAt = at
  auto.reportDoc = doc.key
  project.updatedAt = at
  return auto
}

async function startReview(projectId: string) {
  let body = null as Record<string, unknown> | null
  const state = updateAuto(projectId, (auto, _store, project) => {
    if (!auto.enabled || auto.paused || auto.reviewRequestedAt) return false
    body = {
      repoPath: resolveRepoDir(project.repo),
      branch: project.integrationBranch,
      base: auto.baseSha,
      title: `${project.key} · auto loop ${auto.loop} · ${basename(project.repo.trim()) || project.title}`,
      reviewers: AUTO_REVIEWERS,
      consensus: { projectKey: project.key, loop: auto.loop },
    }
    auto.reviewRequestedAt = now()
  })
  if (!state?.enabled || !body) return
  try {
    // jReview resolves refs, maybe cuts a worktree, and asks gh about PRs before answering.
    const res = await jreviewFetch<{ key: string }>('/api/reviews', { method: 'POST', body, timeout: 60_000 })
    updateAuto(projectId, (auto) => {
      auto.reviewKey = res.key
    })
  } catch (err) {
    updateAuto(projectId, (auto) => {
      auto.reviewRequestedAt = ''
      auto.paused = { reason: 'review-failed', detail: `jReview: ${errText(err)}`, at: now() }
    })
  }
}

/**
 * Close the herdr panes the loop is finished with (see panesToClean) so they
 * don't stack up loop after loop. Best-effort: herdr down, or a pane that
 * won't close, leaves things as they were — never pauses the loop.
 */
export async function cleanUpHerdr(projectId: string): Promise<number> {
  try {
    const store = loadStore()
    const project = findProject(store, projectId)
    if (!project?.auto) return 0
    const doneTickets = new Set(
      store.tickets
        .filter((t) => t.projectId === project.id && (t.status === 'done' || t.status === 'merged'))
        .map((t) => t.key),
    )
    const [tabList, paneList] = await Promise.all([herdrJson<any>(['tab', 'list']), herdrJson<any>(['pane', 'list'])])
    const tabLabel = new Map<string, string>(
      (tabList?.result?.tabs ?? []).map((t: any) => [t.tab_id, String(t.label ?? '')]),
    )
    const panes: HerdrPaneSeen[] = (paneList?.result?.panes ?? []).map((p: any) => ({
      paneId: p.pane_id,
      tabLabel: tabLabel.get(p.tab_id) ?? '',
      paneLabel: String(p.label ?? ''),
      agentStatus: String(p.agent_status ?? 'unknown'),
    }))
    const ids = panesToClean(panes, {
      projectKey: project.key,
      doneTickets,
      finishedReviews: finishedReviews(project.auto),
    })
    let closed = 0
    for (const id of ids) {
      try {
        await herdrJson(['pane', 'close', id])
        closed++
      } catch { /* already gone, or herdr refused — next time */ }
    }
    if (closed) invalidateHerdrState()
    return closed
  } catch (err) {
    console.error(`[jticket] auto loop herdr cleanup failed for ${projectId}:`, errText(err))
    return 0
  }
}

// ── The jButton's controls (POST /api/projects/:id/auto) ────────────────────

/** Why a project can't go into auto mode — null when it can. */
export function autoModeBlocker(store: Store, project: Project): string | null {
  if (project.mode !== 'standard') return `auto mode drives standard projects — ${project.key} is a ${project.mode} project`
  if (!project.repo.trim()) return `${project.key} has no repo — set one on the project first`
  if (!project.integrationBranch.trim()) return `${project.key} has no integration branch — cut one first; every loop merges into it`
  if (project.share && project.share.side !== 'creator') return `${project.key} is shared with you — only its creator's side can run it in auto mode`
  return null
}

export function setAutoMode(
  store: Store,
  project: Project,
  patch: { enabled?: boolean; stopRequested?: boolean; retry?: boolean },
): AutoLoop {
  const at = now()
  let auto = project.auto ?? newAutoLoop(at)
  if (patch.enabled === true && !auto.enabled) {
    // A fresh start: whatever the last run left behind is history now.
    auto = { ...newAutoLoop(at, auto), enabled: true, ended: null }
  } else if (patch.enabled === false && auto.enabled) {
    // Off now. Sessions already running in herdr are left alone.
    auto = { ...newAutoLoop(at, auto), enabled: false, ended: { reason: 'turned-off', at } }
  }
  if (typeof patch.stopRequested === 'boolean' && auto.enabled) auto = { ...auto, stopRequested: patch.stopRequested }
  if (patch.retry && auto.enabled) auto = retryStep(auto, storeWorld(store, project))
  project.auto = auto
  project.updatedAt = at
  return auto
}
