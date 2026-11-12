import { describe, expect, it } from 'vitest'
import { inWritableRepo, isReadOnlyCommand, LIVE_BASE, parseSandboxRepos, sandboxPromptFor } from './sandboxRules'

describe('isReadOnlyCommand', () => {
  it('lets git reads through, past global options', () => {
    expect(isReadOnlyCommand('git', ['status'])).toBe(true)
    expect(isReadOnlyCommand('git', ['-C', '/repo', 'rev-parse', 'HEAD'])).toBe(true)
    expect(isReadOnlyCommand('git', ['-c', 'core.pager=cat', 'diff', '--stat', 'a...b'])).toBe(true)
    expect(isReadOnlyCommand('/usr/bin/git', ['for-each-ref', 'refs/heads'])).toBe(true)
    expect(isReadOnlyCommand('git', ['worktree', 'list', '--porcelain'])).toBe(true)
    expect(isReadOnlyCommand('git', ['remote', 'get-url', 'origin'])).toBe(true)
    expect(isReadOnlyCommand('git', ['config', '--get', 'remote.origin.url'])).toBe(true)
    expect(isReadOnlyCommand('git', ['fetch', '--quiet', 'origin'])).toBe(true)
    expect(isReadOnlyCommand('git', ['merge-tree', '--write-tree', 'a', 'b'])).toBe(true)
    expect(isReadOnlyCommand('git', ['fetch', '--quiet', 'origin', '+refs/heads/main:refs/remotes/origin/main'])).toBe(true)
  })

  it('refuses everything that moves a ref, the index, a worktree or a remote', () => {
    for (const args of [
      ['push', 'origin', 'main'],
      ['fetch', 'origin', '+refs/pull/1/head:refs/heads/jreview/pr-1'],
      ['merge', '--no-ff', 'tick-1'],
      ['commit', '-m', 'x'],
      ['checkout', 'main'],
      ['switch', '-c', 'x'],
      ['reset', '--hard'],
      ['rebase', 'main'],
      ['worktree', 'add', '../x'],
      ['worktree', 'remove', '../x'],
      ['update-ref', 'refs/heads/x', 'HEAD'],
      ['tag', 'v1'],
      ['config', 'user.name', 'x'],
      ['stash'],
      [],
    ]) expect(isReadOnlyCommand('git', args), args.join(' ')).toBe(false)
  })

  it('reads git branch as a listing only when it is one', () => {
    expect(isReadOnlyCommand('git', ['branch'])).toBe(true)
    expect(isReadOnlyCommand('git', ['branch', '-a', '--format=%(refname)'])).toBe(true)
    expect(isReadOnlyCommand('git', ['branch', '--list', 'tick-*'])).toBe(true)
    expect(isReadOnlyCommand('git', ['branch', '--show-current'])).toBe(true)
    expect(isReadOnlyCommand('git', ['branch', '--merged', 'main'])).toBe(true)
    expect(isReadOnlyCommand('git', ['branch', 'new-branch', 'main'])).toBe(false)
    expect(isReadOnlyCommand('git', ['branch', '-D', 'old'])).toBe(false)
    expect(isReadOnlyCommand('git', ['branch', '--list', '-d', 'old'])).toBe(false)
    expect(isReadOnlyCommand('git', ['branch', '--set-upstream-to=origin/x'])).toBe(false)
  })

  it('lets gh reads through and refuses gh writes', () => {
    expect(isReadOnlyCommand('gh', ['pr', 'list', '--json', 'number'])).toBe(true)
    expect(isReadOnlyCommand('gh', ['pr', 'view', '12'])).toBe(true)
    expect(isReadOnlyCommand('gh', ['repo', 'view', '--json', 'nameWithOwner'])).toBe(true)
    expect(isReadOnlyCommand('gh', ['api', 'user', '--jq', '.login'])).toBe(true)
    expect(isReadOnlyCommand('gh', ['api', '-X', 'GET', 'repos/o/r/pulls'])).toBe(true)
    expect(isReadOnlyCommand('gh', ['pr', 'create', '--fill'])).toBe(false)
    expect(isReadOnlyCommand('gh', ['pr', 'merge', '12'])).toBe(false)
    expect(isReadOnlyCommand('gh', ['pr', 'comment', '12', '-b', 'x'])).toBe(false)
    expect(isReadOnlyCommand('gh', ['api', '-X', 'POST', 'repos/o/r/pulls/1/reviews'])).toBe(false)
    expect(isReadOnlyCommand('gh', ['api', '--method=PATCH', 'x'])).toBe(false)
    expect(isReadOnlyCommand('gh', ['api', 'repos/o/r/pulls/1/reviews', '-f', 'event=COMMENT'])).toBe(false)
    expect(isReadOnlyCommand('gh', ['api', 'repos/o/r/pulls/1/reviews', '--input', '-'])).toBe(false)
    // graphql always POSTs: a `query` document reads, anything else doesn't.
    const search = 'query($q: String!, $n: Int!) { search(query: $q, type: ISSUE, first: $n) { issueCount } }'
    expect(isReadOnlyCommand('gh', ['api', 'graphql', '-f', `query=${search}`, '-f', 'q=repo:o/r is:pr', '-F', 'n=25'])).toBe(true)
    expect(isReadOnlyCommand('gh', ['api', 'graphql', '-f', 'query=mutation { addStar(input: {starrableId: "x"}) { clientMutationId } }'])).toBe(false)
    expect(isReadOnlyCommand('gh', ['api', 'graphql', '-f', `query=${search} mutation M { x }`])).toBe(false)
    expect(isReadOnlyCommand('gh', ['api', 'graphql', '-F', 'query=@doc.graphql'])).toBe(false)
    expect(isReadOnlyCommand('gh', ['api', 'graphql', '--input', '-'])).toBe(false)
    expect(isReadOnlyCommand('gh', ['api', 'graphql', '-f', 'q=x'])).toBe(false)
  })

  it('refuses commands it does not know', () => {
    expect(isReadOnlyCommand('rm', ['-rf', '/tmp/x'])).toBe(false)
    expect(isReadOnlyCommand('osascript', ['-e', 'x'])).toBe(false)
  })
})

