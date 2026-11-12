---
name: to-jdoc
description: Write a document into jTicket as a doc (DOC-n) — a spec, design note, RFC or any page — as a block document published with `jt post /api/docs`; also the format every other jTicket field takes. Use when the user wants a spec or a doc written into jTicket ("to jdoc"), when revising a DOC-n from their notes, or before writing a ticket description, resolution or project description. jTicket is local — nothing is posted to Confluence.
---

# To jDoc

A jTicket **doc** is a tracker record (`DOC-n`: project, labels, status) wrapping
a **block document** in the shared pool (`documentKey`) — the same pool and
format as `j-explain` articles. It is a **local draft**: the user reviews it
rendered and copies it elsewhere by hand if they want it there. Nothing is ever
posted to Confluence.

Every call goes through `jt` (on PATH after `./jsuite setup`, else `bin/jt` in
the jSuite checkout), which talks to `http://localhost:43000` (`$JTICKET_URL`
overrides).

## Steps

1. **Connect.** `jt projects >/dev/null && echo up || echo down`. Down: say so
   (`./jsuite status`, then `./jsuite start`) and stop — a file on disk is not a
   fallback.
2. **Decide what the document says.**
   - A **spec**: run `/to-spec` first. It owns the template (Problem Statement →
     Solution → User Stories → Implementation Decisions → Testing Decisions →
     Out of Scope → Further Notes), the seams check and the no-interview rule.
   - **Any other doc** (design note, RFC, page): structure it like an article —
     open with why it matters, alternate prose with evidence blocks, close with
     a `takeaway`. The `j-explain` skill's "Writing guidance" applies.
   - A plan's map belongs to `/jplan`; an explainer with no place on the board
     belongs to `/j-explain` (same document system, no tracker record).
