# jTicket HTTP API

Base URL `$JTICKET` = `${JTICKET_URL:-http://localhost:43000}`. Every write is JSON:
`-H 'content-type: application/json'`. The running app also serves a live reference at
`$JTICKET/api-guide`.

| Method | Path | Purpose |
| --- | --- | --- |
| GET / POST | `/api/projects` | List / create projects |
| GET / PATCH / DELETE | `/api/projects/:id` | One project (id **or** key) |
| GET / POST | `/api/tickets` | List / create tickets |
| GET / PATCH / DELETE | `/api/tickets/:id` | One ticket (id or key) |
| POST | `/api/tickets/:id/comments` | Add a comment to a ticket |
| DELETE | `/api/tickets/:id/comments/:commentId` | Delete one comment |
| POST | `/api/import` | Bulk-author a whole breakdown |
| GET / POST / DELETE | `/api/tickets/:id/attachments` | A ticket's artifact refs — resolve / attach / detach |
| GET / POST / DELETE | `/api/projects/:id/attachments` | Same, for a project |
| GET / POST | `/api/documents` | The shared document pool (also served by jExplain) |
| GET / DELETE | `/api/documents/:key` | One shared document |
| GET | `/api/charts` | The shared chart pool (also served by jChart) |
| GET / POST | `/api/uploads` | List / upload FILES for markdown — *not* artifact refs |
| GET | `/uploads/:name` | Serve an uploaded file |
| GET / POST | `/api/attachments` | Legacy alias — redirects to `/api/uploads` |
| GET | `/attachments/:name` | Legacy alias — redirects to `/uploads/:name` |

`:id` accepts the internal id or the human key (`PROJ-1`, `TICK-7`).

## Query params

```
GET /api/tickets?projectId=PROJ-2   # project id or key
                &status=todo|in_progress|done
                &assignee=<exact name>
                &label=<exact label>
                &frontier=true      # todo + unblocked + unassigned, key-ordered
                &finished=true      # done tickets, newest completedAt first
                &since=<ISO>        # completedAt >= this (pairs with finished=true)
```

Filters combine with AND. `frontier=true` is applied last and sorts by key number
(`TICK-9` before `TICK-10`).

Every ticket in a GET response is augmented with three **read-only derived** booleans:

- `blocked` — some ticket in `blockedBy` is not `done`
- `claimed` — `assignee` is non-empty
- `frontier` — `status === "todo"` && !claimed && !blocked

`completedAt` is also read-only, but it **is** persisted: the server stamps it when a
ticket moves into `done` and clears it when it moves out. Sending it in a POST/PATCH body
is ignored. Editing an already-done ticket keeps the original stamp, so a resolution fix
doesn't reorder `?finished=true`.

## Payloads

### Project

```jsonc
POST /api/projects
{ "title": "Checkout",                  // required
  "description": "Everything payments-related",
  "mode": "standard",                   // or "wayfinder"; anything else → "standard"
  "attachments": [                      // artifact refs — see "Attached artifacts"
    { "type": "document", "id": "checkout-revamp-spec" }
  ] }
```

`PATCH /api/projects/:id` accepts the same fields; omitted fields are untouched.

### Ticket

```jsonc
POST /api/tickets
{ "title": "Persist the cart",          // required
  "description": "What to build, from the user's perspective",
  "acceptanceCriteria": ["Survives refresh"],
  "type": "AFK",                        // or "HITL"; anything else → "AFK"
  "status": "todo",                     // todo | in_progress | done
  "projectId": "PROJ-2",                // id or KEY only — 400 if unknown
  "assignee": "",                       // free-form name; "" = unassigned
  "labels": ["wayfinder:research"],
  "resolution": "",                     // the answer, GFM markdown
  "blockedBy": ["TICK-3"],              // ids or KEYS only — unknown refs DROPPED silently
  "attachments": [                      // artifact refs — see "Attached artifacts"
    { "type": "diff", "id": "branch/tick-7-persist-cart" }
  ] }
```

`PATCH /api/tickets/:id` — same fields, all optional.

- Array fields (`acceptanceCriteria`, `labels`, `blockedBy`, `attachments`) are
  **replaced wholesale**. Read-modify-write to append — except `attachments`, which has
  its own add/drop endpoints.
- `assignee: ""` unassigns. `resolution: ""` clears.
- `projectId: null` detaches (→ backlog). A self-blocking edge is dropped.
- Labels are trimmed, emptied-out, and de-duplicated on the way in.
- `comments` is **not PATCHable** — use the comments endpoint below.

### Ticket comments

A discussion thread on the ticket, returned inline on every ticket GET as
`comments: [{ id, author, body, createdAt }]`. The human leaves direction here before
handing a ticket to an LLM — **read them before working a ticket**. LLMs post their own
comments (questions, progress notes) under their own name; the final answer still
belongs in `resolution`.

```jsonc
POST /api/tickets/:id/comments
{ "author": "claude",                   // free-form name; omitted → "anonymous"
  "body": "Started on this — the schema needs a migration first." }  // required, GFM markdown
→ 201 { "id": "cmt_…", "author": "claude", "body": "…", "createdAt": "…" }
```

