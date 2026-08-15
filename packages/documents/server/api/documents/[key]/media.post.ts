// Accepts a picture for a note — a pasted screenshot, a chosen file, or a sketch
// exported from the rail's canvas — and returns the URL to store on the note.
export default defineEventHandler(async (event) => {
  const key = sanitizeDocKey(getRouterParam(event, 'key'))
  const body = (await readBody(event)) ?? {}
  const dataUrl = typeof body.dataUrl === 'string' ? body.dataUrl : ''
  if (!key) throw createError({ statusCode: 400, statusMessage: 'missing document key' })
  if (!dataUrl) throw createError({ statusCode: 400, statusMessage: 'missing dataUrl' })

  // Unique-ish name so two pastes in the same note never collide.
  const stem = String(body.name || 'note').slice(0, 40)
  const unique = `${stem}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`

  try {
    const src = await storeNoteMedia(key, dataUrl, unique)
    return { ok: true, src }
  } catch (err) {
    throw createError({ statusCode: 400, statusMessage: (err as Error).message })
  }
})
