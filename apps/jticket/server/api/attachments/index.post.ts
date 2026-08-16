// Legacy alias for POST /api/uploads. 308 rather than 302 so the method and
// the { name, base64 } body survive the hop. See ./index.get.ts.
export default defineEventHandler((event) => sendRedirect(event, '/api/uploads', 308))
