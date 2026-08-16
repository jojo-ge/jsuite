import type { Explainer, DocNotes } from '@jsuite/documents/store'
import type { Chart, ChartNotes } from '@jsuite/charting/store'
import type { Project, Ticket } from '#shared/types/tracker'
import type { LegacyDoc } from './store'

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

// One uploaded file, inlined. The bundle field stays `attachments` even though
// the endpoint is now /api/uploads: this is a serialised format (version 1)
// that other installs already hold on disk, and renaming the key would strand
// every bundle exported before the rename.
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

/**
 * Matches an uploaded-file reference, capturing `[prefix, name]`.
 *
 * Both `/uploads/<name>` and the pre-rename `/attachments/<name>`: markdown
 * written before the rename is all over `.data/` and still names the old path,
 * so a matcher that only knew the new one would quietly export bundles with
 * the images missing.
 *
 * The lookbehind keeps the match to *root-relative* references, the form the
 * API documents and hands back. Without it `/uploads/` — a very ordinary
 * segment in someone else's URL, e.g. a WordPress
 * `https://host/wp-content/uploads/img.png` — would be swept as if it named a
 * local file, and a colliding import would rewrite that foreign link. An
 * absolute URL pointing at this app's own uploads is the cost, and the cheaper
 * mistake: the bundle simply doesn't inline it, rather than corrupting a link.
 *
 * A function, not a constant — a shared /g regex carries `lastIndex` between
 * callers.
 */
export const uploadRefPattern = (): RegExp => /(?<![\w./-])\/(uploads|attachments)\/([\w.-]+)/g

/** Every uploaded file referenced by a blob of text (markdown or JSON), by name. */
export function uploadRefs(text: string): Set<string> {
  const out = new Set<string>()
  for (const m of text.matchAll(uploadRefPattern())) out.add(m[2]!)
  return out
}
