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
  finishLoop,
  newAutoLoop,
  planStep,
  retryStep,
  type AutoLoop,
  type AutoPause,
  type AutoStep,
  type AutoWorld,
} from '../../app/utils/autoLoop'
import type { Project, Store } from './store'
import type { JreviewReview } from './jreview'

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

    const store = loadStore()
    const project = findProject(store, projectId)
    if (!project?.auto?.enabled) return null
    const step = planStep(project.auto, { ...storeWorld(store, project), tip, review })
    await apply(project.id, step)
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
          prs: [],
          mergeDispatchedAt: '',
          reviewRequestedAt: '',
          reviewKey: null,
        } satisfies Partial<AutoLoop>)
      })
      return

    case 'dispatchTickets':
      return dispatchTickets(projectId, step.keys)

    case 'enterMerge':
      updateAuto(projectId, (auto) => {
        auto.phase = auto.phase === 'fixing' ? 'merging-fixes' : 'merging'
        auto.phaseStartedAt = at
        auto.prs = step.prs
        auto.mergeDispatchedAt = ''
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
      })
      return

    case 'finishLoop':
      updateAuto(projectId, (auto) => {
        Object.assign(auto, finishLoop(auto, at))
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
      prompt = localPrPrompt(store, project, ticket)
      auto.dispatched[key] = now()
      claimed = true
    })
    if (!state?.enabled || !claimed) continue

    try {
      const store = loadStore()
      const ticket = store.tickets.find((t) => t.key === key)
      if (!ticket) throw new Error(`${key} no longer exists`)
      await dispatchTicketSession(store, ticket, prompt, { model: IMPLEMENT_MODEL })
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
    prompt = mergeSweepPrompt(store, p, prs)
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
