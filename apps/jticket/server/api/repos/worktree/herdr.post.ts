// Dispatch a codebase's worktree kickoff into Herdr (?repo=): a single-pane
// 'worktree kickoff' tab in the codebase's own workspace (label = the
// codebase's slug or folder name, cwd = the repo), running claude with the
// kickoff prompt. HITL by nature — it asks the human for what the repo can't
// say — so it always gets its own tab. Created --no-focus.
//
// Body: { prompt: string }  (built by the client — the 'worktree:kickoff' kind,
// resolved through the codebase → global → built-in layers)
import { basename } from 'node:path'

export default defineEventHandler(async (event) => {
  const store = loadStore()
  const path = resolveRepoParam(store, getQuery(event).repo)
  if (!path) throw createError({ statusCode: 400, statusMessage: 'missing ?repo=' })
  const body = await readBody<{ prompt?: string }>(event)
  const prompt = (body?.prompt ?? '').trim()
  if (!prompt) throw createError({ statusCode: 400, statusMessage: 'prompt is required' })

  const repo = findKnownRepo(store, path)
  if (!repo) throw createError({ statusCode: 404, statusMessage: `not a known codebase: ${path}` })
  const cwd = resolveRepoDir(repo.path)
  const label = repo.slug || basename(repo.path)

  const { workspaceId, freshTab } = await ensureHerdrWorkspace(label, cwd)
  let tabId: string, paneId: string
  if (freshTab) {
    await herdrJson(['tab', 'rename', freshTab.tabId, 'worktree kickoff'])
    ;({ tabId, paneId } = freshTab)
  } else {
    ;({ tabId, paneId } = await createJobTab(workspaceId, 'worktree kickoff', cwd))
  }
  await renamePane(paneId, `worktree kickoff · ${label}`)
  const agent = await startClaudeIn(paneId, 'worktree-kickoff', prompt)

  return { workspaceId, tabId, paneId, agent, workspace: label }
})
