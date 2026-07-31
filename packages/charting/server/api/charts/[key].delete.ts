import { deleteChart } from '../../utils/store'

export default defineEventHandler(async (event) => {
  const key = getRouterParam(event, 'key') || ''
  await deleteChart(key)
  return { ok: true }
})
