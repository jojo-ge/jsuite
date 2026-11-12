import { listDocs } from '../../utils/store'

// Every document in the pool, most recently updated first. `?q=` is a
// full-text search: every word must appear in the document (title, subtitle,
// kicker, key, tags or block text); a body-only hit carries a `snippet`.
export default defineEventHandler((event) => listDocs({ q: getQuery(event).q }))
