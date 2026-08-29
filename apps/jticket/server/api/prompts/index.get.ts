// The suite-wide hand-off prompt defaults: the layer a project's own overrides
// sit on top of, and which the code defaults sit under. Only overridden kinds
// are present — an absent kind means "use the built-in text", which the client
// holds (app/utils/prompts.ts) and shows as the editor's placeholder.
export default defineEventHandler(() => {
  return { prompts: loadStore().promptDefaults }
})
