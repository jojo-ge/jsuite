// The j-grilling session format — shared by server store and UI (the jDiff
// app/utils pattern: server files import these relatively).
//
// A session is driven from OUTSIDE the app: a Claude session (usually in
// herdr, working a HITL jTicket) owns the interview, posts questions over the
// HTTP API, and monitors the session file for answers. The app renders
// whatever state exists and records answers — nothing more.

import type { Block } from '@jsuite/documents/types'

/** One question the interviewer put to the user, and (eventually) their answer. */
export interface GrillTurn {
  id: string
  /** Short label for the design branch this question sits on. */
  topic: string
  /** The question body — jspec-format blocks (the shared document vocabulary). */
  blocks: Block[]
  /** The interviewer's recommended answer, markdown. */
  recommendation: string
  /** One line on why this question matters now. */
  why?: string
  askedAt: string
  /** The user's answer, markdown; absent while the question is open. */
  answer?: string
  answeredAt?: string
  /** Legacy (version 1, headless-interviewer era): markdown question body. */
  question?: string
}

export interface GrillSession {
  format: 'j-grilling'
  version: 1 | 2
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
