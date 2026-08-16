import { blankChart, chartDataDir, keyFromTitle, uniqueKey, writeChart } from '../../utils/store'

/**
 * Create a chart. Body: { title, mermaid?, key?, replace? }
 *
 * The Mermaid source is stored as-is and converted to Excalidraw shapes by the
 * editor on first open — the conversion needs a DOM, so it can't run here.
 */
export default defineEventHandler(async (event) => {
  const body = (await readBody(event)) ?? {}
  const title = String(body.title || '').trim() || 'Untitled chart'
  const mermaid = typeof body.mermaid === 'string' ? body.mermaid.trim() : ''
  const requested = body.key ? String(body.key) : keyFromTitle(title)

  // replace:true overwrites the named chart instead of minting `-2`, so a skill
  // can re-render the same diagram in place and keep its notes.
  const key = body.replace ? keyFromTitle(requested) : await uniqueKey(requested)

  const chart = blankChart({
    key,
    title,
    source: mermaid ? { type: 'mermaid', text: mermaid } : { type: 'blank', text: '' },
  })
  await writeChart(key, chart)

  // The layer's own route, so `path` is openable in every consumer of it —
  // jChart's shorter /c/<key> is an alias over the same component. `dataDir` is
  // this pool on disk, so the publishing script can tell the user where to read
  // the scene and notes back from without hardcoding a repo location.
  return { key, title, path: `/charts/${key}`, dataDir: chartDataDir() }
})
