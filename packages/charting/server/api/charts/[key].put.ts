import { readChart, writeChart, type Chart } from '../../utils/store'

/**
 * Save a chart. Body may carry any of { title, source, scene } — anything
 * omitted keeps its stored value, so the canvas autosave doesn't clobber a
 * title edit racing it from the other panel.
 */
export default defineEventHandler(async (event) => {
  const key = getRouterParam(event, 'key') || ''
  const existing = await readChart(key)
  if (!existing) throw createError({ statusCode: 404, statusMessage: 'No such chart' })

  const body = (await readBody(event)) ?? {}
  const next: Chart = {
    ...existing,
    title: typeof body.title === 'string' && body.title.trim() ? body.title.trim() : existing.title,
    source: body.source ?? existing.source,
    scene: body.scene ?? existing.scene,
    updatedAt: new Date().toISOString(),
  }
  await writeChart(key, next)
  return { ok: true, updatedAt: next.updatedAt }
})
