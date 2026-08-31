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
// an on-demand fine-grained detail tour, and one tour per system chain
// (variant "chain:<slug>", slugs defined by the target's chains manifest).
export type TourVariant = 'overview' | 'detail' | `chain:${string}`

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
