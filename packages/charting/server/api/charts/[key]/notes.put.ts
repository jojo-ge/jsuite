import { writeNotes, type ChartNote } from '../../../utils/store'

export default defineEventHandler(async (event) => {
  const key = getRouterParam(event, 'key') || ''
  const body = (await readBody(event)) ?? {}
  await writeNotes(key, {
    general: typeof body.general === 'string' ? body.general : '',
    notes: Array.isArray(body.notes) ? (body.notes as ChartNote[]) : [],
  })
  return { ok: true }
})
