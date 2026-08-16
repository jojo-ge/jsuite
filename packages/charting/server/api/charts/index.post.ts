import { blankChart, keyFromTitle, uniqueKey, writeChart } from '../../utils/store'

/**
 * Create a chart. Body: { title, mermaid?, key?, replace? } → { key, title }
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

  // The key, and no path. A chart's URL is a fact about the app that mounts this
  // layer, not about the pool it writes into — jChart's workbench is /c/<key>,
  // everyone else's is /charts/<key> — and this handler is the same code in all
  // of them, with no way to tell which one it is running in: Nuxt's import
  // protection refuses `app.config.ts` (and `#build/*`) from server runtime, on
  // purpose. So the route table stays where it can be right: `useChartRoutes()`
  // on the client, the app's own prefix in a consumer's own Nitro code. A caller
  // that knows which app it just POSTed to already knows how to open the key.
  return { key, title }
})
