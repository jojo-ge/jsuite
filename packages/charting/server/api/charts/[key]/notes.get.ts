import { readNotes } from '../../../utils/store'

export default defineEventHandler(async (event) => {
  const key = getRouterParam(event, 'key') || ''
  return await readNotes(key)
})
