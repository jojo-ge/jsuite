---
name: to-jdoc
description: Draft a document into the local jTicket app over its HTTP API, without posting anything to Confluence. Docs are block documents in the shared jSuite document system (the jExplain format). Use when the user wants to write, draft, or publish a doc/page/design note/RFC "to jdoc" / "to jTicket docs", or wants a page drafted locally for review first. jTicket is a local app, NOT Confluence.
---

# To jDoc

jTicket (a lean local Nuxt app) has a **docs** section: draft pages stored as
**block documents** in the shared jSuite document system — the same format and
pool as jExplain articles (`@jsuite/documents`, files in `.data/jexplain/`).
Nothing is ever posted to Confluence — a doc exists so you can author it
locally, the user reviews it rendered (at `/docs/<key>` in jTicket, and it
also appears in jExplain's list), and *they* copy it elsewhere by hand if they
want it there.

A jTicket doc **is** a shared document — there is no tracker record in front of
it. Writing one is two calls: create it in the pool, then **attach** it to the
project or ticket it belongs to. jTicket owns that link; the pool stays
ticket-ignorant.

## Before you start

1. Confirm the app is running. The base URL is always
   `https://jticket.local` — the jSuite Caddy edge serves it there. Never
   guess a localhost port. Quick check:
   ```bash
   curl -sk https://jticket.local/api/documents >/dev/null && echo up \
     || echo "not up — run: ./jsuite start"
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

## 1. Write the document: `POST /api/documents`

```bash
curl -sk https://jticket.local/api/documents \
  -H 'content-type: application/json' \
  -d @- <<'JSON'
{
  "title": "Checkout revamp — design notes",
  "key": "checkout-revamp-design-notes",
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
- `title` — required. Becomes the document's `#` — start prose at `##`.
- `blocks` — the content. Optional but the point; omitting it creates an empty
  document.
- `subtitle` / `kicker` / `glossary` — document header extras (see j-explain).
- `key` — the pool key, and the id every attachment ref uses. Omit and one is
  slugged from the title (suffixed if taken). **Set it explicitly** when you
  intend to revise, so you know what to `replace`.
- `replace: true` — overwrite the named key in place instead of minting a new
  one. See "Revise" below.

The response returns `{ key, title, path, blocks }`. The document is readable
at `https://jticket.local/docs/<key>` and, same document and same notes, at
`https://jexplain.local/e/<key>`.

## 2. Attach it where it belongs

A document in the pool belongs to nothing until you say so. Attach it to the
project it's the spec for, or the ticket it's the design note for:

```bash
# to a project
curl -sk https://jticket.local/api/projects/PROJ-2/attachments \
  -H 'content-type: application/json' \
  -d '{ "type": "document", "id": "checkout-revamp-design-notes" }'

# or to a single ticket
curl -sk https://jticket.local/api/tickets/TICK-7/attachments \
  -H 'content-type: application/json' \
  -d '{ "type": "document", "id": "checkout-revamp-design-notes" }'
```

Attaching is idempotent, and the same document can hang off several records.
Skipping this step is fine for a standalone page — it still shows in the
documents library, under "Not attached".

## Revise: `POST /api/documents` with `replace: true`

Send the **complete** blocks array, never a fragment — a replace rewrites the
document wholesale. Notes and `createdAt` survive, and chart blocks whose
mermaid didn't change keep the user's hand edits (same idempotency rule as
j-explain `--replace`).

```bash
curl -sk https://jticket.local/api/documents \
  -H 'content-type: application/json' \
  -d '{ "key": "checkout-revamp-design-notes", "replace": true, "title": "…", "blocks": [ … ] }'
```

Attachments point at the key, so a replace needs no re-attaching.

## Other endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/documents` | The whole shared pool (also served by jExplain) |
| GET | `/api/documents/:key` | One document |
| DELETE | `/api/documents/:key` | Delete it — every attachment ref to it then reads as `missing` |
| GET | `/api/documents/:key/notes` | The user's review notes for a document |
| GET | `/api/projects/:id/attachments` | A project's artifacts, resolved (title, url, `missing`) |
| GET | `/api/tickets/:id/attachments` | Same, for a ticket |
| DELETE | `/api/{projects,tickets}/:id/attachments?type=document&id=<key>` | Unlink (the document stays in the pool) |

Note `/api/attachments` is a *different* thing — uploaded image files for use
inside markdown, not artifact refs.

## Reading feedback back

The user reviews in either app — hovering a block and pinning notes. Read them
off disk or the API, under the jSuite root's `.data/`:
- `.data/jexplain/<key>.json` — the document
- `.data/jexplain/<key>.notes.json` — their notes
- chart edits land in `.data/jchart/<chartKey>.json`

## Workflow tips

- POST the document, attach it, then tell the user the key and link
  (`https://jticket.local/docs/<key>`) so they can review it rendered.
- Revise with `replace: true` based on their notes.
- Structure like a good article, not a wall of prose: open with why it
  matters, alternate prose with evidence blocks, close with `takeaway`. The
  j-explain skill's "Writing guidance" applies.
- Pair with `to-jticket`: the breakdown goes to `/api/import`, the accompanying
  design/RFC doc goes to `/api/documents` and is then attached to the same
  project — that attachment is what ties them together.
- For a standalone explainer that doesn't belong on the board, use
  `/j-explain` instead — same document system, and you can attach it later if
  it turns out to matter to a ticket.
