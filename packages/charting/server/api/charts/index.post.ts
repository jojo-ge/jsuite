import { blankChart, keyFromTitle, uniqueKey, writeChart } from '../../utils/store'

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

  return { key, title, path: `/c/${key}` }
})
