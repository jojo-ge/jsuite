import type { Explainer, DocNotes } from '@jsuite/documents/store'
import type { Chart, ChartNotes } from '@jsuite/charting/store'
import type { Project, Epic, Ticket, Doc } from './store'

// A project bundle is the portable form of one project — everything needed to
// recreate it on another jSuite install: the tracker records, the doc bodies
// from the shared document pool, the charts those docs embed, and any
// attachments the markdown references. Produced by GET /api/projects/:id/export,
// consumed by POST /api/projects/import.
export const BUNDLE_FORMAT = 'jticket-project-bundle'

export interface BundleDoc {
  record: Doc
  /** The shared-pool document body; null if the documentKey dangled at export time. */
  document: Explainer | null
  documentNotes: DocNotes | null
}

export interface BundleChart {
  key: string
  chart: Chart
  notes: ChartNotes | null
}

export interface BundleAttachment {
  name: string
  base64: string
}

export interface ProjectBundle {
  format: typeof BUNDLE_FORMAT
  version: 1
  exportedAt: string
  project: Project
  epics: Epic[]
  tickets: Ticket[]
  docs: BundleDoc[]
  charts: BundleChart[]
  attachments: BundleAttachment[]
}

/** Every /attachments/<name> reference in a blob of text (markdown or JSON). */
export function attachmentRefs(text: string): Set<string> {
  const out = new Set<string>()
  for (const m of text.matchAll(/\/attachments\/([\w.-]+)/g)) out.add(m[1]!)
  return out
}
