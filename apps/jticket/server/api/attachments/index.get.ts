// Legacy alias for GET /api/uploads.
//
// `/api/attachments` used to mean "uploaded files", while
// `/api/{tickets,projects}/:id/attachments` means "refs into the artifact
// pools" — one word, two unrelated things. The upload namespace moved to
// /api/uploads; this stays so older callers and skills keep working.
export default defineEventHandler((event) => sendRedirect(event, '/api/uploads', 308))
