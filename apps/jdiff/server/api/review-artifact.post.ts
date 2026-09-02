import { createHash } from 'node:crypto'
import type { ParsedTarget, PreparedTarget } from '../utils/target'

// Where the herdr sessions hand their work back. The `jdiff-review` /
// `jdiff-tour` / `jdiff-chains` / `jdiff-hunt` skills POST each artifact as
// soon as it is ready — one bad artifact costs only that tool, the rest land
// independently.
// Payloads are validated through the same cleaners for every caller, then
// saved to the artifact stores the review pages already read.
//
// Tours carry an optional sibling `variant` ('overview' when absent,
// 'detail', 'chain:<slug>' naming a chain from the chains manifest, or
// 'issue:<slug>' naming a high-severity issue from the hunt manifest). A
// `chains` POST saves its manifest AND fans out one herdr session per chain;
// a `hunt` POST does the same for each HIGH issue — walkers are registered
// synchronously here, launched by a fire-and-forget loop.
//
// Body: { repo, number | branch (+ base?), tool: 'rating'|'risk'|'tour'|'questions'|'findings'|'chains'|'hunt', variant?, artifact }
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
    const mergeBase = (await run('git', ['merge-base', prepared.leftSpec, prepared.rightSpec!], repo)).trim()
    const diffHash = createHash('sha256').update(`${mergeBase}..${prepared.headOid}`).digest('hex')
    saveRating({ repo, number: target.storeKey, rating, createdAt, diffHash })
  } else if (tool === 'risk') {
    // Only files actually in the diff can carry a risk level.
    const prepared = await prepareTarget(target, repo)
    const numstat = await run('git', ['diff', '--numstat', '-M', ...prepared.diffArgs], repo)
    const knownPaths = new Set(
      numstat.trim().split('\n').filter(Boolean)
        .map((l) => newPathOf(l.split('\t').slice(2).join('\t'))),
    )
    const risks = cleanRisks(artifact, knownPaths)
    if (!risks.length) throw createError({ statusCode: 400, message: 'no valid file risks in payload' })
    saveRiskMap({ repo, number: target.storeKey, risks, createdAt })
  } else if (tool === 'tour') {
    const known = new Set([
      ...(loadChains(repo, target.storeKey)?.chains ?? []).map((c) => `chain:${c.id}`),
      ...walkableIssues(loadHunt(repo, target.storeKey)?.issues ?? []).map((i) => `issue:${i.id}`),
    ])
    const variant = parseTourVariant(body?.variant, known)
    if (variant !== 'overview') job = variant === 'detail' ? 'detail' : variant
    saveTour({ repo, number: target.storeKey, variant, tour: cleanTour(artifact, variant), createdAt })
  } else if (tool === 'chains') {
    job = 'chains-scope'
    const manifest = cleanChains(artifact)
    await supersedeWalkers(repo, target.storeKey, 'chain:')
    saveChains({ repo, number: target.storeKey, ...manifest, createdAt })
    const prepared = await prepareTarget(target, repo)
    const targetArgs = promptTargetArgs(target, prepared)
    const ids = registerWalkers(repo, target.storeKey, 'chain', manifest.chains.map((c) => c.id))
    fanOutWalkers({
      repo,
      storeKey: target.storeKey,
      kind: {
        prefix: 'chain',
        tabLabel: `chains ${targetLabel(target)}`,
        prompt: (id) => `/jdiff-chains chain=${id} ${targetArgs} `
          + `range=${prepared.range} head=${prepared.headRef}`,
      },
      ids,
    }).catch(fanOutFailed(repo, target.storeKey, 'chains-scope'))
  } else if (tool === 'hunt') {
    // The hunt manifest lists every suspected defect; only the HIGH ones get
    // a walker session — a tour that explains that one issue in depth.
    job = 'hunt-scope'
    const manifest = cleanHunt(artifact)
    await supersedeWalkers(repo, target.storeKey, 'issue:')
    saveHunt({ repo, number: target.storeKey, ...manifest, createdAt })
    const prepared = await prepareTarget(target, repo)
    const targetArgs = promptTargetArgs(target, prepared)
    const ids = registerWalkers(repo, target.storeKey, 'issue',
      walkableIssues(manifest.issues).map((i) => i.id))
    if (ids.length) {
      fanOutWalkers({
        repo,
        storeKey: target.storeKey,
        kind: {
          prefix: 'issue',
          tabLabel: `hunt ${targetLabel(target)}`,
          prompt: (id) => `/jdiff-hunt issue=${id} ${targetArgs} `
            + `range=${prepared.range} head=${prepared.headRef}`,
        },
        ids,
      }).catch(fanOutFailed(repo, target.storeKey, 'hunt-scope'))
    }
  } else if (tool === 'findings') {
    // Findings must point at files actually in the diff; an empty list is a
    // valid artifact (a clean review) and saves as such.
    const prepared = await prepareTarget(target, repo)
    const numstat = await run('git', ['diff', '--numstat', '-M', ...prepared.diffArgs], repo)
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

// A new manifest supersedes the previous generation: interrupt any walker of
// that kind still live from the old one so it can't post into the new set.
async function supersedeWalkers(repo: string, storeKey: string, prefix: string): Promise<void> {
  for (const d of targetDispatches(repo, storeKey)) {
    if (!d.job.startsWith(prefix)) continue
    clearReviewDispatch(repo, storeKey, d.job)
    await herdrJson(['agent', 'send-keys', d.agent, 'esc']).catch(() => {})
  }
}

// Register every walker dispatch before responding, so ai-jobs shows them
// pending immediately; the fan-out loop fills in agent/tab as each starts.
function registerWalkers(repo: string, storeKey: string, prefix: 'chain' | 'issue', ids: string[]): string[] {
  for (const id of ids) {
    registerReviewDispatch({
      repo,
      number: storeKey,
      job: `${prefix}:${id}`,
      startedAt: Date.now(),
      agent: '(starting)',
      workspaceId: '',
      tabId: '',
    })
  }
  return ids
}

/** How a walker prompt names its target: a PR number, or branch + base. */
function promptTargetArgs(target: ParsedTarget, prepared: PreparedTarget): string {
  return target.kind === 'pr'
    ? `number=${target.number}`
    : `branch=${target.branch} base=${prepared.base}`
}

function fanOutFailed(repo: string, storeKey: string, jobKind: ReviewJob) {
  return (err: any) => {
    appendFailures(repo, storeKey, [{
      jobKind,
      message: `walker fan-out failed: ${String(err?.message ?? err).slice(0, 400)}`,
      at: new Date().toISOString(),
    }])
  }
}
