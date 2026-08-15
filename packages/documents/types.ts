// The shared document model — one block-based document system for every
// jSuite consumer (jExplain articles, jTicket docs). Pure types, importable
// from both client and server code via `@jsuite/documents/types`.

// ── Block vocabulary ──────────────────────────────────────────────────────────
// This is the authoring contract the j-explain skill teaches. Every block may
// carry an `id`; the server assigns b1…bn to any that arrive without one, and
// notes pin to those ids.

export type CalloutTone = 'insight' | 'warning' | 'aside' | 'success'

export interface ProseBlock {
  id: string
  type: 'prose'
  md: string
}

export interface CalloutBlock {
  id: string
  type: 'callout'
  tone: CalloutTone
  title?: string
  md: string
}

export interface CodeAnnotation {
  /** Displayed line number (file numbering when startLine is set). */
  line: number
  md: string
}

export interface CodeBlock {
  id: string
  type: 'code'
  lang?: string
  /** Shown as the block's filename chip. */
  file?: string
  code: string
  /** First displayed line number; defaults to 1. */
  startLine?: number
  /** Displayed line numbers to tint as "look here". */
  highlight?: number[]
  annotations?: CodeAnnotation[]
}

export interface DiffAnnotation {
  /** Exact text of the diff line to annotate (first match wins). */
  on: string
  md: string
}

export interface DiffBlock {
  id: string
  type: 'diff'
  file?: string
  /** Unified diff text: @@ hunk headers, +/-/space prefixed lines. */
  diff: string
  /** Markdown rendered below the diff. */
  commentary?: string
  annotations?: DiffAnnotation[]
}

export interface ChartBlock {
  id: string
  type: 'chart'
  /** Key into the shared jChart store (.data/jchart/<chartKey>.json). */
  chartKey: string
  title?: string
  caption?: string
  /** Canvas height in px; defaults to 420 in the renderer. */
  height?: number
}

/** What skills POST: mermaid source that we materialise into a chart doc. */
export interface ChartBlockInput extends Omit<ChartBlock, 'chartKey'> {
  chartKey?: string
  mermaid?: string
}

export interface ImageBlock {
  id: string
  type: 'image'
  /** Served URL of the stored copy, e.g. /api/media/<docKey>/<file>.png */
  src: string
  title?: string
  /** Markdown rendered under the image. */
  caption?: string
  alt?: string
  /** Max rendered width in px; defaults to the column width. */
  width?: number
  /** Frame the image like a screenshot (dark inset border). Default true. */
  framed?: boolean
}

/** What skills POST: a local file path we copy into the doc's media dir. */
export interface ImageBlockInput extends Omit<ImageBlock, 'src'> {
  src?: string
  /** Absolute path to a local image file; copied into .data/jexplain/media/<key>/. */
  file?: string
  /** Override the stored filename; defaults to the source file's name. */
  name?: string
}

export interface StepsBlock {
  id: string
  type: 'steps'
  title?: string
  items: { title: string; md: string }[]
}

export interface CompareBlock {
  id: string
  type: 'compare'
  title?: string
  columns: string[]
  /** Markdown cells, one row per option. */
  rows: string[][]
}

export interface TimelineBlock {
  id: string
  type: 'timeline'
  title?: string
  events: { when: string; title: string; md?: string }[]
}

export interface TakeawayBlock {
  id: string
  type: 'takeaway'
  title?: string
  /** Markdown bullet points. */
  points: string[]
}

export type Block =
  | ProseBlock
  | CalloutBlock
  | CodeBlock
  | DiffBlock
  | ChartBlock
  | ImageBlock
  | StepsBlock
  | CompareBlock
  | TimelineBlock
  | TakeawayBlock

// ── Document ──────────────────────────────────────────────────────────────────

// `format: 'j-explain'` is the on-disk format tag (named for the app the block
// system was born in); the shape is now the suite-wide document format.
export interface Explainer {
  format: 'j-explain'
  version: 1
  key: string
  title: string
  subtitle?: string
  /** Small uppercase context line above the title, e.g. "PR #4821". */
  kicker?: string
  createdAt: string
  updatedAt: string
  blocks: Block[]
  /** term -> definition; terms get dotted-underline hover definitions in prose. */
  glossary: Record<string, string>
}

/**
 * A picture pinned to a note: a pasted/uploaded screenshot, or a sketch drawn in
 * the rail (optionally on top of a screenshot). Some feedback is much faster to
 * draw an arrow at than to describe.
 */
export interface NoteAttachment {
  id: string
  /** Served URL under /api/media/<docKey>/notes/… */
  src: string
  /** 'shot' = pasted or uploaded, 'sketch' = drawn in the rail. */
  kind: 'shot' | 'sketch'
  /** Optional one-line description typed under the picture. */
  caption?: string
}

export interface DocNote {
  id: string
  blockId: string
  /** Captured when created, so orphaned notes still read sensibly. */
  label: string
  text: string
  attachments?: NoteAttachment[]
}

export interface DocNotes {
  general: string
  notes: DocNote[]
  /** Pictures attached to the general (whole-document) note. */
  generalAttachments?: NoteAttachment[]
}

export interface ExplainerMeta {
  key: string
  title: string
  subtitle?: string
  kicker?: string
  createdAt: string
  updatedAt: string
  blockCount: number
  chartCount: number
  noteCount: number
}
