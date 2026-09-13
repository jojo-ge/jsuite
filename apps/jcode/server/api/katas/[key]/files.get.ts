/**
 * The sandbox's authored files — the stub, the cases, the types — read live
 * off disk so the page can show what the inputs look like. The runner is
 * left out (the app owns it). Repo katas have no sandbox: empty list.
 */
export default defineEventHandler(async (event) => {
  const key = String(getRouterParam(event, 'key'))
  const kata = await readKata(key)
  if (!kata) throw createError({ statusCode: 404, message: `No such kata: ${key}` })
  if (!kata.sandbox) return { dir: null, entry: null, files: [] }
  return { dir: kata.sandbox.dir, entry: kata.sandbox.entry, files: await readSandboxFiles(kata.sandbox) }
})
