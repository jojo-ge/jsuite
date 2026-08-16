import { basename } from 'node:path'
import type { Chart } from '@jsuite/charting/store'
import type { Block, ChartBlockInput } from './store'

// Chart-store functions (readChart, writeChart, blankChart, keyFromTitle) are
// Nitro auto-imports from the @jsuite/charting layer's server/utils — the same
// store this app's /api/charts routes are served from.

/**
 * Turn incoming blocks into stored blocks, materialising any chart block that
 * carries inline `mermaid` into a real doc in the shared jChart store. The
 * stored block keeps only `chartKey` — the chart itself owns the source.
 *
 * If a chart of that key already exists with the SAME mermaid source, it's left
 * completely untouched, so re-posting an unchanged explainer preserves the
 * user's hand edits and pinned shape notes. Changed source rewrites the chart
 * (fresh layout on next open) but keeps its notes sidecar and createdAt.
 */
export async function materialiseBlocks(docKey: string, rawBlocks: unknown[]): Promise<Block[]> {
  const out: Block[] = []
  let chartN = 0
  let imageN = 0
  const mediaKept: string[] = []

  for (let i = 0; i < rawBlocks.length; i++) {
    // Untrusted input: every block shape arrives here, so keep `raw` loose and
    // narrow per branch. Typing it as one block kind makes the other branches
    // unreachable to the compiler.
    const raw = { ...(rawBlocks[i] as Record<string, unknown>) } as Record<string, unknown> & { id: string }
    // Stable ids for notes to pin to; keep any the author supplied.
    raw.id = typeof raw.id === 'string' && raw.id.trim() ? raw.id : `b${i + 1}`

    // Image blocks carry a local `file` path; copy the bytes into the doc's
    // media dir and store only the served URL, so the document survives the
    // source file being moved or deleted.
    if (raw.type === 'image') {
      const file = typeof raw.file === 'string' ? raw.file.trim() : ''
      let src = typeof raw.src === 'string' ? raw.src.trim() : ''
      if (file) {
        imageN++
        const name = sanitizeMediaName(String(raw.name || `${String(i + 1).padStart(2, '0')}-${basename(file)}`))
        try {
          src = await storeMedia(docKey, file, name)
          mediaKept.push(name)
        } catch (err) {
          // A missing screenshot shouldn't nuke the whole publish — drop the
          // block and keep going, the rest of the document is still useful.
          console.warn(`[documents] image block ${raw.id}: ${(err as Error).message}`)
          continue
        }
      } else if (src) {
        // Already-served URL (e.g. re-publishing an unchanged doc): keep the file.
        const existing = src.split('/').pop()
        if (existing) mediaKept.push(existing)
      }
      if (!src) continue
      out.push({
        id: raw.id,
        type: 'image',
        src,
        title: raw.title as string | undefined,
        caption: raw.caption as string | undefined,
        alt: raw.alt as string | undefined,
        width: raw.width as number | undefined,
        framed: raw.framed as boolean | undefined,
      } as Block)
      continue
    }

    if (raw.type !== 'chart') {
      out.push(raw as unknown as Block)
      continue
    }

    chartN++
    const chart = raw as unknown as ChartBlockInput & Record<string, unknown>
    const mermaid = typeof chart.mermaid === 'string' ? chart.mermaid.trim() : ''
    let chartKey = chart.chartKey ? keyFromTitle(String(chart.chartKey)) : ''

    if (mermaid) {
      if (!chartKey) chartKey = keyFromTitle(`${docKey} ${chart.title || `chart ${chartN}`}`)
      const existing = (await readChart(chartKey)) as Chart | null
      if (!existing || existing.source?.text?.trim() !== mermaid) {
        const fresh = blankChart({
          key: chartKey,
          title: String(chart.title || `${docKey} — chart ${chartN}`),
          source: { type: 'mermaid', text: mermaid },
        }) as Chart
        if (existing?.createdAt) fresh.createdAt = existing.createdAt
        await writeChart(chartKey, fresh)
      }
    }

    if (!chartKey) {
      // Neither mermaid nor a key — nothing to render; skip the block entirely.
      continue
    }

    out.push({
      id: raw.id,
      type: 'chart',
      chartKey,
      title: chart.title,
      caption: chart.caption,
      height: chart.height,
    })
  }

  // Drop media from earlier revisions that this one no longer references.
  if (imageN > 0 || mediaKept.length) await pruneMedia(docKey, mediaKept)

  return out
}

/** Normalise a glossary object: string->string entries only. */
export function cleanGlossary(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== 'object') return {}
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (k.trim() && typeof v === 'string' && v.trim()) out[k.trim()] = v.trim()
  }
  return out
}
