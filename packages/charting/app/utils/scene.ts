// Helpers for reading meaning out of an Excalidraw scene.

export interface SceneElement {
  id: string
  type: string
  isDeleted?: boolean
  text?: string
  containerId?: string | null
  label?: { text?: string }
  boundElements?: { id: string; type: string }[] | null
  startBinding?: { elementId: string } | null
  endBinding?: { elementId: string } | null
  [k: string]: unknown
}

export interface Scene {
  elements: SceneElement[]
  appState: Record<string, unknown>
  files: Record<string, unknown>
}

/** appState keys worth persisting — the rest is transient UI (cursors, dialogs, undo). */
const KEEP_APPSTATE = [
  'viewBackgroundColor',
  'gridSize',
  'gridModeEnabled',
  'scrollX',
  'scrollY',
  'zoom',
  'currentItemStrokeColor',
  'currentItemBackgroundColor',
  'currentItemFontFamily',
  'currentItemFontSize',
] as const

export function trimAppState(appState: Record<string, unknown> = {}): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const k of KEEP_APPSTATE) {
    if (appState[k] !== undefined) out[k] = appState[k]
  }
  return out
}

export function liveElements(elements: SceneElement[] = []): SceneElement[] {
  return elements.filter((e) => e && !e.isDeleted)
}

/**
 * A human-readable name for a shape, used as the annotation heading.
 * Excalidraw keeps a shape's caption in a separate text element bound to it,
 * so a bare rectangle has no text of its own — look at what's bound to it.
 */
export function labelForElement(el: SceneElement | undefined, elements: SceneElement[] = []): string {
  if (!el) return 'shape'

  const own = (el.text || el.label?.text || '').trim()
  if (own) return truncate(own)

  const bound = (el.boundElements || []).find((b) => b?.type === 'text')
  if (bound) {
    const t = elements.find((e) => e.id === bound.id)
    const text = (t?.text || '').trim()
    if (text) return truncate(text)
  }

  // An unlabelled arrow is best described by what it connects.
  if (el.type === 'arrow' || el.type === 'line') {
    const from = el.startBinding && elements.find((e) => e.id === el.startBinding!.elementId)
    const to = el.endBinding && elements.find((e) => e.id === el.endBinding!.elementId)
    if (from || to) {
      const a = from ? labelForElement(from, []) : '?'
      const b = to ? labelForElement(to, []) : '?'
      return `${a} → ${b}`
    }
  }

  return `${el.type} ${el.id.slice(0, 5)}`
}

function truncate(s: string, n = 48): string {
  const flat = s.replace(/\s+/g, ' ').trim()
  return flat.length > n ? flat.slice(0, n - 1) + '…' : flat
}

/** Text elements bound to a container are the container's caption, not shapes in their own right. */
export function isAnnotatable(el: SceneElement): boolean {
  if (!el || el.isDeleted) return false
  if (el.type === 'text' && el.containerId) return false
  return true
}
