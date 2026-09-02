import { basename } from 'node:path'

// Kick off a review-guidance run by dispatching a claude session into herdr
// instead of running claude in-process: workspace = the reviewed repo
// ('jdiff · <dir>'), tab = a fresh single-pane job tab per run, agent =
// claude pinned to Opus 5 running the globally-installed `jdiff-review`
// skill. The skill reads the diff itself (cwd = the repo) and POSTs all five
// artifacts back to /api/review-artifact; /api/review-complete closes the run.
//
// Unlike jTicket's --no-focus dispatches, this one hands the reviewer over to
// the session: the new tab is focused and the herdr window brought forward.
// Callers dispatching background work (jTicket's Run-review buttons) pass
// focus: false to skip the hand-off.
//
// `ticket` / `project` are opaque jTicket keys relayed into the prompt so the
// review session can report its findings back to jTicket; this server stays
// ticket-agnostic and never calls jTicket itself.
//
// Body: { repo, number | branch (+ base?), ticket?, project?, focus? }
const JTICKET_KEY = /^[A-Za-z][A-Za-z0-9]*-\d+$/

export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const repo = resolveRepoDir(String(body?.repo ?? ''))
  const target = resolveTargetFromBody(body)
  requireCommittedScope(target, 'a review run')

  // The keys land verbatim in a claude prompt — reject anything that isn't a
  // bare TICK-n / PROJ-n shape rather than trying to escape it.
  const ticket = body?.ticket == null ? '' : String(body.ticket)
  const project = body?.project == null ? '' : String(body.project)
  for (const key of [ticket, project]) {
    if (key && !JTICKET_KEY.test(key)) {
      throw createError({ statusCode: 400, message: 'bad ticket/project key' })
    }
  }

  // A run already in flight for this target: attach, don't double-dispatch.
  // The attached run keeps its original prompt — a ticket/project context on
  // THIS request is dropped, which callers can surface via `attached`.
  const existing = getReviewDispatch(repo, target.storeKey)
  if (existing) {
    return {
      agent: existing.agent,
      workspaceId: existing.workspaceId,
      tabId: existing.tabId,
      startedAt: existing.startedAt,
      attached: true,
    }
  }

  // Validates the refs and, for PRs, fetches the head into refs/jdiff/pr-<n> —
  // the dispatched session diffs this range directly, so it must exist locally
  // before the prompt lands.
  const prepared = await prepareTarget(target, repo)

  const label = targetLabel(target)
  const { workspaceId, freshTab } = await ensureHerdrWorkspace(`jdiff · ${basename(repo)}`, repo)
  const tabLabel = `review ${label}`
  let tabId: string, paneId: string
  if (freshTab) {
    await herdrJson(['tab', 'rename', freshTab.tabId, tabLabel])
    ;({ tabId, paneId } = freshTab)
  } else {
    ;({ tabId, paneId } = await createJobTab(workspaceId, tabLabel, repo))
  }

  // Single line, key=value — the skill re-derives everything else (title,
  // body, file list) from git/gh inside the repo.
  const targetArgs = target.kind === 'pr'
    ? `number=${target.number}`
    : `branch=${target.branch} base=${prepared.base}`
  const ctxArgs = ticket ? ` ticket=${ticket}` : project ? ` project=${project}` : ''
  const prompt = `/jdiff-review ${targetArgs} range=${prepared.range} head=${prepared.headRef}${ctxArgs}`

  const agent = await startClaudeIn(paneId, `jdiff-${target.storeKey}`, prompt, {
    args: ['--model', REVIEW_MODEL],
  })
  const dispatch = registerReviewDispatch({
    repo,
    number: target.storeKey,
    startedAt: Date.now(),
    agent,
    workspaceId,
    tabId,
  })

  // Open herdr on the run. Best-effort — a failed focus must not undo a
  // dispatch that already happened.
  if (body?.focus !== false) {
    await herdrJson(['tab', 'focus', tabId]).catch(() => {})
    await focusHerdrWindow()
  }

  return { agent, workspaceId, tabId, startedAt: dispatch.startedAt, attached: false }
})
