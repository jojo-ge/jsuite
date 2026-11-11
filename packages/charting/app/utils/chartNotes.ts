// Shape notes on a chart — the pieces the chart editor (and, later, embedded
// charts) share: the note shape, making a note for a shape, and the markdown
// "Copy notes for Claude" hands back. Pure, so it runs under plain vitest.
import { isAnnotatable, labelForElement, liveElements, type SceneElement } from './scene'

export interface ChartNote {
  id: string
  elementId: string
  label: string
  text: string
}

/** A fresh, empty note pinned to a shape, labelled with the shape's current caption. */
export function newChartNote(el: SceneElement, elements: SceneElement[]): ChartNote {
  return {
    id: `n${Math.random().toString(36).slice(2, 10)}`,
    elementId: el.id,
    label: labelForElement(el, elements),
    text: '',
  }
}

export interface ChartNotesMarkdownInput {
  key: string
  title: string
  general: string
  notes: ChartNote[]
  elements: SceneElement[]
  source?: { type: string; text: string } | null
}

/**
 * The markdown "Copy notes for Claude" puts on the clipboard: where the chart's
 * files are, the general notes, each written shape note under the shape's live
 * label (flagged when the shape is gone), and what's on the canvas.
 */
export function chartNotesMarkdown(c: ChartNotesMarkdownInput): string {
  const els = c.elements
  const byId = new Map(els.map((e) => [e.id, e]))
  let out = `## Chart notes: ${c.title}\n\n`
  out += `Chart file: \`$(jsuite root)/.data/jchart/${c.key}.json\`\n`
  out += `Notes file: \`$(jsuite root)/.data/jchart/${c.key}.notes.json\`\n\n`

  const g = c.general.trim()
  if (g) out += `### General notes\n${g}\n\n`

  const written = c.notes.filter((n) => n.text.trim())
  if (written.length) {
    out += '### Shape annotations\n'
    for (const n of written) {
      const el = byId.get(n.elementId)
      const label = el ? labelForElement(el, els) : n.label
      const gone = !el || el.isDeleted ? ' _(shape deleted)_' : ''
      out += `- **${label}**${gone}: ${n.text.trim()}\n`
    }
    out += '\n'
  }

  const shapes = liveElements(els).filter(isAnnotatable)
  out += `### Canvas\n${shapes.length} shape${shapes.length === 1 ? '' : 's'} on the canvas`
  const src = c.source
  if (src?.type === 'mermaid' && src.text.trim()) {
    // The canvas is freely editable after import, so the Mermaid below is the
    // starting point, not necessarily what's on screen now.
    out += `, laid out from the Mermaid below and possibly edited by hand since.\n\n`
    out += '### Mermaid source\n```mermaid\n' + src.text.trim() + '\n```\n'
  } else {
    out += ', drawn by hand.\n'
  }
  return out
}
