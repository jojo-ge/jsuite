# jMap

Map a codebase: point jMap at a directory and get an interactive dependency
map of the whole system, backed by readable walkthrough documents per domain —
with all the mapping work planned, dispatched, and recorded in jTicket.

Runs at https://jmap.local (port 43007) behind the jSuite edge.

## How a map happens

Creating a map (directory + title) creates a **jMap-mode project in jTicket**
(repo = the directory, so herdr dispatch has its cwd) and one scoping ticket.
From there the whole process runs through jTicket's herdr buttons:

1. **Scoping** — Run the scoping ticket from jTicket → Up next. The button
   dispatches `/jmap-scope TICK-n` into a herdr claude session, which explores
   the repo top-down, publishes a scoping doc on the project, and creates one
   `jmap:domain` ticket per part of the codebase (each with entry paths).
2. **Domain mapping** — Run the domain tickets (individually or "Run all").
   Each dispatches `/jmap-domain TICK-n`: the session explores its domain,
   publishes a walkthrough doc on the project (labelled `jmap:domain` + its
   ticket key, with a mandatory **Dependencies** section), and resolves its
   ticket. jMap-mode tickets never get branches or PRs — their output is docs.
3. **Synthesis** — a ticket too: the map room's Synthesize button creates a
   `jmap:synthesize` ticket on the project, and Running it dispatches
   `/jmap-synthesize TICK-n`. That session reads the domain docs, unifies
   them into the graph — one node per domain, shared systems promoted to
   their own nodes, edges drawn from the docs' Dependencies sections, groups,
   per-node commentary — and POSTs it to jMap
   (`POST /api/maps/:key/synthesis`), which flips the map to `done`.

jMap itself runs no claude. The map room (`/m/<key>`) tracks all three phases
live (polling jTicket) and renders the finished map the moment the synthesis
POST lands: a hand-rolled SVG — pan (drag) / zoom (wheel), hover to highlight
a node's neighborhood, click for the detail panel (commentary, dependencies,
link to the domain's walkthrough at `/e/<key>`).

## API

| Route | Method | Notes |
| --- | --- | --- |
| `/api/maps` | GET / POST | list; create `{ repoPath, title? }` → `{ key, path, projectKey }` — **also creates the jTicket project + scoping ticket** |
| `/api/maps/:key` | GET / DELETE | the map (+ synthesis); deleting keeps the jTicket project and docs |
| `/api/maps/:key/progress` | GET | live project/ticket/doc state, proxied from jTicket |
| `/api/maps/:key/synthesize-ticket` | POST | create the `jmap:synthesize` ticket (returns the open one if it exists) |
| `/api/maps/:key/synthesis` | POST | the synthesis session's hand-back: `{ nodes, edges, groups, nodeNotes, commentary }` → map `done` |

Plus `/api/documents/**` and `/api/charts/**` inherited from the
`@jsuite/documents` layer.

## Skills

- `j-map` — the front door: "map this codebase" → create the map (and its
  jTicket project), hand the user the two rooms, stop.
- `jmap-scope` — what the scoping ticket's herdr session runs.
- `jmap-domain` — what each domain ticket's herdr session runs.
- `jmap-synthesize` — what the synthesis ticket's herdr session runs.

All installed globally by `./jsuite setup` (SKILLS_MANIFEST). The jTicket side
(project mode `jmap`, `/jmap-*` dispatch, no branch-cutting) lives in
apps/jticket.

## Testing without burning claude runs

Every phase is simulable with curl: create domain tickets + docs (labels
`jmap:domain` + `TICK-n`) against jTicket, resolve the tickets, POST a
hand-written graph to `/api/maps/:key/synthesis`, and the map renders —
zero claude spend. The real runs happen only in herdr sessions.
