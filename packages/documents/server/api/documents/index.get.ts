import { listDocs, cleanDocLabels } from '../../utils/store'

/**
 * The shared document pool, newest first.
 *
 * `?label=` filters it. Repeat the parameter or comma-separate the values; a
 * document must carry *every* label asked for, so adding one narrows the list
 * rather than widening it (`?label=wayfinder:asset&label=draft` is the asset
 * research still in draft). Matching runs over the same normalisation writes
 * go through, so case and surrounding space don't matter.
 */
export default defineEventHandler(async (event) => {
  const raw = getQuery(event).label
  const wanted = cleanDocLabels(
    (Array.isArray(raw) ? raw : [raw]).flatMap((v) => String(v ?? '').split(',')),
  )
  const docs = await listDocs()
  if (!wanted.length) return docs
  return docs.filter((d) => wanted.every((label) => d.labels.includes(label)))
})
