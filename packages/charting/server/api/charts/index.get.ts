import { listCharts } from '../../utils/store'

export default defineEventHandler(async () => {
  return await listCharts()
})
