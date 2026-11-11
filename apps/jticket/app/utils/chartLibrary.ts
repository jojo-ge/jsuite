// The chart list and editor (pages/charts/) — every chart in the shared pool
// (`.data/jchart/`, served by @jsuite/charting's /api/charts). Like the
// document pool, it belongs to no codebase.

/** The editor route for a chart — the path POST /api/charts answers and embedded charts link to. */
export function chartEditorPath(key: string): string {
  return `/charts/${encodeURIComponent(key)}`
}

/** The one-line summary under a chart's title in the list. */
export function chartSummary(c: { elementCount: number; noteCount: number }): string {
  const shapes = `${c.elementCount} shape${c.elementCount === 1 ? '' : 's'}`
  return c.noteCount ? `${shapes} · ${c.noteCount} note${c.noteCount === 1 ? '' : 's'}` : shapes
}

/** A chart with Mermaid source and no shapes yet — the editor lays it out on first open. */
export function chartAwaitingLayout(c: { hasSource: boolean; imported: boolean }): boolean {
  return c.hasSource && !c.imported
}

/** The confirm text for deleting a chart — warns about the documents that embed it. */
export function deleteChartPrompt(title: string): string {
  return `Delete "${title}" and its notes? Documents that embed it will show it as missing. This can't be undone.`
}
