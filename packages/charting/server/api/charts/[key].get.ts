import { readChart } from '../../utils/store'

export default defineEventHandler(async (event) => {
  const key = getRouterParam(event, 'key') || ''
  const chart = await readChart(key)
  if (!chart) throw createError({ statusCode: 404, statusMessage: 'No such chart' })
  return chart
})
