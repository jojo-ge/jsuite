import type { Explainer, DocNotes } from '@jsuite/documents/store'
import type { Chart, ChartNotes } from '@jsuite/charting/store'
import type { Project, Ticket, Doc } from './store'

// A project bundle is the portable form of one project — everything needed to
// recreate it on another jSuite install: the tracker records, the doc bodies
// from the shared document pool, the charts those docs embed, and any
// uploaded files the markdown references. Produced by GET /api/projects/:id/export,
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
  docs: BundleDoc[]
  charts: BundleChart[]
  attachments: BundleAttachment[]
}

// Bundles exported before the epic layer was removed carry it between project
// and tickets; the importer folds it away (see projects/import.post.ts).
export interface LegacyBundleEpic {
  description?: string
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
