import type { Scene, SceneElement } from '../utils/scene'

// Mermaid spells a line break `<br/>`, and the converter hands it through as
// literal text: a three-line label arrives as one long line with `<br>` sitting
// in the middle of it, which Excalidraw then re-wraps wherever it happens to
// fit. Put the newlines back before the elements are built, so the text is
// measured and broken where the author wrote the breaks.
const BR = /<br\s*\/?>/gi

interface MaybeLabelled {
  text?: unknown
  label?: { text?: unknown } | null
}

function withRealLineBreaks(elements: unknown[]): unknown[] {
  return elements.map((el) => {
    const e = el as MaybeLabelled
    const label = typeof e.label?.text === 'string' ? e.label.text : null
    const text = typeof e.text === 'string' ? e.text : null
    if (label === null && text === null) return el
    const next = { ...(el as Record<string, unknown>) }
    if (label !== null) next.label = { ...(e.label as object), text: label.replace(BR, '\n') }
    if (text !== null) next.text = text.replace(BR, '\n')
    return next
  })
}

/**
 * Mermaid → Excalidraw. The conversion renders the diagram with mermaid to get
 * a layout, so it only runs in the browser.
 */
export async function mermaidToScene(source: string): Promise<Scene> {
  const [{ parseMermaidToExcalidraw }, { convertToExcalidrawElements }] = await Promise.all([
    import('@excalidraw/mermaid-to-excalidraw'),
    import('@excalidraw/excalidraw'),
  ])

  const { elements, files } = await parseMermaidToExcalidraw(source, {
    themeVariables: { fontSize: '16px' },
  })

  return {
    elements: convertToExcalidrawElements(
      withRealLineBreaks(elements as unknown[]) as never,
    ) as unknown as SceneElement[],
    appState: {},
    files: (files ?? {}) as Record<string, unknown>,
  }
}
