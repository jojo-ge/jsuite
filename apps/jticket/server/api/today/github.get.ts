// The Today page's GitHub half: my open PRs with their CI rolled up, and the
// PRs waiting on my review — both read through `gh` in the codebase's clone
// (?repo= is a codebase path). A gh failure comes back as `error`, not a 500,
// so the rest of the page still renders.
type Check = { conclusion?: string; status?: string; state?: string }

function ciOf(checks: Check[]) {
  const outcome = (c: Check) => (c.conclusion || c.state || c.status || '').toUpperCase()
  const failed = checks.filter((c) => ['FAILURE', 'ERROR', 'TIMED_OUT', 'CANCELLED', 'ACTION_REQUIRED'].includes(outcome(c))).length
  const pending = checks.filter((c) => ['', 'PENDING', 'QUEUED', 'IN_PROGRESS', 'EXPECTED', 'WAITING'].includes(outcome(c))).length
  return { total: checks.length, failed, pending, state: failed ? 'failed' : pending ? 'pending' : checks.length ? 'passed' : 'none' }
}

export default defineEventHandler(async (event) => {
  const repo = String(getQuery(event).repo ?? '')
  if (!repo) throw createError({ statusCode: 400, statusMessage: 'send ?repo=<codebase path>' })
  const cwd = resolveRepoDir(repo)
  try {
    const [mine, asked] = await Promise.all([
      run('gh', ['pr', 'list', '--author', '@me', '--state', 'open', '--limit', '30',
        '--json', 'number,title,url,isDraft,reviewDecision,headRefName,statusCheckRollup'], cwd),
      run('gh', ['pr', 'list', '--search', 'review-requested:@me', '--state', 'open', '--limit', '30',
        '--json', 'number,title,url,isDraft,author'], cwd),
    ])
    return {
      error: '',
      mine: JSON.parse(mine).map(({ statusCheckRollup, ...pr }: any) => ({ ...pr, ci: ciOf(statusCheckRollup ?? []) })),
      reviewRequested: JSON.parse(asked).map((pr: any) => ({ ...pr, author: pr.author?.login ?? '' })),
    }
  } catch (err: any) {
    return { error: String(err.statusMessage ?? err.message ?? err), mine: [], reviewRequested: [] }
  }
})
