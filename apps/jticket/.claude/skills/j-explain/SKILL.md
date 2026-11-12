---
name: j-explain
description: Explain something as a blog-style article in jTicket's document reader (formerly jExplain) — a PR walkthrough, architecture tour, post-mortem, "how does X actually work", or options comparison — built from typed blocks (prose, code, diff, live editable charts, images, steps, compare, timeline, takeaway) and published with explain.py; the reader's per-block notes, screenshots and sketches come back to you. Use when the user says "explain this in jexplain", "explain this as an article", "write this up as a walkthrough/post-mortem", or any explanation that deserves better than terminal markdown. Also the block-vocabulary reference for to-jdoc payloads.
---

# j-explain

Explain a concept, a PR, a system, or a decision as a **blog-style article** in jTicket's document reader (`/e/<key>`, the page jExplain used to serve) — rich typed blocks instead of a wall of text, with **live editable charts** (the same charts jTicket's chart editor opens) and per-block notes that come back to you.

The block format here is **the jSuite document system** (`@jsuite/documents`): one shared pool serving articles like these and jTicket docs, all read in jTicket. This skill's block vocabulary is the authoring reference for both — the to-jdoc skill publishes the same blocks through jTicket's `/api/docs` when a document belongs on the board.

Use this when the user asks you to *explain* something and deserves better than terminal markdown: a PR walkthrough, an architecture tour, a "how does X actually work", a post-mortem, a comparison of options.

**You can make diagrams from right here.** A `chart` block takes inline Mermaid and the server turns it into a real, live Excalidraw canvas embedded in the article — no separate chart round-trip, no image files. Reach for one whenever the explanation has a *shape*: a request path, a state machine, a before/after architecture, who-calls-what. See the **chart** block below.

Standing rules: always set a stable `key` so `--replace` keeps the URL; read notes back from the files, not a paste; a `chart` block with neither `mermaid` nor `chartKey` is **silently dropped**, so give every chart one or the other. Script: `~/.claude/skills/j-explain/scripts/explain.py` (installed by `./jsuite setup`; source at `$(jsuite root)/apps/jticket/.claude/skills/j-explain/scripts/explain.py`).

## Workflow

1. **Author the payload.** Write a single JSON file (scratchpad dir) with the shape below. Think like a good tech-blog writer: open with why it matters, alternate prose with evidence (code, diffs, charts), close with takeaways.

2. **Publish it.**
   ```
   python3 ~/.claude/skills/j-explain/scripts/explain.py <payload.json>
   ```
   This creates the document, opens it in jTicket's reader (`https://jticket.local/e/<key>`), and prints that URL plus data file paths. Re-publish a revision with `--replace` (keep the same `key` in the payload): notes survive, and charts whose mermaid didn't change keep the user's hand edits.

3. **Tell the user how to use it.** In the browser they can:
   - Read it as an article — glossary terms show definitions on hover.
   - **Edit any chart directly on its canvas** (full Excalidraw) — it's the same chart object the chart editor opens; **Open editor** jumps to `/charts/<key>`, the full editor, which is where shape-level notes are pinned.
   - Hover any block and click the 💬 button in the margin to **pin a note to that block**; general notes live in the right rail. A note can carry **screenshots** (pasted/uploaded) and **sketches** drawn in the rail — some feedback is faster to draw an arrow at than to describe.
   - Press the rail's copy button when done — **Copy summary for Claude** while there are no notes, **Copy notes for Claude** once there are.

4. **Read the result back.** Either the pasted markdown, or directly (paths printed by the script; the data root is `$JSUITE_DATA_DIR` if set, else `$(jsuite root)/.data`):
   - `.data/jexplain/<key>.json` — the document
   - `.data/jexplain/<key>.notes.json` — `{ general, generalAttachments?, notes: [{ id, blockId, label, text, attachments? }] }`; an attachment is `{ id, src, kind: "shot" | "sketch", caption? }` with the bytes under `.data/jexplain/media/<key>/notes/` (served at `src`). Read the pictures — a sketch often IS the feedback.
   - `.data/jchart/<chartKey>.json` + `.notes.json` — each chart's live scene and shape notes (the user may have redrawn the diagram — the scene is the truth, not your original mermaid)

