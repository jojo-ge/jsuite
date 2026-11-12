import { setDocTags } from '../../utils/store'

// Re-tag a document in place. Body: { tags: string[] } — the whole list, which
// replaces the one it had. Content is republished with POST (replace: true);
// this never touches it, nor `updatedAt`.
export default defineEventHandler(async (event) => {
  const body = (await readBody(event)) ?? {}
  if (!Array.isArray(body.tags)) throw createError({ statusCode: 400, statusMessage: 'tags must be an array of strings' })
  const doc = await setDocTags(getRouterParam(event, 'key') || '', body.tags)
  if (!doc) throw createError({ statusCode: 404, statusMessage: 'No such document' })
  return { key: doc.key, tags: doc.tags }
})
