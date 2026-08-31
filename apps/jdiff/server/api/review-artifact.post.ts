import { createHash } from 'node:crypto'

// Where the herdr sessions hand their work back. The `jdiff-review` /
// `jdiff-tour` / `jdiff-chains` skills POST each artifact as soon as it is
// ready — one bad artifact costs only that tool, the rest land independently.
// Payloads are validated through the same cleaners for every caller, then
// saved to the artifact stores the review pages already read.
//
// Tours carry an optional sibling `variant` ('overview' when absent,
// 'detail', or 'chain:<slug>' naming a chain from the saved manifest). A
// `chains` POST saves the manifest AND fans out one herdr session per chain —
// registered synchronously here, launched by a fire-and-forget loop.
//
// Body: { repo, number | branch (+ base?), tool: 'rating'|'risk'|'tour'|'questions'|'findings'|'chains', variant?, artifact }
export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const repo = resolveRepoDir(String(body?.repo ?? ''))
  const target = resolveTargetFromBody(body)
  const tool = String(body?.tool ?? '') as ReviewTool
  if (!REVIEW_TOOLS.includes(tool)) throw createError({ statusCode: 400, message: 'bad tool' })
  const artifact = body?.artifact
  if (!artifact || typeof artifact !== 'object') {
    throw createError({ statusCode: 400, message: 'missing artifact' })
  }
  const createdAt = new Date().toISOString()
  // Which dispatch this artifact settles: the analyze run by default, or the
  // job that produces exactly this artifact.
  let job: ReviewJob = 'analyze'

  if (tool === 'rating') {
    const rating = cleanRating(artifact)
    // Identifies "same code, new run" so the next run can pin its score to
    // this one when the diff is byte-identical. The two endpoints of the
    // three-dot range pin the diff exactly.
    const prepared = await prepareTarget(target, repo)
    const [leftRef, rightRef] = prepared.range.split('...')
    const mergeBase = (await run('git', ['merge-base', leftRef!, rightRef!], repo)).trim()
    const diffHash = createHash('sha256').update(`${mergeBase}..${prepared.headOid}`).digest('hex')
    saveRating({ repo, number: target.storeKey, rating, createdAt, diffHash })
  } else if (tool === 'risk') {
    // Only files actually in the diff can carry a risk level.
    const prepared = await prepareTarget(target, repo)
    const numstat = await run('git', ['diff', '--numstat', '-M', prepared.range], repo)
    const knownPaths = new Set(
      numstat.trim().split('\n').filter(Boolean)
        .map((l) => newPathOf(l.split('\t').slice(2).join('\t'))),
    )
    const risks = cleanRisks(artifact, knownPaths)
    if (!risks.length) throw createError({ statusCode: 400, message: 'no valid file risks in payload' })
    saveRiskMap({ repo, number: target.storeKey, risks, createdAt })
  } else if (tool === 'tour') {
    const slugs = new Set((loadChains(repo, target.storeKey)?.chains ?? []).map((c) => c.id))
    const variant = parseTourVariant(body?.variant, slugs)
    if (variant !== 'overview') job = variant === 'detail' ? 'detail' : variant
    saveTour({ repo, number: target.storeKey, variant, tour: cleanTour(artifact, variant), createdAt })
  } else if (tool === 'chains') {
    job = 'chains-scope'
    const manifest = cleanChains(artifact)
    // A new manifest supersedes the previous generation: interrupt any chain
    // walkers still live from the old one so they can't post into the new set.
    for (const d of targetDispatches(repo, target.storeKey)) {
      if (!d.job.startsWith('chain:')) continue
      clearReviewDispatch(repo, target.storeKey, d.job)
      await herdrJson(['agent', 'send-keys', d.agent, 'esc']).catch(() => {})
    }
    saveChains({ repo, number: target.storeKey, ...manifest, createdAt })
    // Register every chain dispatch before responding, so ai-jobs shows them
    // pending immediately; the fan-out loop fills in agent/tab as each starts.
    const prepared = await prepareTarget(target, repo)
    for (const chain of manifest.chains) {
      registerReviewDispatch({
        repo,
        number: target.storeKey,
        job: `chain:${chain.id}`,
        startedAt: Date.now(),
        agent: '(starting)',
        workspaceId: '',
        tabId: '',
      })
    }
    const targetArgs = target.kind === 'pr'
      ? `number=${target.number}`
      : `branch=${target.branch} base=${prepared.base}`
    fanOutChains({
      repo,
      storeKey: target.storeKey,
      label: targetLabel(target),
      targetArgs,
      range: prepared.range,
      headRef: prepared.headRef,
      chains: manifest.chains,
    }).catch((err: any) => {
      appendFailures(repo, target.storeKey, [{
        jobKind: 'chains-scope',
        message: `chain fan-out failed: ${String(err?.message ?? err).slice(0, 400)}`,
        at: new Date().toISOString(),
      }])
    })
  } else if (tool === 'findings') {
    // Findings must point at files actually in the diff; an empty list is a
    // valid artifact (a clean review) and saves as such.
    const prepared = await prepareTarget(target, repo)
    const numstat = await run('git', ['diff', '--numstat', '-M', prepared.range], repo)
    const knownPaths = new Set(
      numstat.trim().split('\n').filter(Boolean)
        .map((l) => newPathOf(l.split('\t').slice(2).join('\t'))),
    )
    saveFindings({ repo, number: target.storeKey, findings: cleanFindings(artifact, knownPaths), createdAt })
  } else {
    saveAskYourself({ repo, number: target.storeKey, questions: cleanQuestions(artifact), createdAt })
  }

  markReviewToolPosted(repo, target.storeKey, job, tool)
  return { saved: tool, createdAt }
})
