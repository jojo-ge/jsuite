import { readDoc } from '../../utils/store'

export default defineEventHandler(async (event) => {
  const doc = await readDoc(getRouterParam(event, 'key') || '')
  if (!doc) throw createError({ statusCode: 404, statusMessage: 'No such explainer' })
  return doc
})