describe('writable repos', () => {
  it('parses absolute paths and drops the rest', () => {
    expect(parseSandboxRepos(undefined)).toEqual([])
    expect(parseSandboxRepos('/tmp/fixture/:relative: /tmp/b ')).toEqual(['/tmp/fixture', '/tmp/b'])
  })

  it('matches a repo and what is inside it, never a sibling with the same prefix', () => {
    const repos = ['/tmp/fixture']
    expect(inWritableRepo('/tmp/fixture', repos)).toBe(true)
    expect(inWritableRepo('/tmp/fixture/', repos)).toBe(true)
    expect(inWritableRepo('/tmp/fixture/sub/dir', repos)).toBe(true)
    expect(inWritableRepo('/tmp/fixture-2', repos)).toBe(false)
    expect(inWritableRepo('/Users/me/code/kraken', repos)).toBe(false)
    expect(inWritableRepo('/tmp/fixture', [])).toBe(false)
  })

  it("takes a linked worktree of a writable repo wherever it lives, by the repo's git common dir", () => {
    const repos = ['/tmp/fixture', '/tmp/bare.git']
    const reviewTree = '/Users/me/code/jsuite/.sandbox/data/jreview/worktrees/proj-1-review'
    expect(inWritableRepo(reviewTree, repos, '/tmp/fixture/.git')).toBe(true)
    expect(inWritableRepo(reviewTree, repos, '/tmp/fixture/.git/')).toBe(true)
    expect(inWritableRepo(reviewTree, repos, '/tmp/bare.git')).toBe(true)
  })

  it('still refuses a worktree of any other repo, or a cwd with no repo', () => {
    const repos = ['/tmp/fixture']
    const tree = '/Users/me/code/jsuite-worktrees/x'
    expect(inWritableRepo(tree, repos, '/Users/me/code/jsuite/.git')).toBe(false)
    expect(inWritableRepo(tree, repos, '/tmp/fixture-2/.git')).toBe(false)
    expect(inWritableRepo(tree, repos, '/tmp/fixture/.git/worktrees')).toBe(false)
    expect(inWritableRepo(tree, repos, null)).toBe(false)
    expect(inWritableRepo(tree, repos)).toBe(false)
  })
})

describe('sandboxPromptFor', () => {
  it('leaves prompts alone on the live base', () => {
    expect(sandboxPromptFor(`GET ${LIVE_BASE}/api/x`, LIVE_BASE)).toBe(`GET ${LIVE_BASE}/api/x`)
    expect(sandboxPromptFor('x', '')).toBe('x')
  })

  it('rewrites every live URL and says where it was sent from, on one line', () => {
    const out = sandboxPromptFor(`GET ${LIVE_BASE}/api/a then POST ${LIVE_BASE}/api/b`, 'http://localhost:43100')
    expect(out).not.toContain(`${LIVE_BASE}/api`)
    expect(out).toContain('GET http://localhost:43100/api/a then POST http://localhost:43100/api/b')
    expect(out).toContain('SANDBOX')
    expect(out).not.toContain('\n')
  })
})
