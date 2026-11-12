// Which harness a session ran under — stamped on its ledger row as it is
// dispatched, so a later comparison ("did last week's change help?") can tell
// the sessions before a harness change from the ones after.
//
// The harness is what decides how a session behaves, apart from the codebase
// and the ticket: the engine and prompt code, the skills, and the suite-wide
// prompt overrides. Its version is a content hash of those — not the commit:
// a docs commit changes nothing a session sees, and the live app runs from a
// working tree that is often ahead of HEAD.
//
//   harness  `<trees>[+<dirty>][~<prompts>]`
//            trees   = the committed harness paths (git tree ids at HEAD)
//            dirty   = uncommitted changes under those paths, when there are any
//            prompts = the suite-wide prompt overrides, when there are any
//   commit   HEAD, for a human to find the code by
//   setup    the codebase's own tuning — its prompt overrides, worktree guide
//            and verification rules ('' when it has none). Kept apart: it
//            explains a difference between codebases, not between harnesses.
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { suiteRoot } from '@jsuite/data'
import type { KnownRepo, Store } from './store'

/** The paths whose content is the harness — what the engine runs and what sessions are told. */
export const HARNESS_PATHS = ['apps/jticket/server', 'apps/jticket/app/utils', 'apps/jticket/.claude/skills', '.claude/skills', 'packages/herdr', 'bin']

export interface HarnessStamp {
  harness: string
  commit: string
  setup: string
}

const h8 = (s: string) => createHash('sha1').update(s).digest('hex').slice(0, 8)

/** Stable JSON: object keys sorted, so two equal settings hash alike however they were written. */
export function stableJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableJson).join(',')}]`
  if (v && typeof v === 'object') {
    return `{${Object.keys(v as object)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableJson((v as Record<string, unknown>)[k])}`)
      .join(',')}}`
  }
  return JSON.stringify(v ?? null)
}

export interface GitHarnessState {
  commit: string
  /** One tree id per harness path at HEAD ('' for a path HEAD doesn't have). */
  trees: string[]
  /** `git diff HEAD` over the harness paths, plus the names of untracked files under them. */
  dirty: string
}

const GIT_TTL_MS = 60_000
let gitCache: { at: number; state: GitHarnessState } | null = null

function git(root: string, args: string[]): string {
  return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'], timeout: 15_000 })
}

/** The checkout's harness state, from git. Cached for a minute — dispatches come in bursts. */
export function readGitHarnessState(root = suiteRoot(), now = Date.now()): GitHarnessState {
  if (gitCache && now - gitCache.at < GIT_TTL_MS) return gitCache.state
  const state: GitHarnessState = { commit: '', trees: [], dirty: '' }
  try {
    state.commit = git(root, ['rev-parse', '--short=12', 'HEAD']).trim()
    state.trees = HARNESS_PATHS.map((p) => {
      try {
        return git(root, ['rev-parse', `HEAD:${p}`]).trim()
      } catch {
        return ''
      }
    })
    state.dirty = git(root, ['diff', 'HEAD', '--', ...HARNESS_PATHS]) + git(root, ['ls-files', '--others', '--exclude-standard', '--', ...HARNESS_PATHS])
  } catch {
    // Not a git checkout (a packaged install): the version is just the prompts.
  }
  gitCache = { at: now, state }
  return state
}

/** The harness id — see the header for its parts. */
export function harnessId(git: GitHarnessState, promptDefaults: unknown): string {
  const trees = git.trees.some(Boolean) ? h8(git.trees.join(':')) : 'unknown'
  const dirty = git.dirty.trim() ? `+${h8(git.dirty)}` : ''
  const prompts = promptDefaults && typeof promptDefaults === 'object' && Object.keys(promptDefaults).length ? `~${h8(stableJson(promptDefaults))}` : ''
  return `${trees}${dirty}${prompts}`
}

/** A codebase's own tuning as one short hash; '' when it has none. */
export function codebaseSetupId(repo: Pick<KnownRepo, 'prompts' | 'worktreeGuide' | 'verificationRules'> | undefined): string {
  if (!repo) return ''
  const tuned = Object.keys(repo.prompts ?? {}).length || repo.worktreeGuide || (repo.verificationRules ?? []).length
  return tuned ? h8(stableJson({ prompts: repo.prompts ?? {}, worktreeGuide: repo.worktreeGuide ?? null, verificationRules: repo.verificationRules ?? [] })) : ''
}

/** What a session dispatched now, into `repoPath`, runs under. */
export function harnessStamp(store: Pick<Store, 'promptDefaults' | 'repos'>, repoPath: string): HarnessStamp {
  const state = readGitHarnessState()
  return {
    harness: harnessId(state, store.promptDefaults),
    commit: state.commit,
    setup: codebaseSetupId(store.repos.find((r) => r.path === repoPath)),
  }
}
