import { createHash } from 'node:crypto'

// Where the herdr review session hands its work back. The `jdiff-review`
// skill POSTs each artifact as soon as it is ready — one bad artifact costs
// only that tool, the rest land independently. Payloads are validated through
// the same cleaners for every caller, then saved to the artifact stores the
// review pages already read.
//
// Body: { repo, number | branch (+ base?), tool: 'rating'|'risk'|'tour'|'questions'|'findings', artifact }
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
    saveTour({ repo, number: target.storeKey, tour: cleanTour(artifact), createdAt })
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

  markReviewToolPosted(repo, target.storeKey, tool)
  return { saved: tool, createdAt }
})
