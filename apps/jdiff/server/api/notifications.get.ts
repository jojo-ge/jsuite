const REACTION_KEYS = ['+1', '-1', 'laugh', 'confused', 'heart', 'hooray', 'rocket', 'eyes'] as const

interface NotifEvent {
  id: string
  type: 'pr_opened' | 'comment'
  reason?: 'my_pr' | 'reply'
  prNumber: number
  prTitle?: string
  actor: string
  excerpt?: string
  createdAt: string
  url: string
}

export default defineEventHandler(async (event) => {
  const path = resolveRepoPath(event)
  const [userOut, prsOut, reviewOut, issueOut] = await Promise.all([
    run('gh', ['api', 'user'], path),
    run('gh', ['pr', 'list', '--limit', '100', '--json', 'number,title,author,createdAt,url'], path),
    run('gh', ['api', 'repos/{owner}/{repo}/pulls/comments?sort=created&direction=desc&per_page=100'], path),
    run('gh', ['api', 'repos/{owner}/{repo}/issues/comments?sort=created&direction=desc&per_page=100'], path),
  ])

  const me = JSON.parse(userOut).login as string
  const prs = JSON.parse(prsOut) as any[]
  const reviewComments = JSON.parse(reviewOut) as any[]
  // The issues/comments endpoint also returns comments on plain issues; keep PR ones only.
  const issueComments = (JSON.parse(issueOut) as any[]).filter((c) =>
    (c.html_url as string | undefined)?.includes('/pull/'),
  )

  const myPrs = new Set(prs.filter((p) => p.author?.login === me).map((p) => p.number))
  const titles = new Map<number, string>(prs.map((p) => [p.number, p.title]))
  const prNumberOf = (url: string | undefined) => Number(url?.split('/').pop() ?? 0)
  const excerpt = (s: string) => s.replace(/\s+/g, ' ').trim().slice(0, 120)

  const events: NotifEvent[] = []

  for (const p of prs) {
    if (p.author?.login === me) continue
    events.push({
      id: `pr-${p.number}`,
      type: 'pr_opened',
      prNumber: p.number,
      prTitle: p.title,
      actor: p.author?.login ?? '',
      createdAt: p.createdAt,
      url: p.url,
    })
  }

  // Review-comment replies point at their thread root; collect who spoke in each thread.
  const threadUsers = new Map<number, Set<string>>()
  for (const c of reviewComments) {
    const root = c.in_reply_to_id ?? c.id
    let users = threadUsers.get(root)
    if (!users) threadUsers.set(root, (users = new Set()))
    if (c.user?.login) users.add(c.user.login)
  }

  for (const c of reviewComments) {
    if (!c.user?.login || c.user.login === me) continue
    const prNumber = prNumberOf(c.pull_request_url)
    const onMyPr = myPrs.has(prNumber)
    const inMyThread = threadUsers.get(c.in_reply_to_id ?? c.id)?.has(me) ?? false
    if (!onMyPr && !inMyThread) continue
    events.push({
      id: `c-${c.id}`,
      type: 'comment',
      reason: onMyPr ? 'my_pr' : 'reply',
      prNumber,
      prTitle: titles.get(prNumber),
      actor: c.user.login,
      excerpt: excerpt(c.body ?? ''),
      createdAt: c.created_at,
      url: c.html_url,
    })
  }

  for (const c of issueComments) {
    if (!c.user?.login || c.user.login === me) continue
    const prNumber = prNumberOf(c.issue_url)
    if (!myPrs.has(prNumber)) continue
    events.push({
      id: `ic-${c.id}`,
      type: 'comment',
      reason: 'my_pr',
      prNumber,
      prTitle: titles.get(prNumber),
      actor: c.user.login,
      excerpt: excerpt(c.body ?? ''),
      createdAt: c.created_at,
      url: c.html_url,
    })
  }

  events.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))

  // Per-emoji reaction counts on my comments; the client diffs these between
  // polls to detect new reactions (the summary payload has no reactor/timestamp).
  const reactionSnapshots = []
  for (const c of [...reviewComments, ...issueComments]) {
    if (c.user?.login !== me) continue
    const counts: Record<string, number> = {}
    for (const k of REACTION_KEYS) {
      if (c.reactions?.[k]) counts[k] = c.reactions[k]
    }
    reactionSnapshots.push({
      id: `${c.pull_request_url ? 'c' : 'ic'}-${c.id}`,
      prNumber: prNumberOf(c.pull_request_url ?? c.issue_url),
      excerpt: excerpt(c.body ?? ''),
      counts,
      url: c.html_url,
    })
  }

  return { me, events: events.slice(0, 100), reactionSnapshots }
})
