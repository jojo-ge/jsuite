// The Today page's GitHub half: my open PRs with their CI rolled up, and the
// PRs waiting on my review — both read through `gh` in the codebase's clone
// (?repo= is a codebase path). Drafts are left out of both unless ?drafts=1.
// Answered from the cache (ghCache.ts; fresh for 30s — CI moves): `refreshing`
// says a fresher copy is on its way, ?force=1 reads GitHub now. A gh failure
// comes back as `error`, not a 500, so the rest of the page still renders.
type Check = { conclusion?: string; status?: string; state?: string }

const TODAY_FRESH_MS = 30_000
const PAGE = '30'

function ciOf(checks: Check[]) {
  const outcome = (c: Check) => (c.conclusion || c.state || c.status || '').toUpperCase()
  const failed = checks.filter((c) => ['FAILURE', 'ERROR', 'TIMED_OUT', 'CANCELLED', 'ACTION_REQUIRED'].includes(outcome(c))).length
  const pending = checks.filter((c) => ['', 'PENDING', 'QUEUED', 'IN_PROGRESS', 'EXPECTED', 'WAITING'].includes(outcome(c))).length
  return { total: checks.length, failed, pending, state: failed ? 'failed' : pending ? 'pending' : checks.length ? 'passed' : 'none' }
}

async function read(cwd: string, drafts: boolean) {
  const [mine, asked] = await Promise.all([
    run('gh', ['pr', 'list', '--author', '@me', '--state', 'open', '--limit', PAGE, ...(drafts ? [] : ['--draft=false']),
      '--json', 'number,title,url,isDraft,reviewDecision,headRefName,statusCheckRollup'], cwd),
    run('gh', ['pr', 'list', '--search', `review-requested:@me${drafts ? '' : ' draft:false'}`, '--state', 'open', '--limit', PAGE,
      '--json', 'number,title,url,isDraft,author'], cwd),
  ])
  return {
    mine: JSON.parse(mine).map(({ statusCheckRollup, ...pr }: any) => ({ ...pr, ci: ciOf(statusCheckRollup ?? []) })),
    reviewRequested: JSON.parse(asked).map((pr: any) => ({ ...pr, author: pr.author?.login ?? '' })),
  }
}

export default defineEventHandler(async (event) => {
  const q = getQuery(event)
  const repo = String(q.repo ?? '')
  if (!repo) throw createError({ statusCode: 400, statusMessage: 'send ?repo=<codebase path>' })
  const cwd = resolveRepoDir(repo)
  const drafts = q.drafts === '1' || q.drafts === 'true'
  try {
    const hit = await ghCached(ghKey('today', cwd, drafts ? 'drafts' : 'ready'), () => read(cwd, drafts), { fresh: TODAY_FRESH_MS, force: !!q.force })
    return { error: '', ...hit.value, fetchedAt: new Date(hit.fetchedAt).toISOString(), refreshing: hit.refreshing }
  } catch (err: any) {
    return { error: String(err.statusMessage ?? err.message ?? err), mine: [], reviewRequested: [], fetchedAt: '', refreshing: false }
  }
})
