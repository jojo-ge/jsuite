import { basename } from 'node:path'

// On-demand walkthrough dispatches, beyond the analyze run's overview tour:
// mode 'detail' starts a /jdiff-tour session that produces the fine-grained
// tour; mode 'chains' starts the /jdiff-chains scoping session, whose
// manifest POST then fans out one walker session per chain server-side.
// Same topology as ask-dispatch: repo workspace, own job tab, Opus 5,
// focused on dispatch — an explicit user hand-off.
//
// Body: { repo, number | branch (+ base?), mode: 'detail' | 'chains' }
export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const repo = resolveRepoDir(String(body?.repo ?? ''))
  const target = resolveTargetFromBody(body)
  const mode = String(body?.mode ?? '')
  if (!['detail', 'chains'].includes(mode)) throw createError({ statusCode: 400, message: 'bad mode' })

  // Attach, don't double-dispatch. For chains a whole generation — the scope
  // session plus its walkers — counts as one live run; regenerating requires
  // cancelling it first.
  const existing = mode === 'detail'
    ? getReviewDispatch(repo, target.storeKey, 'detail')
    : targetDispatches(repo, target.storeKey)
        .find((d) => d.job === 'chains-scope' || d.job.startsWith('chain:')) ?? null
  if (existing) {
    return {
      agent: existing.agent,
      workspaceId: existing.workspaceId,
      tabId: existing.tabId,
      startedAt: existing.startedAt,
      attached: true,
    }
  }

  const prepared = await prepareTarget(target, repo)

  const label = targetLabel(target)
  const { workspaceId, freshTab } = await ensureHerdrWorkspace(`jdiff · ${basename(repo)}`, repo)
  const tabLabel = `${mode} ${label}`
  let tabId: string, paneId: string
  if (freshTab) {
    await herdrJson(['tab', 'rename', freshTab.tabId, tabLabel])
    ;({ tabId, paneId } = freshTab)
  } else {
    ;({ tabId, paneId } = await createJobTab(workspaceId, tabLabel, repo))
  }

  const targetArgs = target.kind === 'pr'
    ? `number=${target.number}`
    : `branch=${target.branch} base=${prepared.base}`
  const prompt = mode === 'detail'
    ? `/jdiff-tour ${targetArgs} range=${prepared.range} head=${prepared.headRef}`
    : `/jdiff-chains stage=scope ${targetArgs} range=${prepared.range} head=${prepared.headRef}`

  const agentName = mode === 'detail' ? `jdiff-detail-${target.storeKey}` : `jdiff-chains-${target.storeKey}`
  const agent = await startClaudeIn(paneId, agentName, prompt, {
    args: ['--model', REVIEW_MODEL],
  })
  const dispatch = registerReviewDispatch({
    repo,
    number: target.storeKey,
    job: mode === 'detail' ? 'detail' : 'chains-scope',
    startedAt: Date.now(),
    agent,
    workspaceId,
    tabId,
  })

  await herdrJson(['tab', 'focus', tabId]).catch(() => {})
  await focusHerdrWindow()

  return { agent, workspaceId, tabId, startedAt: dispatch.startedAt, attached: false }
})
