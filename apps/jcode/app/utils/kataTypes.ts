// The j-code kata format — shared by the server store and the UI (server
// files import these relatively, the jGrilling/jDiff pattern).
//
// A kata is authored from OUTSIDE the app by the Claude session that built the
// feature: it holds ONE core piece of the implementation back, stubs it in the
// repo, and posts the brief, a hint ladder and the reference answer here. The
// human writes the piece by hand; a herdr marking session checks the attempt
// and records a verdict. The app renders the kata one rung at a time — brief,
// hints, answer — and never shows a rung the human hasn't reached.

import type { Block } from '@jsuite/documents/types'

/** Where the hole is in the repo. */
export interface KataTarget {
  /** Repo-relative path of the file carrying the stub. */
  file: string
  /** The symbol to implement, e.g. `TokenBucket.refill`. */
  symbol: string
  /** One-line signature, shown as the kata's contract. */
  signature?: string
  /** Language for the signature chip; defaults from the file extension. */
  lang?: string
}

export type SandboxLang = 'ts' | 'js' | 'php' | 'py'

/**
 * The problem's own little environment under .data/jcode/sandbox/<key>/ —
 * `solution.<ext>` (the stub the human fills in), `cases.<ext>` (named
 * inputs + expected outputs), optional `types.<ext>`, and the app's own
 * `run.<ext>` executor. The kata is solved HERE; the repo keeps Claude's
 * shipped implementation untouched.
 */
export interface KataSandbox {
  lang: SandboxLang
  /** Absolute path of the sandbox directory. */
  dir: string
  /** The file the human edits, e.g. `solution.ts`. */
  entry: string
  /** The exported function under test (the last segment of target.symbol by default). */
  fn: string
  /** Command that runs every case, from `dir`. */
  run: string
  /** Files the build session authored (the runner is not listed). */
  files: string[]
}

/** How to see the piece go red → green. */
export interface KataTests {
  /** Run from the repo root, e.g. `pnpm vitest run src/bucket.test.ts`. */
  command: string
  /** The test files that exercise the piece. */
  files?: string[]
}

export type AttemptResult = 'passed' | 'failed'

/** One hand-off to the marker: what was submitted and what it decided. */
export interface KataAttempt {
  id: string
  n: number
  submittedAt: string
  /** Repo katas: `git diff HEAD -- <target.file>` at submission — best effort, may be empty. */
  diff?: string
  /** Sandbox katas: the entry file as submitted. */
  code?: string
  /** The answer was already revealed when this was submitted — a code-along check. */
  afterReveal?: boolean
  /** How the marker was reached; `error` when herdr dispatch failed (mark by hand). */
  marker?: { agent?: string; workspaceId?: string; tabId?: string; error?: string }
  status: 'marking' | AttemptResult
  markedAt?: string
  /** The marker's verdict, markdown. Never contains the answer before reveal. */
  verdict?: string
  /** Targeted feedback on THIS attempt — jspec blocks (prose, callout, code, diff…). */
  feedback?: Block[]
  /** Tail of the test run the marker did. */
  testOutput?: string
  /** The commit the marker made once the attempt passed. */
  commit?: string
}

export interface Kata {
  format: 'j-code'
  version: 1
  key: string
  title: string
  /** Absolute path of the repo the feature lives in (context; the sandbox is where the kata is solved). */
  repoPath: string
  /** Present on sandbox katas — the default since the problem moved out of the repo. */
  sandbox?: KataSandbox
  branch?: string
  /** jTicket key when the build session was working a ticket. */
  ticket?: string
  /** The commit that carries the tests, the rest of the feature and the stub. */
  scaffoldCommit?: string
  /** What the feature is and what Claude built around this piece, markdown. */
  feature: string
  target: KataTarget
  tests: KataTests
  /** Rung 0 — what to build: the contract, what it must handle, how to test it. */
  brief: Block[]
  /** Rungs 1..n — each unlocked by a failed attempt (or on request). */
  hints: Block[][]
  /** The last rung — Claude's own implementation with a walkthrough. Hidden until revealed. */
  solution: Block[]
  /** How many hint rungs the human has reached. */
  hintsUnlocked: number
  /** When each hint was unlocked — so the transcript can interleave them with attempts. */
  hintsUnlockedAt: string[]
  revealed: boolean
  revealedAt?: string
  status: 'open' | 'marking' | 'passed'
  attempts: KataAttempt[]
  createdAt: string
  updatedAt: string
}

/**
 * What the browser gets: the rungs the human has reached and nothing beyond.
 * `hints` holds only the unlocked ones; `solution` is null until revealed.
 * The full record — with everything — is on disk and behind /full, for the
 * marker.
 */
export interface KataView extends Omit<Kata, 'hints' | 'solution'> {
  hints: Block[][]
  hintCount: number
  solution: Block[] | null
}

export type KataStage = 'brief' | 'hint' | 'reveal'

export function kataStage(k: Pick<Kata, 'revealed' | 'hintsUnlocked'>): KataStage {
  return k.revealed ? 'reveal' : k.hintsUnlocked > 0 ? 'hint' : 'brief'
}

/** What the kata list shows. */
export interface KataMeta {
  key: string
  title: string
  repoPath: string
  lang?: SandboxLang
  ticket?: string
  target: KataTarget
  status: Kata['status']
  stage: KataStage
  hintsUnlocked: number
  hintCount: number
  revealed: boolean
  attemptCount: number
  createdAt: string
  updatedAt: string
}
