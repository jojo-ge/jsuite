# jMap

Codebase cartographer, orchestrated **entirely through jTicket**: creating a
map creates a jMap-mode jTicket project (repo = the mapped directory) with a
scoping ticket. jTicket's herdr Run buttons dispatch every phase —
`/jmap-scope` on the scoping ticket, `/jmap-domain` on the domain tickets it
creates, `/jmap-synthesize` on the synthesis ticket the map room creates.
Every ticket's output lands back in the suite: docs on the project for phases
1–2, and the graph POSTed to `POST /api/maps/:key/synthesis` for phase 3.
jMap itself runs NO claude — it holds the map identity, polls jTicket for
progress, accepts the synthesis hand-back, and renders the interactive SVG
map. See README.md for the flow and API.

Rules that matter here:

- Map state is `.data/jmap/` via `@jsuite/data` — never hardcode paths. Format
  version 2; v1 maps (the old in-app dispatch flow) are ignored by the store.
- **jTicket owns the work.** Tickets, docs, and their statuses live in jTicket;
  jMap reads them via `server/utils/jticket.ts` (localhost:43000, server-side
  proxy — the browser never crosses origins). Don't duplicate ticket state
  into the map file, and don't add claude runs to this app — a new phase means
  a new ticket label + skill, not an in-app runner.
- Ticket labels are the protocol: `jmap:scope` / `jmap:domain` /
  `jmap:synthesize` pick the dispatched skill (jticket's `next.vue`
  `jmapCommand`), and a `jmap:domain` doc must carry its ticket key (`TICK-n`)
  as a label — that is how docs pair with tickets and how synthesis nodes get
  their `documentKey`.
- `POST /api/maps/:key/synthesis` is the only writer of `map.synthesis` and
  the only thing that flips status to `done`. It validates wholesale (unknown
  edge targets dropped, counts returned) — keep it tolerant of jTicket being
  down mid-POST (accept the graph, skip doc links).
- Store/util names (`readMap`, `writeMap`, …) must stay distinct from the
  charting/documents auto-imports (`readChart`, `readDoc`, …) — the layers
  share one Nitro auto-import namespace.
- Graph layout is computed client-side (`app/utils/mapLayout.ts`), never
  stored — the synthesis JSON carries no coordinates on purpose.
- The jTicket side of this feature (mode `'jmap'`, `/jmap-*` dispatch, no
  branch-cutting) lives in apps/jticket — `next.vue`
  `jmapCommand`/`commandFor`/`resolveBranch` and `coerceProjectMode` in
  `server/utils/store.ts`.
