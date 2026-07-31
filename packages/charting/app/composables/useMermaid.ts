import type { Scene, SceneElement } from '../utils/scene'

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
    elements: convertToExcalidrawElements(elements as never) as unknown as SceneElement[],
    appState: {},
    files: (files ?? {}) as Record<string, unknown>,
  }
}
