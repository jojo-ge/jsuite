import { basename } from 'node:path'

// Launch one herdr walker session per item of a freshly-saved manifest — a
// chain from the chains manifest, or a high-severity issue from the hunt
// manifest. Called fire-and-forget by the artifact handler AFTER it
// registered every walker dispatch synchronously, so /api/ai-jobs shows them
// pending the moment the manifest lands, not when their sessions come up.
//
// Sequential on purpose: startClaudeIn blocks a few seconds per session and
// herdr tab/pane creation races when parallelized; the manifest caps keep the
// whole loop under a minute. Panes pack 4-up per tab via acquirePackedPane.
// Never focuses — N sessions would fight over the window; only the item id
// enters the prompt (slug-gated), the session GETs its details from the
// manifest endpoint.

export interface WalkerKind {
  // Job id prefix, which is also the tour variant prefix: 'chain' | 'issue'.
  prefix: 'chain' | 'issue'
  // The skill invocation, given the item's slug.
  prompt: (id: string) => string
  // Tab label for the packed panes.
  tabLabel: string
}

export async function fanOutWalkers(opts: {
  repo: string
  storeKey: string
  kind: WalkerKind
  ids: string[]
}): Promise<void> {
  const { kind } = opts
  const { workspaceId, freshTab } = await ensureHerdrWorkspace(`jdiff · ${basename(opts.repo)}`, opts.repo)
  let fresh = freshTab
  for (const id of opts.ids) {
    const job = `${kind.prefix}:${id}` as const
    // Cancelled while an earlier launch was still blocking? Skip it.
    const dispatch = getReviewDispatch(opts.repo, opts.storeKey, job)
    if (!dispatch) continue
    try {
      const pane = await acquirePackedPane(workspaceId, kind.tabLabel, opts.repo, fresh)
      fresh = null
      const agent = await startClaudeIn(pane.paneId, `jdiff-${kind.prefix}-${id}`, kind.prompt(id), {
        args: ['--model', REVIEW_MODEL],
      })
      dispatch.agent = agent
      dispatch.workspaceId = workspaceId
      dispatch.tabId = pane.tabId
    } catch (err: any) {
      clearReviewDispatch(opts.repo, opts.storeKey, job)
      appendFailures(opts.repo, opts.storeKey, [{
        jobKind: job,
        message: `failed to dispatch the ${kind.prefix} walker: ${String(err?.message ?? err).slice(0, 400)}`,
        at: new Date().toISOString(),
      }])
    }
  }
}
