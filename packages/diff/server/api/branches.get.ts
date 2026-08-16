// Local branches for the branch-review picker. No gh — this is pure local
// git, so a change can be reviewed before it is ever pushed or PR'd.

export interface BranchInfo {
  name: string
  oid: string
  subject: string
  committedAt: string
  isCurrent: boolean
  isDefault: boolean
}

export default defineEventHandler(async (event) => {
  const path = resolveRepoPath(event)

  const [raw, current, def] = await Promise.all([
    run(
      'git',
      [
        'for-each-ref',
        '--sort=-committerdate',
        '--format=%(refname:short)%09%(objectname:short)%09%(committerdate:iso8601-strict)%09%(subject)',
        'refs/heads',
      ],
      path,
    ),
    run('git', ['branch', '--show-current'], path).then((s) => s.trim()).catch(() => ''),
    defaultBranch(path),
  ])

  const branches: BranchInfo[] = []
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue
    const [name, oid, committedAt, ...rest] = line.split('\t')
    if (!name) continue
    branches.push({
      name,
      oid: oid ?? '',
      committedAt: committedAt ?? '',
      subject: rest.join('\t'),
      isCurrent: name === current,
      isDefault: name === def,
    })
  }

  return { branches, current, defaultBranch: def }
})
