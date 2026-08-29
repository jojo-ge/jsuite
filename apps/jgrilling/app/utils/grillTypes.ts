// The j-grilling session format — shared by server store and UI (the jDiff
// app/utils pattern: server files import these relatively).
//
// A session is driven from OUTSIDE the app: a Claude session grilling the user
// in a terminal escalates one question here on the operator's request, posts it
// over the HTTP API, and monitors the session file for the answer. The app
// renders whatever state exists and records answers — nothing more.

import type { Block } from '@jsuite/documents/types'

/**
 * One candidate answer — a tab in the question's options view (phase 3).
 * `blocks` is the *case* for this option: why you'd pick it, what it costs,
 * the table/code/chart the argument rests on.
 */
export interface GrillOption {
  id: string
  /** Tab label — a few words, e.g. "TTL of 60s". */
  label: string
  /** One line under the label in the tab strip: what this option is. */
  summary?: string
  /** The interviewer's pick — badged, and the tab that opens first. */
  recommended?: boolean
  /** The case for (and against) this option — jspec blocks. */
  blocks: Block[]
  /** Answer text recorded when the user picks this option. */
  answer: string
}

/** One question the interviewer put to the user, and (eventually) their answer. */
export interface GrillTurn {
  id: string
  /** Short label for the design branch this question sits on. */
  topic: string
  /** Phase 1 — the question itself, markdown. */
  question?: string
  /** Phase 2 — why it needs answering now, markdown. */
  why?: string
  /**
   * Shared context the question rests on — jspec-format blocks (the shared
   * document vocabulary). Rendered under the question, above the options.
   * Version 1 turns instead carried the whole question body here.
   */
  blocks: Block[]
  /** Phase 3 — the candidate answers, one tab each. */
  options?: GrillOption[]
  /** The interviewer's recommended answer, markdown. */
  recommendation: string
  askedAt: string
  /** The user's answer, markdown; absent while the question is open. */
  answer?: string
  answeredAt?: string
  /** Which option the answer came from, when they picked one. */
  answeredOptionId?: string
}

export interface GrillSession {
  format: 'j-grilling'
  version: 1 | 2 | 3
  key: string
  title: string
  /** The plan / context under interrogation, markdown. */
  plan: string
  /** Repo the plan concerns — the interviewer looks facts up there instead of asking. */
  repoPath?: string
  status: 'active' | 'done'
  /** The interviewer's closing statement once shared understanding is reached. */
  verdict?: string
  /** Key of the debrief document in the shared @jsuite/documents pool. */
  documentKey?: string
  createdAt: string
  updatedAt: string
  turns: GrillTurn[]
}

/** What the session list shows. */
export interface GrillMeta {
  key: string
  title: string
  status: 'active' | 'done'
  turnCount: number
  answeredCount: number
  documentKey?: string
  createdAt: string
  updatedAt: string
}