5. **Act on it.** Revise the payload and re-run with `--replace`.

## Payload shape

```json
{
  "title": "Why the cache invalidation broke",
  "subtitle": "One-sentence standfirst under the title.",
  "kicker": "PR #4821",
  "key": "cache-invalidation-pr-4821",
  "tags": ["explainer"],
  "glossary": { "TTL": "time-to-live — how long a cache entry survives" },
  "blocks": [ ... ]
}
```

- `key` — stable slug; always set it so `--replace` republishes the same URL.
- `kicker` — small uppercase context line (PR number, subsystem, "post-mortem").
- `tags` — always set it: ONE tag saying what kind of document this is. The library (`/e`) lists and searches only `explainer` (how something works, a branch walkthrough), `research` (findings, audits, inventories), `decision` (options weighed, a decision record), `spec`, `proposal` (a plan put forward) — pick the one that fits. Any other kind (`status-report` for a progress write-up, and the machine-written `slice-report`, `outcome-report`, `review-output`) is filed behind the library's **Other kinds** switch; `jt get /api/document-tags` lists the kinds in use, and a new one is not coined without the user asking. A `--replace` that sends no `tags` keeps the one the document had. To re-tag without republishing: `jt patch /api/documents/<key> '{"tags": ["decision"]}'`.
- `glossary` — term → definition; first occurrence per prose block gets a dotted-underline hover definition. Use for jargon, not for words the user knows.

## Block vocabulary

Every block may set `"id"` (a stable string) — do so when you expect to `--replace` later, otherwise ids are positional (`b1`…`bn`) and the user's block notes orphan when you reorder.

**prose** — the backbone. Markdown with `##`/`###` headings, lists, links, inline code.
```json
{ "type": "prose", "md": "## The failure\n\nNormal **markdown**." }
```

**callout** — tone-coded aside. Tones: `insight` (aha), `warning` (trap), `success` (win), `aside` (context).
```json
{ "type": "callout", "tone": "warning", "title": "The trap", "md": "TTL is per-key, not per-tag." }
```

**code** — syntax-highlighted, with line highlights and per-line margin annotations. `highlight` and `annotations[].line` use the **displayed** numbers (file numbering when `startLine` is set).
```json
{ "type": "code", "lang": "ts", "file": "cache.ts", "startLine": 40, "highlight": [42, 43],
  "code": "export function invalidate(tag: string) {\n  …\n}",
  "annotations": [{ "line": 42, "md": "This loops **keys**, not tags." }] }
```

**diff** — unified diff text (`@@` hunks, `+`/`-` lines), annotations pinned by exact line text, markdown commentary underneath. Curate the hunks that matter — an explainer quotes the diff, it doesn't dump it.
```json
{ "type": "diff", "file": "cache.ts",
  "diff": "@@ -12,3 +12,4 @@\n-  del(key)\n+  delByTag(tag)",
  "annotations": [{ "on": "+  delByTag(tag)", "md": "The fix." }],
  "commentary": "Everything else in the PR is plumbing for this line." }
```