3. **Author the blocks** — see [Blocks](#blocks).
4. **Publish** as `status: "draft"` — see [Publish](#publish).
5. **Report** the key, the title and both links
   (`https://jticket.local/docs/DOC-n`, `https://jticket.local/e/<documentKey>`),
   and say plainly that it is a local draft.
6. **Revise** from the user's notes — see [Revise](#revise). Set `status` to
   `ready` only when they sign off.

Next, if the user wants the spec sliced into work: `/to-jticket tickets`,
pointed at the `DOC-n` (same `project` ref ties the breakdown to the doc).

## Blocks

The body is **not markdown** — it is the block vocabulary of the shared document
system: `prose`, `callout`, `code`, `diff`, `chart`, `image`, `steps`,
`compare`, `timeline`, `takeaway`, plus an optional `glossary`. **The vocabulary
with worked examples lives in the `j-explain` skill**
(`~/.claude/skills/j-explain/SKILL.md`) — read its "Block vocabulary" section
before authoring. Everything there applies verbatim; only the publish call
differs.

- **Start prose at `##`.** The `title` field is the `#`.
- **Give every block a stable `id`** — the user's review notes pin to them.
- **A spec** takes one `prose` block per `/to-spec` section; `compare` for an
  options table; `chart` for the shape of the system; `takeaway` for the
  decisions summary.
- **Restraint.** Prose carries the document. A `callout` marks one of the two
  or three things a reader must not miss.
- **Pictures are `image` blocks**: `file` (an absolute path on this machine) or
  `base64` / `dataUrl` (inline bytes; `name` picks the stored filename). The
  server copies them into `.data/jexplain/media/<documentKey>/`.
  `/attachments/…` links are for ticket markdown only.
- **File paths and code snippets go stale** — keep them out of specs, except a
  snippet that encodes a decision more precisely than prose can (a state
  machine, a schema, a type shape): a `code` block, with where it came from.

## Publish

Pick the project first (`jt projects` — key, title, mode per row) and use an
existing one where it fits. Write the doc to a file, then post it:

```bash
cat > doc.json <<'JSON'
{
  "title": "Checkout revamp — spec",
  "project": "PROJ-1",
  "labels": ["spec"],
  "tags": ["spec"],
  "status": "draft",
  "kicker": "SPEC",
  "subtitle": "Why the legacy flow is being rebuilt, and how.",
  "glossary": { "PCI": "payment card industry — the compliance scope" },
  "blocks": [
    { "id": "problem", "type": "prose", "md": "## Problem Statement\n\nThe legacy flow drops **12%** of carts at the payment step." },
    { "id": "risk", "type": "callout", "tone": "warning", "title": "Blocking risk", "md": "PCI scope is unconfirmed." },
    { "id": "options", "type": "compare", "title": "Options", "columns": ["", "Rebuild", "Patch"],
      "rows": [["Effort", "High", "Low"], ["Debt", "None", "Accrues"]] },
    { "id": "shape", "type": "chart", "title": "New request path",
      "mermaid": "flowchart LR\n  A[Cart] --> B[Pay] --> C[Done]" },
    { "id": "today", "type": "image", "file": "/abs/path/legacy-checkout.png",
      "alt": "Legacy checkout", "caption": "The step that loses the carts." },
    { "id": "close", "type": "takeaway", "points": ["Rebuild, but stage it behind a flag."] }
  ]
}
JSON
jt post /api/docs @doc.json     # or `-` for stdin
```

| Field | Notes |
| --- | --- |
| `title` | required — the record title and the document's `#` |
| `blocks` | the content; omitted, the document is empty |
| `subtitle` / `kicker` / `glossary` | document header extras (see `j-explain`) |
| `project` | optional parent, by id, key or exact title (`projectId` is a synonym); an unknown one is a 400. Omit for a standalone doc |
| `labels` | string array — `["spec"]` makes a spec findable: `GET /api/docs?label=spec` |
| `tags` | always set it: ONE tag on the document itself saying what kind it is. The **All documents** library (`/e`) lists and searches only `explainer` (how something works, a branch walkthrough), `research` (findings, audits, inventories), `decision` (options weighed, a decision record), `spec`, `proposal` (a plan put forward) — pick the one that fits; any other kind is filed behind the library's **Other kinds** switch (`jt get /api/document-tags` lists the kinds in use; don't coin one unasked). Not `labels`: those sit on the record and the engine reads them. PATCH `{"tags": [...]}` re-tags without touching the content |
| `status` | `draft` (default) or `ready` |
| `documentKey` | link an existing shared document instead of authoring one (promote a `j-explain` article to a tracked doc); an unknown key is a 400 |

The response carries the generated `key` (`DOC-3`) and `documentKey`. The doc
is then on the board, on its project page, at `/docs/DOC-3`, and in the **All
documents** library (`/e`) beside reports and articles.

## Revise

```bash
jt get /api/documents/<documentKey>             # the current blocks, images with their stored `src`
jt patch /api/docs/DOC-3 @revised.json          # {"blocks": [...]}
```

`:id` is the record id or key. Metadata (`title`, `labels`, `status`,
`project`) updates the record. Content (`blocks`, `glossary`, `subtitle`,
`kicker`) **rewrites the shared document wholesale** — send the complete blocks
array, with existing image blocks carrying their stored `src` (media a rewrite
no longer references is pruned). Notes and `createdAt` survive, and a chart
whose mermaid didn't change keeps the user's hand edits.

The user's feedback is notes pinned to blocks, and edits to charts:

- `jt get /api/documents/<documentKey>/notes` — their notes
  (on disk: `$(jsuite root)/.data/jexplain/<documentKey>.notes.json`)
- `$(jsuite root)/.data/jchart/<chartKey>.json` — a chart as they left it

Other endpoints: `GET /api/docs` lists records (`?projectId=` `?status=`
`?label=`); `DELETE /api/docs/:id` removes the record and keeps the shared
document in the pool; `GET /api/documents` is the pool itself.

## Which field takes what

Only a doc's `blocks` hold rich structure. Every other field is plain GFM
markdown (tables, task lists, fenced code with a language, blockquotes).

| Field | Format | Write |
| --- | --- | --- |
| Doc content (`blocks`) | **block document** | the document itself |
| Ticket `description` | GFM markdown; the card shows a one-line plain-text preview | the *what*, from the user's perspective, meaning front-loaded |
| Ticket `resolution` | GFM markdown | the answer — what was decided and why — plus links to whatever it produced; the one field a future session reads for the outcome |
| Project `description` | GFM markdown on the board, preview on project cards | short for ordinary projects; a plan project keeps its whole map here (`/jplan` owns it) |
| Ticket `acceptanceCriteria[]` | **inline** markdown only | `` `code` ``, `**bold**`, links |
| Pictures in ticket markdown | `![…](/attachments/<name>)` | upload first: `POST /api/attachments` `{ file }` or `{ name, base64 }`, embed its `markdown` |

Ticket comments are the discussion around the work; the resolution is its
outcome. The rest of the jTicket surface — tickets, projects, the full
[API reference](../to-jticket/reference/api.md) — is `/to-jticket`.
