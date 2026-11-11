// The rules behind a sandbox jTicket — pure, no Nitro, no I/O
// (sandboxRules.test.ts). server/utils/sandbox.ts applies them.
//
// A sandbox is a second jTicket started from a worktree (`./jsuite sandbox`)
// on its own port, over a COPY of .data. Its data can't hurt the live one,
// but everything else on the machine is shared: the git repos its projects
// point at, GitHub, herdr, and the jTicket the global skills talk to. So a
// sandbox reads freely and writes only where it's told it may:
//
//   - git / gh commands that change a repo or GitHub run only inside the
//     repos listed in JTICKET_SANDBOX_REPOS (throwaway fixtures); everywhere
//     else only read-only commands run
//   - herdr sessions start only with their cwd in one of those repos
//   - every session it does start is pointed back at the sandbox
//     (sandboxPromptFor), never at the live jTicket on :43000

/** The live jTicket's base — what every built-in prompt and skill names. */
export const LIVE_BASE = 'http://localhost:43000'

/**
 * git subcommands that never change a repo's refs, index, worktrees or config.
 * merge-tree and commit-tree write loose objects only — nothing points at
 * them until an update-ref, which is a write.
 */
const GIT_READ = new Set([
  'merge-tree', 'commit-tree',
  'status', 'log', 'show', 'diff', 'rev-parse', 'rev-list', 'merge-base', 'for-each-ref',
  'ls-files', 'ls-remote', 'ls-tree', 'cat-file', 'describe', 'shortlog', 'blame', 'grep',
  'show-ref', 'name-rev', 'cherry', 'count-objects', 'check-ref-format', 'var', 'version',
])

/** gh `<group> <verb>` pairs that only read. */
const GH_READ = new Set([
  'pr list', 'pr view', 'pr status', 'pr checks', 'pr diff',
  'repo view', 'repo list', 'run list', 'run view', 'issue list', 'issue view', 'auth status',
])

/** git's global options that take a value (`git -C dir status`), skipped to find the subcommand. */
const GIT_VALUE_OPTS = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace'])

function gitSubcommand(args: readonly string[]): { sub: string; rest: string[] } {
  let i = 0
  while (i < args.length && args[i]!.startsWith('-')) i += GIT_VALUE_OPTS.has(args[i]!) ? 2 : 1
  return { sub: args[i] ?? '', rest: args.slice(i + 1) }
}

/**
 * Whether `cmd args` only reads. Unknown commands and unknown subcommands
 * count as writes — the sandbox refuses what it can't vouch for.
 */
export function isReadOnlyCommand(cmd: string, args: readonly string[]): boolean {
  const bin = cmd.split('/').pop()!
  if (bin === 'git') {
    const { sub, rest } = gitSubcommand(args)
    if (GIT_READ.has(sub)) return true
    // Listing forms of commands that can also write.
    if (sub === 'branch') {
      // Any write flag writes; a listing flag makes positionals patterns/commits;
      // otherwise a positional is a branch being created.
      const writes = ['-d', '-D', '--delete', '-m', '-M', '--move', '-c', '-C', '--copy', '-f', '--force', '-u', '--set-upstream-to', '--unset-upstream', '--edit-description', '-t', '--track']
      if (rest.some((a) => writes.includes(a.split('=')[0]!))) return false
      const listing = ['--list', '-l', '--contains', '--no-contains', '--merged', '--no-merged', '--points-at', '--show-current']
      if (rest.some((a) => listing.includes(a.split('=')[0]!))) return true
      return rest.every((a) => a.startsWith('-'))
    }
    if (sub === 'worktree') return rest[0] === 'list'
    // A fetch only refreshes remote-tracking refs unless a refspec writes a
    // local ref (`+refs/pull/1/head:refs/heads/x`) — that one moves a branch.
    if (sub === 'fetch') return rest.every((a) => a.startsWith('-') || !a.includes(':') || a.split(':')[1]!.startsWith('refs/remotes/'))
    if (sub === 'remote') return rest.length === 0 || rest[0] === '-v' || rest[0] === 'get-url' || rest[0] === 'show'
    if (sub === 'config') return rest.includes('--get') || rest.includes('--get-all') || rest.includes('--list') || rest.includes('-l')
    if (sub === 'symbolic-ref') return !rest.some((a) => a === '-d' || a === '--delete') && rest.filter((a) => !a.startsWith('-')).length <= 1
    if (sub === 'stash') return rest[0] === 'list' || rest[0] === 'show'
    return false
  }
  if (bin === 'gh') {
    if (args[0] === 'api') {
      // gh api is a GET unless a method is named or a field is sent (fields make it a POST).
      const method = args.find((a, i) => args[i - 1] === '-X' || args[i - 1] === '--method' || a.startsWith('--method='))
      const m = (method?.replace('--method=', '') ?? '').toUpperCase()
      const fields = args.some((a) => ['-f', '-F', '--field', '--raw-field', '--input'].includes(a) || a.startsWith('--field=') || a.startsWith('--raw-field='))
      return m ? m === 'GET' : !fields
    }
    return GH_READ.has(`${args[0] ?? ''} ${args[1] ?? ''}`)
  }
  return false
}

/** JTICKET_SANDBOX_REPOS (colon-separated absolute paths), cleaned. */
export function parseSandboxRepos(raw: string | undefined): string[] {
  return (raw ?? '')
    .split(':')
    .map((p) => p.trim().replace(/\/+$/, ''))
    .filter((p) => p.startsWith('/'))
}

/** Whether `cwd` is one of the writable repos or inside one. */
export function inWritableRepo(cwd: string, repos: readonly string[]): boolean {
  const dir = cwd.replace(/\/+$/, '')
  return repos.some((r) => dir === r || dir.startsWith(`${r}/`))
}

/**
 * A prompt as a sandbox sends it: every mention of the live jTicket rewritten
 * to the sandbox's base, then one line saying so — the global skills a
 * session reads still name :43000, and only the session can route around them.
 */
export function sandboxPromptFor(prompt: string, base: string): string {
  if (!base || base === LIVE_BASE) return prompt
  const rewritten = prompt.split(LIVE_BASE).join(base)
  // One line: herdr submits the prompt as typed input, and a newline would submit early.
  return `${rewritten} — SANDBOX: you were dispatched by a sandbox jTicket at ${base}, not the live one. Send every jTicket call there: jt already does (JTICKET_URL is set); wherever a skill says ${LIVE_BASE} or :43000, use ${base} instead.`
}
