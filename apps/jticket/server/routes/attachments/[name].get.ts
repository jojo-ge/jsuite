// Legacy alias for /uploads/:name.
//
// Markdown stored across .data/ — ticket descriptions, resolutions, comments,
// doc bodies — references /attachments/<name>, and rewriting it was never on
// the table. This redirect is what keeps every one of those images resolving.
// The name is sanitised first, so the Location header can only ever point back
// into this app's own upload namespace.
export default defineEventHandler((event) => {
  const name = safeUploadName(getRouterParam(event, 'name') ?? '')
  return sendRedirect(event, `/uploads/${name}`, 308)
})
