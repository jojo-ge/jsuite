// Where a document is read, as a pure function of the prefix it is mounted on.
//
// The layer ships its own reader — `pages/documents/[key].vue` — so every
// consumer that extends it serves `/documents/<key>`, and that is the one
// document route true in all of them. jExplain and jGrilling brand a shorter
// one (`/e/<key>`) and point their own library at it, but neither drops the
// layer's: jExplain mounts both pages, jGrilling redirects `/documents/<key>`
// onto `/e/<key>` so there is a single reader to keep.
//
// That is why this lives at the package root rather than in app/utils, next to
// `types.ts`: server code needs it too. `POST /api/documents` answers with a
// path, and the pool is mounted in three apps — a hardcoded `/e/<key>` there is
// jExplain's route asserted on jTicket's behalf, and 404s (TICK-190). Pure TS,
// no Nuxt, importable from a Nitro handler and a component alike.
//
// Nothing configurable hangs off this by design: `readerBase` is a prop on
// <DocumentLibrary>/<DocumentReader> because a *page* chooses which of its own
// readers to link to, while the API can only honestly name the route it is
// certain the responding app serves.

/** Prefix the layer's reader hangs off in every consumer. */
export const DOCUMENTS_READER_BASE = '/documents'

/** Where document `key` is read, under `readerBase` (the layer's own by default). */
export function documentPath(key: string, readerBase: string = DOCUMENTS_READER_BASE): string {
  return `${readerBase.replace(/\/+$/, '')}/${key}`
}
