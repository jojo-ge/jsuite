import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

// A sandbox's guards against real git (TICK-954): a review's detached worktree
// of a writable fixture repo lives outside the repo's path, and still takes
// herdr sessions and git writes; a worktree of any other repo is refused.

const root = mkdtempSync(join(tmpdir(), 'jt-sandbox-wt-'))
const fixture = join(root, 'fixture')
const other = join(root, 'other')
const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@localhost', ...args], { cwd, stdio: 'ignore' })

function repo(dir: string) {
  mkdirSync(dir)
  git(dir, 'init', '-q', '-b', 'main')
  writeFileSync(join(dir, 'README.md'), 'x\n')
  git(dir, 'add', '.')
  git(dir, 'commit', '-qm', 'init')
}

let sandbox: typeof import('../server/utils/sandbox')

beforeAll(async () => {
  repo(fixture)
  repo(other)
  mkdirSync(join(root, 'reviews'))
  git(fixture, 'worktree', 'add', '-q', '--detach', join(root, 'reviews', 'fixture-review'), 'main')
  git(other, 'worktree', 'add', '-q', '--detach', join(root, 'reviews', 'other-review'), 'main')

  vi.stubEnv('JTICKET_SANDBOX', '1')
  vi.stubEnv('JTICKET_SANDBOX_REPOS', fixture)
  vi.stubGlobal('createError', (e: { statusCode: number; statusMessage: string }) => Object.assign(new Error(e.statusMessage), e))
  vi.resetModules()
  sandbox = await import('../server/utils/sandbox')
})

afterAll(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  rmSync(root, { recursive: true, force: true })
})

describe('sandbox guards and worktrees', () => {
  it("dispatches into a writable repo's linked worktree outside the repo", () => {
    expect(() => sandbox.assertDispatchAllowed(join(root, 'reviews', 'fixture-review'))).not.toThrow()
    expect(() => sandbox.assertCommandAllowed('git', ['checkout', '-q', 'main'], join(root, 'reviews', 'fixture-review'))).not.toThrow()
  })

  it('still refuses a worktree of another repo, and a plain directory', () => {
    expect(() => sandbox.assertDispatchAllowed(join(root, 'reviews', 'other-review'))).toThrow(/sandbox: refused/)
    expect(() => sandbox.assertDispatchAllowed(other)).toThrow(/sandbox: refused/)
    expect(() => sandbox.assertDispatchAllowed(join(root, 'reviews'))).toThrow(/sandbox: refused/)
    expect(() => sandbox.assertCommandAllowed('git', ['commit', '-m', 'x'], join(root, 'reviews', 'other-review'))).toThrow(/sandbox: refused/)
  })

  it('still takes the repo itself', () => {
    expect(() => sandbox.assertDispatchAllowed(fixture)).not.toThrow()
  })
})
