import type { Explainer, DocNotes } from '@jsuite/documents/store'
import type { Chart, ChartNotes } from '@jsuite/charting/store'
import type { Project, Ticket, Doc } from './store'

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

// A file from the documents media store (.data/jexplain/media/<docKey>/…):
// an image-block image, or — when `notes` — a note attachment from the
// docKey's notes/ subdirectory.
export interface BundleDocMedia extends DocMediaRef {
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
  /** Absent from bundles exported before doc media travelled. */
  media?: BundleDocMedia[]
}

// Bundles exported before the epic layer was removed carry it between project
// and tickets; the importer folds it away (see projects/import.post.ts).
export interface LegacyBundleEpic {
  description?: string
}

/** Every /attachments/<name> reference in a blob of text (markdown or JSON). */
export function attachmentRefs(text: string): Set<string> {
  const out = new Set<string>()
  for (const m of text.matchAll(/\/attachments\/([\w.-]+)/g)) out.add(m[1]!)
  return out
}

export interface DocMediaRef {
  docKey: string
  name: string
  notes: boolean
}

/** Every /api/media/<docKey>/[notes/]<name> reference in a blob of text, deduped. */
export function docMediaRefs(text: string): DocMediaRef[] {
  const out = new Map<string, DocMediaRef>()
  for (const m of text.matchAll(/\/api\/media\/([\w-]+)\/(notes\/)?([\w.-]+)/g)) {
    out.set(`${m[1]}/${m[2] ?? ''}${m[3]}`, { docKey: m[1]!, name: m[3]!, notes: !!m[2] })
  }
  return [...out.values()]
}

/** Rewrite /attachments/<name> urls whose file was renamed on import/apply. */
export function rewriteAttachmentUrls(text: string, renames: Map<string, string>): string {
  if (!renames.size) return text
  return text.replace(/\/attachments\/([\w.-]+)/g, (whole, name: string) =>
    renames.has(name) ? `/attachments/${renames.get(name)}` : whole,
  )
}

// Strip anything path-like or shell-unfriendly from a client-supplied file
// name — the pure core of safeAttachmentName ('' instead of a 400 when
// nothing survives), shared with the sync engine.
export function sanitizeAttachmentName(raw: unknown): string {
  return String(raw ?? '').split(/[\\/]/).pop()!.replace(/[^\w.-]+/g, '-').replace(/^[-.]+/, '')
}

/** Rewrite /api/media/<key>/… urls whose doc key was renamed on import. */
export function rewriteDocMediaUrls(text: string, renames: Map<string, string>): string {
  if (!renames.size) return text
  return text.replace(/\/api\/media\/([\w-]+)\//g, (whole, key: string) =>
    renames.has(key) ? `/api/media/${renames.get(key)}/` : whole,
  )
}
