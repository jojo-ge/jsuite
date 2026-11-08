// Building a run plan with an agent — the Run setup tab's Build button.
//
// One Fable 5.1 session (`/jrunplan`, the `runplan:build` hand-off resolved
// through the prompt layers) reads the project and writes its plan through
// PUT …/run-plan, then reports back (POST …/run-plan/built). While it works,
// `project.runPlanBuild` marks the plan as the agent's: the tab is read-only
// and a second Build is refused. Cancel closes its pane and clears the mark.
import type { Project, Store } from './store'

/** Why a build can't start — null when it can. */
export function runPlanBuildBlocker(project: Project): string | null {
  if (project.mode !== 'standard') return `run plans drive standard projects — ${project.key} is a ${project.mode} project`
  if (!project.repo.trim()) return `${project.key} has no repo — set one on the project first; the builder reads its code`
  if (project.share && project.share.side !== 'creator') return `${project.key} is shared with you — only its creator's side can plan its runs`
  if (project.auto?.enabled) return `${project.key} is in auto mode — turn it off (or Unlock & stop its plan) before building a new plan`
  return null
}

/**
 * POST /api/projects/:id/run-plan/build — dispatch the builder. A build whose
 * session herdr still lists is refused (409); one whose session is gone (the
 * pane closed by hand, herdr restarted) is replaced.
 */
export async function startRunPlanBuild(projectId: string): Promise<{ agent: string; paneId: string }> {
  let store = loadStore()
  let project = store.projects.find((p) => p.id === projectId)
  if (!project) throw createError({ statusCode: 404, statusMessage: 'project not found' })
  const blocked = runPlanBuildBlocker(project)
  if (blocked) throw createError({ statusCode: 409, statusMessage: blocked })
  if (project.runPlanBuild) {
    const agents = await herdrAgents()
    const live = agents?.has(project.runPlanBuild.agent) ?? true
    if (live) throw createError({ statusCode: 409, statusMessage: `Fable 5.1 is already building ${project.key}'s run plan (since ${project.runPlanBuild.startedAt}) — cancel it first to start over` })
  }
  const prompt = buildPlanPrompt(store, project)
  const { agent, paneId } = await dispatchProjectSession(project, 'run plan', prompt, { model: RUNPLAN_MODEL, effort: RUNPLAN_EFFORT, session: { role: 'runplan-build' } })
  // Re-read: the dispatch took seconds and the store may have moved on.
  store = loadStore()
  project = store.projects.find((p) => p.id === projectId)
  if (project) {
    project.runPlanBuild = { agent, paneId, startedAt: now() }
    project.updatedAt = now()
    saveStore(store)
  }
  return { agent, paneId }
}

/** The build's done (the agent's report-back) or cancelled — the mark comes off. Returns what was there. */
export function clearRunPlanBuild(store: Store, project: Project) {
  const was = project.runPlanBuild ?? null
  project.runPlanBuild = null
  project.updatedAt = now()
  return was
}

/** DELETE …/run-plan/build — cancel: close the builder's pane (best-effort) and clear the mark. */
export async function cancelRunPlanBuild(projectId: string): Promise<boolean> {
  const store = loadStore()
  const project = store.projects.find((p) => p.id === projectId)
  if (!project) throw createError({ statusCode: 404, statusMessage: 'project not found' })
  const was = clearRunPlanBuild(store, project)
  saveStore(store)
  if (was?.paneId) {
    try {
      await herdrJson(['pane', 'close', was.paneId])
      invalidateHerdrState()
    } catch {
      /* already gone, or herdr down — the mark is off either way */
    }
  }
  return !!was
}
