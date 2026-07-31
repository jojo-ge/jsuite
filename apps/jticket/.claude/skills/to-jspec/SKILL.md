---
name: to-jspec
description: Write a spec into jTicket as a doc — a block document in the shared jSuite document system (the jExplain format), which field renders what, and the exact publish call. Use when authoring or updating any jTicket doc body, ticket description, resolution, or epic description. Pair with /to-spec, which decides what the document says.
---

# To jspec

**`/to-spec` decides what the document says. This skill covers how it is written and where
it lands.** Do not duplicate the spec process here — run `/to-spec` for the template
(Problem Statement → Solution → User Stories → Implementation Decisions → Testing
Decisions → Out of Scope → Further Notes), the seams check, and the no-interview rule.

What you get here: **which format each jTicket field takes**, and the `POST /api/docs`
call that publishes a spec.

A jTicket doc is explicitly a **local draft**. Nothing is connected to Confluence — the
user reviews and edits locally, then hand-copies if needed. Since the document-system
unification, a doc's content is a **block document** — the jExplain format, one shared
system (`@jsuite/documents`) serving jTicket and jExplain from one pool. A spec published
here also shows up in jExplain's article list; that is by design.

## Process

1. **Run `/to-spec`** to produce the document's content. Everything below is about form.
2. **Author the blocks.** The vocabulary (prose, callout, code, diff, chart, steps,
   compare, timeline, takeaway, glossary) lives in the **`j-explain` skill** — read its
   "Block vocabulary" section. Spec-shaped guidance: one `prose` block per `/to-spec`
   section (start at `##` — the doc `title` is the `#`); `callout` for the two or three
   things a reader must not miss; `compare` for options tables; `chart` for the shape of
   the system; `takeaway` for the decisions summary. Give blocks stable `id`s — the
   user's review notes pin to them.
3. **Publish** as `status: "draft"` (see [Publish](#publish)).
4. **Report** the key, title and both links (`$JTICKET/docs/DOC-n`,
   `https://jexplain.local:7443/e/<documentKey>`), and say plainly that it is a local
   draft — nothing has been posted to Confluence.

Connect first, as always — if jTicket is down, say so and stop rather than writing a file
as a fallback:

```bash
JTICKET="${JTICKET_URL:-https://jticket.local:7443}"
curl -sk --max-time 3 "$JTICKET/api/projects" >/dev/null && echo up || echo down
```

## Which field takes what

| Field | Format | Write |
| --- | --- | --- |
| Doc content (`blocks`) | **block document** | the spec itself — this is the one home of rich structure |
| Ticket `description` | plain **GFM markdown**, plus a **plain-text preview** on the card | front-load the meaning; the card preview collapses it to one line |
| Ticket `resolution` | plain GFM markdown | the answer, plus links to whatever it produced |
| Epic `description` | plain GFM markdown | short — it sits above the ticket list |
| Project `description` | plain GFM markdown on the board, preview on project cards | one or two lines |
| Ticket `acceptanceCriteria[]` | **inline** markdown only | `` `code` ``, `**bold**`, links — nothing block-level |

There is no jdoc dialect any more — no `:::` panels, `[[toc]]`, `{status:…}` lozenges,
`@[mentions]`, `[date:…]` or `++underline++` **anywhere**. In markdown fields plain GFM
is it (tables, task lists, fenced code with a language, blockquotes all work). Structure
beyond that belongs in the doc's blocks, not in a description.

## Conventions

- **Start prose at `##`.** The `title` field is the `#`.
- **Avoid file paths and code snippets** in specs and tickets — they go stale fast. The
  exception is a snippet that encodes a decision more precisely than prose can (a state
  machine, a schema, a type shape): use a `code` block for it, and say where it came from.
- **Descriptions are the *what*, not the *how*** — prose from the user's perspective, short
  enough to read on a card, not a layer-by-layer implementation list.
- **Resolutions are the answer** — what was decided and why, plus links to any asset
  produced. jTicket has no comments, so this field stands in for the resolution comment.
- **Restraint.** Prose blocks carry a spec. Callouts mark the two or three things a
  reader must not miss; don't build a wall of panels.

## Publish

Pick the project first — list them and use an existing one where it fits, rather than
inventing a new one:

```bash
curl -sk "$JTICKET/api/projects" | jq '.[] | {key, title, mode}'
```

```bash
curl -sk "$JTICKET/api/docs" -H 'content-type: application/json' -d @- <<'JSON'
{
  "title": "Checkout revamp — spec",
  "project": "PROJ-1",
  "labels": ["spec"],
  "status": "draft",
  "kicker": "SPEC",
  "blocks": [
    { "id": "problem", "type": "prose", "md": "## Problem Statement\n\n…" },
    { "id": "solution", "type": "prose", "md": "## Solution\n\n…" },
    { "id": "risk", "type": "callout", "tone": "warning", "title": "Blocking risk", "md": "…" },
    { "id": "oos", "type": "prose", "md": "## Out of Scope\n\n…" },
    { "id": "close", "type": "takeaway", "points": ["Decision one.", "Decision two."] }
  ]
}
JSON
```

Prefer a heredoc or `-d @spec.json` over hand-escaping JSON into a shell string.

- `project` accepts an id, key, **or exact title** — and 400s on an unknown one, so this is
  the rare jTicket ref that fails loudly rather than silently. `projectId` is a synonym.
- `status: "draft"` — a spec stays a draft until the user says otherwise. Promote to
  `"ready"` only when they ask.
- `labels: ["spec"]` makes it findable: `GET /api/docs?label=spec`.
- **Updating is `PATCH /api/docs/DOC-n` with the new `blocks`, replaced wholesale.** Send
  the complete blocks array, never a fragment. Notes and unchanged charts survive the
  rewrite. To revise one section, GET the document first
  (`/api/documents/<documentKey>`), edit, and PATCH the whole thing back.

Next step, if the user wants it: `/to-jticket tickets` to slice the spec into a breakdown,
pointing it at the `DOC-n` you just created.

## Related

- **`/to-spec`** — what goes in the document. Always run it first.
- **`/j-explain`** — the block vocabulary reference, and the same document system without
  a tracker record (for explainers that don't belong on the board).
- **`/to-jdoc`** — general doc drafting into jTicket (non-spec pages).
- **`/to-jticket`** — the rest of the jTicket surface: tickets, epics, direct reads and
  writes, the full [API reference](../to-jticket/reference/api.md).
- **`/jwayfinder`** — if this is a wayfinder map rather than a spec, stop and use that.
