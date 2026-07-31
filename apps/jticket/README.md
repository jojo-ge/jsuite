# jTicket

A lean, local task tracker — **projects**, **epics** and **tickets** with title,
description, acceptance criteria, and blocked-by edges — plus **docs**, draft
Confluence-style pages. It is **not connected to Jira or Confluence** and has no
relation to them. It exists so LLM skills (e.g. Matt Pocock's `to-tickets`, or the
local `to-jspec`) can author a breakdown or a document *locally first*, for you to
review and edit before you author anything to Jira/Confluence by hand.

Built with Nuxt 4 + Nuxt UI 4. Data lives in a single human-editable JSON file at
`.data/jticket.json`.

## Run

```bash
pnpm install
pnpm dev          # http://localhost:3000
```

`pnpm build && node .output/server/index.mjs` for a production run.

## Data model

- **Project** — `{ key: "PROJ-1", title, description, mode }`. Top-level grouping; contains epics.
  - `mode`: `standard` (plain tracker) or `wayfinder` (see **Wayfinder mode** below).
- **Epic** — `{ key: "EPIC-1", title, description, projectId, labels[] }`. Groups tickets. `projectId` may be null (unassigned). In a wayfinder project, an epic labelled `wayfinder:map` *is* a map — its description is the map body.
- **Ticket** — `{ key: "TICK-1", title, description, acceptanceCriteria[], type, status, epicId, assignee, labels[], resolution, blockedBy[] }`
  - `type`: `AFK` (agent-runnable) or `HITL` (needs a human)
  - `status`: `todo` · `in_progress` · `done`
  - `assignee`: free-form name of who is working on it — agents self-assign by name; `""` = unassigned. Filter with `GET /api/tickets?assignee=<name>`. In wayfinder terms, the assignee **is** the claim.
  - `labels`: free-form strings. Wayfinder uses `wayfinder:map` (on the map epic) and `wayfinder:research|prototype|grilling|task` (the ticket sub-type). Filter with `GET /api/tickets?label=<label>`.
  - `resolution`: the answer recorded when the ticket resolves (GFM markdown); `""` until then.
  - `blockedBy`: ids of tickets that must finish first
  - GET responses also attach derived booleans **`blocked`**, **`claimed`**, **`frontier`** (never persisted).
Every `description` / `resolution` field is **plain GFM markdown** and is
rendered as such in the UI (via the shared `@jsuite/documents` renderer). Card
summaries are the exception — they show a flattened plain-text preview so the
line clamp stays honest.

- **Doc** — `{ key: "DOC-1", title, documentKey, projectId, labels[], status }`.
  A tracker record wrapping a **block document** in the shared jSuite document
  system (`@jsuite/documents`; files in the root `.data/jexplain/` pool, which
  jExplain lists and renders too). Shown at the top of the board and at
  `/docs/DOC-1`.
  - Content is authored as **blocks** (prose, callout, code, diff, chart,
    steps, compare, timeline, takeaway + glossary — the jExplain format).
    `POST /api/docs` with `blocks` creates the document; `documentKey` links an
    existing one; `PATCH` with `blocks` rewrites it (notes survive). Full
    reference at **/api-guide** in the running app.
  - `status`: `draft` · `ready`
  - Images: `POST /api/attachments` with `{ name, base64 }` → serve from
    `/attachments/<name>`, reference as `![alt](/attachments/<name>)` in prose.

## HTTP API

See **/api-guide** in the running app. Summary:

| Method | Path | Purpose |
| --- | --- | --- |
| GET/POST | `/api/projects` | List / create projects |
| GET/PATCH/DELETE | `/api/projects/:id` | Read / update / delete a project (id or key) |
| GET/POST | `/api/epics` | List / create epics |
| GET/PATCH/DELETE | `/api/epics/:id` | Read / update / delete an epic (id or key) |
| GET/POST | `/api/tickets` | List (`?epicId=`, `?status=`) / create tickets |
| GET/PATCH/DELETE | `/api/tickets/:id` | Read / update / delete a ticket (id or key) |
| POST | `/api/import` | Bulk-create a whole breakdown at once |
| GET/POST | `/api/docs` | List (`?projectId=`, `?status=`, `?label=`) / create docs |
| GET/PATCH/DELETE | `/api/docs/:id` | Read / update / delete a doc (id or key) |
| GET/POST | `/api/attachments` | List / upload attachments for docs |

