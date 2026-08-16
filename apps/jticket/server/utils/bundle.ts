import type { Explainer, DocNotes } from '@jsuite/documents/store'
import type { Chart, ChartNotes } from '@jsuite/charting/store'
import type { Project, Ticket, LegacyDoc } from './store'

// A project bundle is the portable form of one project — everything needed to
// recreate it on another jSuite install: the tracker records, the bodies of
// every artifact they attach (and every chart those documents embed) from the
// shared pools, and any uploaded files the markdown references. Produced by
// GET /api/projects/:id/export, consumed by POST /api/projects/import.
export const BUNDLE_FORMAT = 'jticket-project-bundle'

export interface BundleDocument {
  /** Key in the shared document pool, as referenced by the attachments. */
  key: string
  /** The document body; null if the key dangled at export time. */
  document: Explainer | null
  notes: DocNotes | null
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
  tickets: Ticket[]
  documents: BundleDocument[]
  charts: BundleChart[]
  attachments: BundleAttachment[]
}

// Shapes older bundles may still carry, both folded away by the importer
// (see projects/import.post.ts): an epic layer between project and tickets,
// and a Doc wrapper record per document, which becomes a document attachment
// on the imported project.
export interface LegacyBundleEpic {
  description?: string
}

export interface LegacyBundleDoc {
  record: LegacyDoc
  document: Explainer | null
  documentNotes: DocNotes | null
}

/** Every /attachments/<name> reference in a blob of text (markdown or JSON). */
export function attachmentRefs(text: string): Set<string> {
  const out = new Set<string>()
  for (const m of text.matchAll(/\/attachments\/([\w.-]+)/g)) out.add(m[1]!)
  return out
}
