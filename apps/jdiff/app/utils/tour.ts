import type { FindingSeverity } from './findings'

// A guided tour of a PR: an overview of the change plus ordered stops at
// the lines that matter, produced by claude and shared between the server
// endpoint and the tour UI.
export interface TourStop {
  path: string
  side: 'LEFT' | 'RIGHT'
  line: number
  endLine: number
  title: string
  note: string
}

export interface Tour {
  overview: string
  stops: TourStop[]
}

// A target can hold several tours at once: the analyze run's overview tour,
// an on-demand fine-grained detail tour, one tour per system chain (variant
// "chain:<slug>", slugs defined by the target's chains manifest), and one per
// high-severity hunt issue (variant "issue:<slug>", from the hunt manifest).
export type TourVariant = 'overview' | 'detail' | `chain:${string}` | `issue:${string}`

// One system chain from the chains manifest: a distinct piece of behavior in
// the change, traced end-to-end across the systems it threads through. Each
// chain's walkthrough arrives later as the tour variant "chain:<id>".
export interface ChainSummary {
  id: string
  title: string
  summary: string
  seedPaths: string[]
}

export interface ChainsManifest {
  overview: string
  chains: ChainSummary[]
}

// ── The hunt ────────────────────────────────────────────────────────────────
// One issue from a hunt manifest: a suspected bug or vulnerability the hunt
// session found in the change. Every issue is listed; the HIGH ones each get
// a walkthrough of their own, arriving later as the tour variant
// "issue:<id>" — the tour that explains the defect in depth.
export const HUNT_KINDS = ['bug', 'vulnerability'] as const
export type HuntKind = (typeof HUNT_KINDS)[number]

export interface HuntIssue {
  id: string
  severity: FindingSeverity
  kind: HuntKind
  title: string
  // What goes wrong, in a sentence or three.
  summary: string
  // Where it lives: path exactly as in the diff, RIGHT-side line (or null).
  path: string
  line: number | null
  // Files a walker should start from — the sink, the callers, the guards.
  seedPaths: string[]
}

export interface HuntManifest {
  overview: string
  issues: HuntIssue[]
}
