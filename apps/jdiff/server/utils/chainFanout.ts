import { basename } from 'node:path'
import type { ChainSummary } from '../../app/utils/tour'

// Launch one herdr session per chain from a freshly-saved chains manifest.
// Called fire-and-forget by the chains artifact handler AFTER it registered
// every chain dispatch synchronously, so /api/ai-jobs shows the chains
// pending the moment the manifest lands, not when their sessions come up.
//
// Sequential on purpose: startClaudeIn blocks a few seconds per session and
// herdr tab/pane creation races when parallelized; ≤ MAX_CHAINS keeps the
// whole loop under a minute. Panes pack 4-up per tab via acquirePackedPane.
// Never focuses — N sessions would fight over the window; only the chain id
// enters the prompt (slug-gated), the session GETs its details from
// /api/chains.
export async function fanOutChains(opts: {
  repo: string
  storeKey: string
  label: string
  targetArgs: string
  range: string
  headRef: string
  chains: ChainSummary[]
}): Promise<void> {
  const { workspaceId, freshTab } = await ensureHerdrWorkspace(`jdiff · ${basename(opts.repo)}`, opts.repo)
  let fresh = freshTab
  for (const chain of opts.chains) {
    const job = `chain:${chain.id}` as const
    // Cancelled while an earlier launch was still blocking? Skip it.
    const dispatch = getReviewDispatch(opts.repo, opts.storeKey, job)
    if (!dispatch) continue
    try {
      const pane = await acquirePackedPane(workspaceId, `chains ${opts.label}`, opts.repo, fresh)
      fresh = null
      const prompt = `/jdiff-chains chain=${chain.id} ${opts.targetArgs} `
        + `range=${opts.range} head=${opts.headRef}`
      const agent = await startClaudeIn(pane.paneId, `jdiff-chain-${chain.id}`, prompt, {
        args: ['--model', REVIEW_MODEL],
      })
      dispatch.agent = agent
      dispatch.workspaceId = workspaceId
      dispatch.tabId = pane.tabId
    } catch (err: any) {
      clearReviewDispatch(opts.repo, opts.storeKey, job)
      appendFailures(opts.repo, opts.storeKey, [{
        jobKind: job,
        message: `failed to dispatch the chain walker: ${String(err?.message ?? err).slice(0, 400)}`,
        at: new Date().toISOString(),
      }])
    }
  }
}
