---
name: to-jdoc
description: Draft a document into the local jTicket app over its HTTP API, without posting anything to Confluence. Docs are block documents in the shared jSuite document system (the jExplain format). Use when the user wants to write, draft, or publish a doc/page/design note/RFC "to jdoc" / "to jTicket docs", or wants a page drafted locally for review first. jTicket is a local app, NOT Confluence.
---

# To jDoc

jTicket (a lean local Nuxt app) has a **docs** section: draft pages stored as
**block documents** in the shared jSuite document system — the same format and
pool as jExplain articles (`@jsuite/documents`, files in `.data/jexplain/`).
Nothing is ever posted to Confluence — a doc exists so you can author it
locally, the user reviews it rendered (at `/docs/DOC-n` in jTicket, and it
also appears in jExplain's list), and *they* copy it elsewhere by hand if they
want it there.

A jTicket doc = a tracker record (`DOC-n`: project, labels, status) wrapping a
shared document (`documentKey`: title page, blocks, glossary).

## Before you start

1. Confirm the app is running. The base URL is always
   `https://jticket.local` — the jSuite Caddy edge serves it there. Never
   guess a localhost port. Quick check:
   ```bash
   curl -sk https://jticket.local/api/docs >/dev/null && echo up \
     || echo "not up — run: ~/code/anyway/jsuite/jsuite start"
   ```

## The content format: blocks

The body is **not markdown** — it is the block vocabulary of the shared
document system: `prose`, `callout`, `code`, `diff`, `chart` (live Excalidraw,
shared with jChart), `steps`, `compare`, `timeline`, `takeaway`, plus an
optional `glossary`. **The full vocabulary with worked examples lives in the
`j-explain` skill** (`~/.claude/skills/j-explain/SKILL.md`) — read its "Block
vocabulary" section before authoring. Everything there applies verbatim;
only the publish call differs.

Give blocks stable `"id"`s if you expect to revise later — the user's
per-block notes pin to those ids.

## Create a doc: `POST /api/docs`

```bash
curl -sk https://jticket.local/api/docs \
  -H 'content-type: application/json' \
  -d @- <<'JSON'
{
  "title": "Checkout revamp — design notes",
  "project": "Checkout",
  "labels": ["design", "payments"],
  "status": "draft",
  "kicker": "DESIGN NOTES",
  "subtitle": "Why the legacy flow is being rebuilt, and how.",
  "glossary": { "PCI": "payment card industry — the compliance scope" },
  "blocks": [
    { "id": "why", "type": "prose", "md": "## Why now\n\nThe legacy flow drops **12%** of carts at the payment step." },
    { "id": "trap", "type": "callout", "tone": "warning", "title": "The trap", "md": "PCI scope is unconfirmed." },
    { "id": "options", "type": "compare", "title": "Options", "columns": ["", "Rebuild", "Patch"],
      "rows": [["Effort", "High", "Low"], ["Debt", "None", "Accrues"]] },
    { "id": "shape", "type": "chart", "title": "New request path",
      "mermaid": "flowchart LR\n  A[Cart] --> B[Pay] --> C[Done]" },
    { "id": "close", "type": "takeaway", "points": ["Rebuild, but stage it behind a flag."] }
  ]
}
JSON
```

Fields:
- `title` — required. Becomes both the record title and the document's `#` —
  start prose at `##`.
- `blocks` — the content. Optional but the point; omitting it creates an empty
  document.
- `subtitle` / `kicker` / `glossary` — document header extras (see j-explain).
- `documentKey` — link an existing shared document instead of authoring one
  (e.g. promote a jExplain article to a tracked doc). 400 on unknown keys.
- `project` — optional parent project, referenced by **title, key, or id**
  (`projectId` also accepted). Omit for a standalone doc.
- `labels` — optional string array; `status` — `draft` (default) or `ready`.

The response returns the generated `key` (e.g. `DOC-3`) and `documentKey`. The
doc is then visible at `https://jticket.local/docs/DOC-3`, on the board,
on its project page — and in jExplain (same document, same notes) at
`https://jexplain.local/e/<documentKey>`.

## Revise: `PATCH /api/docs/:id`

`:id` is the record id or key (`DOC-3`). Metadata fields (`title`, `labels`,
`status`, `project`) update the record. Content fields (`blocks`, `glossary`,
`subtitle`, `kicker`) **rewrite the shared document wholesale** — send the
complete blocks array, never a fragment. Notes and `createdAt` survive, and
chart blocks whose mermaid didn't change keep the user's hand edits (same
idempotency rule as j-explain `--replace`).

```bash
curl -sk -X PATCH https://jticket.local/api/docs/DOC-3 \
  -H 'content-type: application/json' -d @revised-blocks.json
```

## Other endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/docs` | List doc records (`?projectId=` `?status=` `?label=`) |
| GET/DELETE | `/api/docs/:id` | Read / delete the record (delete keeps the shared document in the pool) |
| GET | `/api/documents` | The shared pool itself (also served by jExplain) |
| GET | `/api/documents/:key/notes` | The user's review notes for a document |

## Reading feedback back

The user reviews in either app — hovering a block and pinning notes. Read them
off disk or the API:
- `~/code/anyway/jsuite/.data/jexplain/<documentKey>.json` — the document
- `~/code/anyway/jsuite/.data/jexplain/<documentKey>.notes.json` — their notes
- chart edits land in `~/code/anyway/jsuite/.data/jchart/<chartKey>.json`

## Workflow tips

- POST as `status: "draft"`, then tell the user the key and link
  (`https://jticket.local/docs/DOC-n`) so they can review it rendered.
- Revise via PATCH based on their notes; set `status` to `ready` when they
  sign off.
- Structure like a good article, not a wall of prose: open with why it
  matters, alternate prose with evidence blocks, close with `takeaway`. The
  j-explain skill's "Writing guidance" applies.
- Pair with `to-jticket`: breakdown goes to `/api/import`, the accompanying
  design/RFC doc goes to `/api/docs` (same `project` ref ties them together).
- For a standalone explainer that doesn't belong on the board, use
  `/j-explain` instead — same document system, no tracker record.
