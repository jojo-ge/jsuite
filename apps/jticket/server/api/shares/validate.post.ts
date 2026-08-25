// Preview an import before anything is written: decode the pasted link
// fragment and run every local check (malformed 400, expired 410, key clash or
// own link 409) so the import screen can show what confirming would do — or one
// honest error. existingProjectId names the already-imported project when the
// link is a re-arm of a share this machine holds.
export default defineEventHandler(async (event) => {
  const body = await readBody<{ fragment?: string }>(event).catch(() => undefined)
  const store = loadStore()
  const blob = readImportFragment(store, body?.fragment)
  return { preview: importPreview(store, blob) }
})
