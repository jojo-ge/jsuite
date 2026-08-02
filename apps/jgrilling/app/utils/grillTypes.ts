// The j-grilling session format — shared by server store and UI (the jDiff
// app/utils pattern: server files import these relatively).

/** One question Claude put to the user, and (eventually) their answer. */
export interface GrillTurn {
  id: string
  /** Short label for the design branch this question sits on. */
  topic: string
  /** The question itself, markdown. */
  question: string
  /** Claude's recommended answer, markdown. */
  recommendation: string
  /** One line on why this question matters now. */
  why?: string
  askedAt: string
  /** The user's answer, markdown; absent while the question is open. */
  answer?: string
  answeredAt?: string
}

export interface GrillSession {
  format: 'j-grilling'
  version: 1
  key: string
  title: string
  /** The plan under interrogation, markdown. */
  plan: string
  /** Repo the plan concerns — claude looks facts up there instead of asking. */
  repoPath?: string
  status: 'active' | 'done'
  /** Claude's closing statement once shared understanding is reached. */
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

/** SSE events pushed by /api/sessions/:key/next. */
export interface GrillStreamEvent {
  kind: 'log' | 'thinking' | 'question' | 'done' | 'error'
  t?: string
  text?: string
  message?: string
  turn?: GrillTurn
  session?: GrillSession
}