**chart** — a live Excalidraw canvas, embedded. **This is how you make a diagram in an explainer.** Write Mermaid inline (any kind Mermaid supports: flowchart, sequence, state, class, ER…) and the server materialises it into the **shared chart pool** (`.data/jchart/`), keeping only a `chartKey` reference in the block. Optional: `chartKey` (to reuse/name one), `height` (px, default 420), `caption`. A chart block with neither `mermaid` nor `chartKey` is dropped silently.
```json
{ "type": "chart", "title": "Request path", "caption": "Where the stale read happens.",
  "mermaid": "flowchart LR\n  A[Req] --> B{Hit?}\n  B -->|yes| C[Return]\n  B -->|no| D[Fetch]" }
```
- Use as many chart blocks in one document as the story needs — each becomes its own chart in the pool.
- The chart is **fully editable in place**: the reader drags shapes, retypes labels and draws new ones on the page. Shape notes are **not** pinned on the page: on the page a chart takes a block note like any other block (💬 in the margin); per-shape notes are pinned in the full editor (**Open editor** → `/charts/<key>`) and land in `.data/jchart/<key>.notes.json`, not in the document's notes.
- On `--replace`, a chart whose mermaid is **byte-identical** to last time is left completely untouched, so hand edits and shape notes survive. Changing the mermaid rebuilds the layout (notes survive, hand edits don't) — so don't retouch mermaid you didn't mean to change.
- Charts you author here **are** the chart editor's charts (`j-chart` pushes to the same pool). Embed an existing one with just `{ "type": "chart", "chartKey": "..." }`, and set `chartKey` yourself when you want a stable, nameable chart rather than a slug derived from the doc key + title.
- After the user has edited, read the live scene from `.data/jchart/<chartKey>.json` — not your original mermaid — and its shape notes from `<chartKey>.notes.json`.

**image** — a screenshot or picture, framed like a screenshot, click to zoom, with its own note thread (notes pin to block ids, so one image = one conversation). Give it bytes one of three ways: a local `file` path (copied into `.data/jexplain/media/<docKey>/` — the document keeps working after the source is moved), inline `base64` / `dataUrl` (for bytes you hold; `name` picks the stored filename and its extension the type), or an already-served `src` when republishing. Optional `title`, `caption` (markdown), `alt`, `width` (px), `framed` (default true). png/jpg/gif/webp/svg/avif, max 12MB inline.
```json
{ "type": "image", "file": "/abs/path/checkout-before.png", "alt": "Legacy checkout",
  "caption": "The step that loses **12%** of carts." }
```
- On `--replace`, media the new blocks no longer reference is pruned — send existing image blocks back with their `src` (read them from `.data/jexplain/<key>.json`) rather than re-copying the file each time.
- Don't put `/attachments/…` links (jTicket's ticket-markdown store) in a document: the document renderer doesn't resolve that path. Image blocks are served at `/api/media/<docKey>/<file>`.

**steps** — numbered walkthrough: `{ "type": "steps", "title": "…", "items": [{ "title": "…", "md": "…" }] }`

**compare** — options table, markdown cells: `{ "type": "compare", "title": "…", "columns": ["", "Before", "After"], "rows": [["Latency", "800ms", "**120ms**"]] }`

**timeline** — chronology: `{ "type": "timeline", "title": "…", "events": [{ "when": "14:02", "title": "Deploy", "md": "…" }] }` (`title` optional)

**takeaway** — closing card: `{ "type": "takeaway", "title": "…", "points": ["One **markdown** bullet each."] }` (`title` optional)

## Writing guidance

- Lead with the point, not the setup. Kicker + title + subtitle should let the user decide to read.
- Prose-first: blocks punctuate the narrative, they don't replace it. Two rich blocks in a row is usually a missing paragraph.
- One idea per chart; five boxes beat fifteen. The user will *edit* your chart — leave it clean enough to edit.
- For PRs: `diff` blocks for the hunks that carry the idea, a `chart` for the shape of the change, links to the project's Diff tab (`/projects/KEY?tab=diff&pr=…`) or GitHub for the rest.
- End with `takeaway` — it's what the user re-reads.

## Notes

- `explain.py --list` shows everything in the shared pool — including docs authored via jTicket (they're the same objects; a DOC-n's content also renders at `/e/<documentKey>`). The whole pool is listed in jTicket's **All documents** library at <https://jticket.local/e>.
- Publishing goes to jTicket (port 43000; `$JTICKET_URL` overrides, so a `jsuite sandbox` session publishes into the sandbox). If publishing fails: `jsuite status`, then `jsuite start`.
- Charts live in the shared chart pool — deleting a document never deletes its charts.
- Publishing goes to `POST /api/documents` (explain.py handles this). For a document that should sit on the jTicket board with project/status/labels, use `/to-jdoc` instead — same format, plus a tracker record.
- Opens in Arc by default. Override with `--browser "Google Chrome"` or `$JTICKET_BROWSER`.
