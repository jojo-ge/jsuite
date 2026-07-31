import { deleteDoc } from '../../utils/store'

/** Deletes the doc + its notes. Referenced charts stay — they're shared objects. */
export default defineEventHandler(async (event) => {
  await deleteDoc(getRouterParam(event, 'key') || '')
  return { ok: true }
})
