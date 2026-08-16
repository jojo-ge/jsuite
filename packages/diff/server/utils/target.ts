// A "review target" is what jDiff renders a diff and review guidance for.
// Historically that was always a GitHub PR (identified by ?number=); a target
// can now also be a LOCAL branch (identified by ?branch=, diffed against a
// ?base= that defaults to the repo's default branch), so a change can be
// reviewed before any PR exists.
//
// Every shared route (diff, file, graph, ask, analyze, and the artifact
// stores) funnels its ?number=/?branch= params through here so the two kinds
// stay in lockstep. The only real differences between them:
//   - a PR's head lives on GitHub and is fetched into refs/jdiff/pr-<n>;
//     a branch's head is already a local ref.
//   - a PR's base comes from `gh pr view`; a branch's base is the ?base= arg.

export interface ParsedTarget {
  kind: 'pr' | 'branch'
  // Identifier used in place of the old bare PR number everywhere artifacts
  // are stored/keyed (rating/risk/tour/ask stores, the AI job registry, the
  // diff cache). PR: the number ("123"). Branch: "branch/<name>".
  storeKey: string
  number: string | null
  branch: string | null
  // Requested base for branch targets (may be null → resolve the default
  // branch at prepare time). Always null for PRs (base comes from gh).
  base: string | null
}

export interface PreparedTarget extends ParsedTarget {
  // Resolved base branch (short name).
  base: string
  // Ref that holds the head version of the files (usable in `git show`).
  headRef: string
  // Head commit sha — the diff cache key.
  headOid: string
  // `git diff <range>` — merge-base (three-dot) so only the target's own
  // changes show, same as GitHub.
  range: string
}

// Branch/ref names we will hand to git as CLI args. execFile avoids shell
// injection, but a value starting with "-" could still be read as a flag, and
// ".." / control chars have no business in a ref — reject them up front.
function isSafeRef(ref: string): boolean {
  if (!ref || ref.length > 255) return false
  if (ref.startsWith('-') || ref.startsWith('/') || ref.endsWith('/')) return false
  if (ref.includes('..') || ref.includes('//')) return false
  // git-legal-ish: word chars, slash, dot, plus, hyphen. No spaces or ~^:?*[.
  return /^[\w./+-]+$/.test(ref)
}

// Pure param → target parse (no git/gh calls), so read-only routes that just
// need the storeKey (rating.get, ai-jobs, …) can use it directly.
export function parseTargetParams(p: {
  number?: unknown
  branch?: unknown
  base?: unknown
}): ParsedTarget {
  const number = p.number == null ? '' : String(p.number)
  const branch = p.branch == null ? '' : String(p.branch)
  const base = p.base == null ? '' : String(p.base)

  if (number) {
    if (!/^\d+$/.test(number)) throw createError({ statusCode: 400, message: 'bad ?number=' })
    return { kind: 'pr', storeKey: number, number, branch: null, base: null }
  }
  if (branch) {
    if (!isSafeRef(branch)) throw createError({ statusCode: 400, message: 'bad ?branch=' })
    if (base && !isSafeRef(base)) throw createError({ statusCode: 400, message: 'bad ?base=' })
    return { kind: 'branch', storeKey: `branch/${branch}`, number: null, branch, base: base || null }
  }
  throw createError({ statusCode: 400, message: 'need ?number= or ?branch=' })
}

export function resolveTarget(event: any): ParsedTarget {
  return parseTargetParams(getQuery(event))
}

export function resolveTargetFromBody(body: any): ParsedTarget {
  return parseTargetParams(body ?? {})
}

// The head ref that holds this target's version of the files, WITHOUT fetching
// (file/ask endpoints fetch lazily only if the ref is missing).
export function headRefOf(t: ParsedTarget): string {
  return t.kind === 'pr' ? `refs/jdiff/pr-${t.number}` : t.branch!
}

// Short human label for logs and prompts ("#123" / "branch feature-x").
export function targetLabel(t: ParsedTarget): string {
  return t.kind === 'pr' ? `#${t.number}` : `branch ${t.branch}`
}

// The repo's default branch — used as a branch target's base when none was
// requested. Prefer the local origin/HEAD, fall back to gh, then to "main".
export async function defaultBranch(repo: string): Promise<string> {
  try {
    const out = (await run('git', ['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD'], repo)).trim()
    if (out) return out.replace(/^origin\//, '')
  } catch { /* no origin/HEAD ref locally */ }
  try {
    const info = JSON.parse(await run('gh', ['repo', 'view', '--json', 'defaultBranchRef'], repo))
    if (info.defaultBranchRef?.name) return String(info.defaultBranchRef.name)
  } catch { /* offline / not a gh repo */ }
  return 'main'
}

// Resolve base + head refs and make sure they exist locally, so the caller can
// run `git diff <range>` / `git show <headRef>:<path>`. For PRs this fetches
// the base and the PR head into local refs; for branches it just verifies the
// refs and resolves the head sha.
export async function prepareTarget(t: ParsedTarget, repo: string): Promise<PreparedTarget> {
  if (t.kind === 'pr') {
    const meta = JSON.parse(await run('gh', ['pr', 'view', t.number!, '--json', 'baseRefName,headRefOid'], repo))
    const base: string = meta.baseRefName
    const headOid: string = meta.headRefOid
    const headRef = `refs/jdiff/pr-${t.number}`
    await run(
      'git',
      [
        'fetch', '--quiet', 'origin',
        `+refs/heads/${base}:refs/remotes/origin/${base}`,
        `+refs/pull/${t.number}/head:${headRef}`,
      ],
      repo,
    )
    return { ...t, base, headRef, headOid, range: `origin/${base}...${headRef}` }
  }

  const base = t.base || await defaultBranch(repo)
  const headRef = t.branch!
  const headOid = (await run('git', ['rev-parse', '--verify', '--quiet', `${headRef}^{commit}`], repo)).trim()
  if (!headOid) throw createError({ statusCode: 400, message: `no such local branch: ${headRef}` })
  const baseOid = (await run('git', ['rev-parse', '--verify', '--quiet', `${base}^{commit}`], repo)).trim()
  if (!baseOid) throw createError({ statusCode: 400, message: `no such base ref: ${base}` })
  return { ...t, base, headRef, headOid, range: `${base}...${headRef}` }
}

// Title/body for the analyze prompt. PR: from gh. Branch: the tip commit's
// subject/body, which is the closest thing a not-yet-PR'd change has.
export async function targetMeta(
  t: PreparedTarget,
  repo: string,
): Promise<{ title: string; body: string }> {
  if (t.kind === 'pr') {
    const meta = JSON.parse(await run('gh', ['pr', 'view', t.number!, '--json', 'title,body'], repo))
    return { title: String(meta.title ?? ''), body: String(meta.body ?? '') }
  }
  const subject = (await run('git', ['log', '-1', '--format=%s', t.headRef], repo)).trim()
  const body = (await run('git', ['log', '-1', '--format=%b', t.headRef], repo)).trim()
  return { title: subject || t.branch!, body }
}
