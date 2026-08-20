// The j-map format — shared by server store and UI (the jGrilling app/utils
// pattern: server files import these relatively).
//
// A map is thin on purpose: the mapping WORK lives in jTicket (a jmap-mode
// project whose tickets are scoping/domain jobs run in herdr, producing docs
// in the shared pool). jMap stores only the map identity and the synthesized
// graph, and reads live progress from jTicket's API.

/**
 * One box on the synthesized map: a mapped domain ('domain:<slug>'), a shared
 * system several domains lean on ('shared:<slug>'), or an external service.
 */
export interface MapNode {
  id: string
  label: string
  kind: 'component' | 'route' | 'store' | 'service' | 'model' | 'util' | 'external' | 'domain'
  /** The jTicket ticket this domain was mapped under (TICK-n), where one exists. */
  ticketKey?: string
  /** The domain's walkthrough document in the shared @jsuite/documents pool. */
  documentKey?: string
  /** One line on what it is. */
  summary?: string
}

export interface MapEdge {
  from: string
  to: string
  kind: 'imports' | 'calls' | 'renders' | 'data' | 'http' | 'depends'
  description?: string
}

/** The unified graph the synthesis pass produces from the project's docs. */
export interface MapSynthesis {
  nodes: MapNode[]
  edges: MapEdge[]
  groups: { id: string; label: string; nodeIds: string[] }[]
  /** The system-level story, markdown. */
  commentary: string
  /** Per-node commentary for the detail panel, keyed by node id. */
  nodeNotes: Record<string, string>
  generatedAt: string
}

// 'mapping' until a synthesis ticket's session POSTs the graph back; 'done'
// from then on (re-synthesis replaces the graph without leaving 'done').
export type MapStatus = 'mapping' | 'done'

export interface CodeMap {
  format: 'j-map'
  version: 2
  key: string
  title: string
  /** Absolute path of the repository being mapped. */
  repoPath: string
  /** The jTicket project (mode 'jmap') that carries the mapping work. */
  projectKey: string
  status: MapStatus
  createdAt: string
  updatedAt: string
  synthesis?: MapSynthesis
}

/** What the map list shows. */
export interface MapMeta {
  key: string
  title: string
  repoPath: string
  projectKey: string
  status: MapStatus
  createdAt: string
  updatedAt: string
}

// ── Live progress, proxied from jTicket ──────────────────────────────────────

export interface ProgressTicket {
  key: string
  title: string
  status: 'todo' | 'in_progress' | 'done' | 'merged'
  assignee: string
  labels: string[]
  /** True for the scoping ticket (label jmap:scope). */
  scoping: boolean
  /** True for a synthesis ticket (label jmap:synthesize). */
  synthesis: boolean
  resolution: string
}

export interface ProgressDoc {
  key: string // DOC-n
  title: string
  documentKey: string
  labels: string[]
}

export interface MapProgress {
  project: { key: string; title: string; url: string } | null
  /** jTicket unreachable ⇒ false, with everything else empty. */
  jticketUp: boolean
  tickets: ProgressTicket[]
  docs: ProgressDoc[]
  /** At least one domain doc exists — synthesis has something to eat. */
  synthesizable: boolean
  /** Every scoping/domain ticket is finished — the map is fully documented. */
  allDone: boolean
}