### Bulk import (recommended for skills)

`POST /api/import` authors an entire breakdown in one call. Reference each epic's
`project` by **title or key**, each ticket's `epic` by **title or key**, and
`blockedBy` by ticket **title or key** — generated ids are resolved for you after
everything is created. `projects` and `epics` are optional.

```bash
curl -s http://localhost:3000/api/import -H 'content-type: application/json' -d '{
  "projects": [{ "title": "Checkout", "description": "Everything payments-related" }],
  "epics":   [{ "title": "Checkout revamp", "description": "New payment flow", "project": "Checkout" }],
  "tickets": [
    { "title": "Add cart schema", "description": "Persist a cart.", "type": "AFK",
      "epic": "Checkout revamp", "acceptanceCriteria": ["Survives refresh"] },
    { "title": "Cart UI", "description": "Edit quantities.", "type": "AFK",
      "epic": "Checkout revamp", "blockedBy": ["Add cart schema"] }
  ]
}'
```

## Wayfinder mode

Set a project's `mode` to `wayfinder` and it becomes a home for [wayfinder](https://github.com/) maps. The mapping:

| Wayfinder concept | jTicket |
| --- | --- |
| Map | an **epic** labelled `wayfinder:map` (its description is the map body: Destination / Notes / Decisions / Fog / Out-of-scope) |
| Ticket | a **ticket** under that epic; body = the question |
| Ticket sub-type | a `wayfinder:research\|prototype\|grilling\|task` **label** |
| AFK / HITL | the ticket **`type`** |
| Blocking | **`blockedBy`** |
| Claim | set **`assignee`** (an assigned ticket leaves the frontier) |
| Frontier | `GET /api/tickets?epicId=<map>&frontier=true` — todo + all `blockedBy` done + unassigned, key-ordered |
| Resolve | set `status: "done"`, fill **`resolution`**, add a gist to the map's *Decisions so far* |

In the UI, **every** epic — wayfinder map or standard — renders its tickets grouped into **Frontier · In progress · Blocked · Resolved**, key-ordered within each group, with frontier tickets ring-highlighted. What a wayfinder map adds on top is the collapsible map body above the groups and the `wayfinder:<type>` sub-type badge on each card.

**Authoring a whole map** via `POST /api/import`: give the project `"mode": "wayfinder"`, the epic `"labels": ["wayfinder:map"]`, and each ticket a `"wayfinderType": "research"` (shorthand that adds the `wayfinder:<type>` label) — e.g.:

```jsonc
{
  "projects": [{ "title": "Rive Story Assets", "mode": "wayfinder" }],
  "epics":    [{ "title": "Rive — Map", "project": "Rive Story Assets", "labels": ["wayfinder:map"], "description": "## Destination\n…" }],
  "tickets":  [{ "title": "Choose the runtime", "epic": "Rive — Map", "type": "AFK", "wayfinderType": "research" }]
}
```

## Pointing the `to-tickets` skill here

When the skill asks where to publish, tell it: **publish to the local jTicket app
via `POST http://localhost:3000/api/import`** instead of Jira. It maps cleanly:
skill "tickets" → tickets, "blocked by" → `blockedBy` (by title), AFK/HITL → `type`,
parent → `epic`.

## The `to-jspec` skill

The companion `/to-jspec` skill (bundled at `.claude/skills/to-jspec`) teaches an LLM to
draft docs here via `POST /api/docs`, including the block-document format. It pairs
with Matt Pocock's `/to-spec`, which decides what the document says — `to-jspec` covers how
it is written and where it lands. Documents are drafts only — review them at
`http://localhost:3000/docs`, then copy into Confluence by hand if and when you want them
there.