`DELETE /api/tickets/:id/comments/:commentId` removes one comment (`:commentId` is the
comment's `id`, not an index). There is no comment edit — delete and re-post.

### Attached artifacts

Both tickets and projects carry `attachments: { type, id }[]` — refs into the shared
pools. jTicket owns the link; the pools stay ticket-ignorant.

| `type` | `id` is | Resolved against |
| --- | --- | --- |
| `document` | a key in the shared document pool | `.data/jexplain/<id>.json` |
| `chart` | a key in the shared chart pool | `.data/jchart/<id>.json` |
| `diff` | a jDiff review target — `"123"` (a PR) or `"branch/<name>"` | the owning project's `repo` |

```jsonc
POST /api/tickets/TICK-7/attachments
{ "type": "document", "id": "checkout-revamp-spec" }
→ 201 [ { "type": "document", "id": "checkout-revamp-spec" }, … ]   // the whole list back
```

Attaching is **idempotent**, and the artifact need not exist yet. Detach with
`DELETE /api/tickets/TICK-7/attachments?type=document&id=checkout-revamp-spec` — a diff
id contains a slash, so it travels as a query param. The artifact itself is never touched.

`GET /api/tickets/:id/attachments` **resolves** every ref against its pool:

```jsonc
[ { "type": "document", "id": "checkout-revamp-spec",
    "title": "Checkout revamp — spec",          // the artifact's own title
    "url": "/documents/checkout-revamp-spec",
    "updatedAt": "2026-08-16T…",
    "missing": false },
  { "type": "chart", "id": "deleted-chart",
    "title": "deleted-chart", "url": "", "updatedAt": "",
    "missing": true,                             // the artifact is gone …
    "reason": "no chart with that key in the shared pool" } ]   // … and why
```

A ref is **allowed to dangle** — it reads as `missing` rather than erroring, so a link the
human made shows as broken instead of silently disappearing. A `diff` on a ticket with no
project (or a project with no `repo`) is `missing` for the same reason: nothing to read it
against.

`attachments` is also accepted on `POST`/`PATCH` of a ticket or project, and on
`/api/import` — but PATCH **replaces the array wholesale**, so prefer the endpoints above
to add or drop one ref without a read-modify-write.

Writing the document itself is `POST /api/documents` (see **to-jdoc**); the document then
renders at `$JTICKET/documents/<key>` and in jExplain at `https://jexplain.local/e/<key>`.

### Uploaded files

Unrelated to the artifact attachments above: these are image files for use inside markdown.

```jsonc
POST /api/uploads
{ "name": "checkout-flow.png",
  "base64": "iVBORw0KGgo…" }            // bare base64 or a full data: URL
→ 201 { "name": "checkout-flow.png", "url": "/uploads/checkout-flow.png", "size": 20480 }
```

Reference it from a doc body as `![Checkout flow](/uploads/checkout-flow.png)`.
**Same name overwrites** — no versioning, no warning.

```bash
# upload a local file
curl -s "$JTICKET/api/uploads" -H 'content-type: application/json' \
  -d "$(jq -n --arg n 'checkout-flow.png' --arg b "$(base64 -i ./flow.png)" \
        '{name:$n, base64:$b}')"
```

`/api/attachments` and `/attachments/:name` still work — they redirect (308) to
the `/uploads` equivalents, which is what keeps markdown written before the
rename resolving. Prefer `/uploads` in anything you author now.

## Bulk import

`POST /api/import` authors a whole breakdown in one call. This is the **only** endpoint
that resolves references by **title**, which is what makes it usable before any id exists.

```jsonc
{
  "projects": [{ "title": "Checkout", "description": "…", "mode": "standard" }],
  "tickets":  [
    { "title": "Add cart schema", "description": "Persist a cart.", "type": "AFK",
      "project": "Checkout",                      // project title or key
      "acceptanceCriteria": ["Survives refresh"] },
    { "title": "Cart UI", "description": "Edit quantities.", "type": "AFK",
      "project": "Checkout",
      "blockedBy": ["Add cart schema"] }          // ticket TITLES or keys
  ]
}
→ 201 { "projects": [...], "tickets": [...] }   // with generated keys
```

- Both arrays are optional. Order within the call does not matter: projects are
  created, then tickets, then `blockedBy` edges are wired in a second pass — so a
  ticket may block-reference one declared later in the same array.
- `wayfinderType: "research"` on a ticket is shorthand that adds the label
  `wayfinder:research`. Only valid here.
- `attachments` is accepted on both projects and tickets, exactly as on POST.
- **It always creates.** There is no upsert. Re-running the same import duplicates
  everything. To extend an existing project, send only `tickets` and reference the
  project by key.
- Unresolvable `project` / `blockedBy` refs are **dropped silently** — the
  ticket is still created, just unparented or unblocked. Always verify:

```bash
curl -s "$JTICKET/api/tickets?projectId=PROJ-2" | jq '.[] | {key, title, blockedBy, blocked}'
```

## Storage

One human-editable JSON file at `<jSuite root>/.data/jticket/jticket.json`. Deletes are
immediate and unrecoverable — there is no trash and no undo.

Attached artifacts do **not** live in that file — only the `{ type, id }` refs do. The
artifacts themselves are in the shared pools (`.data/jexplain/`, `.data/jchart/`) or, for
a diff, computed by jDiff from a repo. Deleting an artifact leaves every ref to it in
place, reading as `missing`.
