// Edit the suite-wide hand-off prompt defaults, merged per kind:
//   { prompts: { 'standard:local': '…' } }  sets one kind
//   { prompts: { 'standard:local': '' } }   drops it back to the code default
// Kinds you don't name are left alone; unknown kinds are ignored. See
// server/utils/prompts.ts for the layering and the vocabulary of kinds.
export default defineEventHandler(async (event) => {
  const body = await readBody<{ prompts?: unknown }>(event)
  if (body?.prompts === undefined) throw createError({ statusCode: 400, statusMessage: 'prompts is required' })

  const store = loadStore()
  store.promptDefaults = mergePromptOverrides(store.promptDefaults, body.prompts)
  saveStore(store)
  return { prompts: store.promptDefaults }
})
