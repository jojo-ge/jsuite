# j-explain

Explain a concept, a PR, a system, or a decision as a **blog-style article** in the jExplain app — rich typed blocks instead of a wall of text, with **live editable charts** (shared with jChart) and per-block notes that come back to you.

The block format here is **the jSuite document system** (`@jsuite/documents`): one shared pool serving jExplain articles and jTicket docs. This skill's block vocabulary is the authoring reference for both — the to-jdoc / to-jspec skills publish the same blocks through jTicket's `/api/documents`, then attach the result to a project or ticket when a document belongs on the board.

Use this when the user asks you to *explain* something and deserves better than terminal markdown: a PR walkthrough, an architecture tour, a "how does X actually work", a post-mortem, a comparison of options.

**You can make diagrams from right here.** A `chart` block takes inline Mermaid and the server turns it into a real, live Excalidraw canvas embedded in the article — no separate jChart round-trip, no image files. Reach for one whenever the explanation has a *shape*: a request path, a state machine, a before/after architecture, who-calls-what. See the **chart** block below.

## Workflow

1. **Author the payload.** Write a single JSON file (scratchpad dir if one exists) with the shape below. Think like a good tech-blog writer: open with why it matters, alternate prose with evidence (code, diffs, charts), close with takeaways.

2. **Publish it.**
   ```
   python3 ~/.claude/skills/j-explain/scripts/explain.py <payload.json>
   ```
   This creates the explainer, opens it in the browser, and prints the URL plus data file paths. Re-publish a revision with `--replace` (keep the same `key` in the payload): notes survive, and charts whose mermaid didn't change keep the user's hand edits.

3. **Tell the user how to use it.** In the browser they can:
   - Read it as an article — glossary terms show definitions on hover.
   - **Edit any chart directly on its canvas** (full Excalidraw) — it's the same chart object jChart opens; "Open in jChart" jumps to the full workbench with shape-level notes.
   - Hover any block and click the 💬 button in the margin to **pin a note to that block**; general notes live in the right rail.
   - Click **Copy notes for Claude** when done.

4. **Read the result back.** Either the pasted markdown, or directly:
   - `~/code/anyway/jsuite/.data/jexplain/<key>.json` — the document
   - `~/code/anyway/jsuite/.data/jexplain/<key>.notes.json` — `{ general, notes: [{ blockId, label, text }] }`
   - `~/code/anyway/jsuite/.data/jchart/<chartKey>.json` + `.notes.json` — each chart's live scene and shape notes (the user may have redrawn the diagram — the scene is the truth, not your original mermaid)

5. **Act on it.** Revise the payload and re-run with `--replace`.

## Payload shape

```json
{
  "title": "Why the cache invalidation broke",
  "subtitle": "One-sentence standfirst under the title.",
  "kicker": "PR #4821",
  "key": "cache-invalidation-pr-4821",
  "glossary": { "TTL": "time-to-live — how long a cache entry survives" },
  "labels": ["post-mortem", "draft"],
  "blocks": [ ... ]
}
```

- `key` — stable slug; always set it so `--replace` republishes the same URL.
- `kicker` — small uppercase context line (PR number, subsystem, "post-mortem").
- `glossary` — term → definition; first occurrence per prose block gets a dotted-underline hover definition. Use for jargon, not for words the user knows.
- `labels` — lowercase tags for the library's filter bar, deduped on write. Lifecycle is a label like any other (`draft`, `ready`); there is no status field. The same pool is jTicket's document library, so these show up there too. Omit on a `--replace` and the existing labels survive; edit them in the reader header, or `PATCH /api/documents/<key>` with `{ "labels": [...] }`.

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

**chart** — a live Excalidraw canvas, embedded. **This is how you make a diagram in an explainer.** Write Mermaid inline (any kind Mermaid supports: flowchart, sequence, state, class, ER…) and the server materialises it into the **shared jChart store**, keeping only a `chartKey` reference in the block. Optional: `chartKey` (to reuse/name one), `height` (px, default 420), `caption`.
```json
{ "type": "chart", "title": "Request path", "caption": "Where the stale read happens.",
  "mermaid": "flowchart LR\n  A[Req] --> B{Hit?}\n  B -->|yes| C[Return]\n  B -->|no| D[Fetch]" }
```
- Use as many chart blocks in one document as the story needs — each becomes its own chart in the pool.
- The chart is **fully editable in place**: the reader drags shapes, retypes labels, draws new ones, and pins notes to individual shapes — all on the page, no jChart detour. "Open in jChart" is there for the full workbench.
- On `--replace`, a chart whose mermaid is **byte-identical** to last time is left completely untouched, so hand edits and shape notes survive. Changing the mermaid rebuilds the layout (notes survive, hand edits don't) — so don't retouch mermaid you didn't mean to change.
- Charts you author here **are** jChart charts. Embed an existing one with just `{ "type": "chart", "chartKey": "..." }`, and set `chartKey` yourself when you want a stable, nameable chart rather than a slug derived from the doc key + title.
- After the user has edited, read the live scene from `.data/jchart/<chartKey>.json` — not your original mermaid — and its shape notes from `<chartKey>.notes.json`.

**steps** — numbered walkthrough: `{ "type": "steps", "title": "…", "items": [{ "title": "…", "md": "…" }] }`

**compare** — options table, markdown cells: `{ "type": "compare", "title": "…", "columns": ["", "Before", "After"], "rows": [["Latency", "800ms", "**120ms**"]] }`

**timeline** — chronology: `{ "type": "timeline", "events": [{ "when": "14:02", "title": "Deploy", "md": "…" }] }`

**takeaway** — closing card: `{ "type": "takeaway", "points": ["One **markdown** bullet each."] }`

## Writing guidance

- Lead with the point, not the setup. Kicker + title + subtitle should let the user decide to read.
- Prose-first: blocks punctuate the narrative, they don't replace it. Two rich blocks in a row is usually a missing paragraph.
- One idea per chart; five boxes beat fifteen. The user will *edit* your chart — leave it clean enough to edit.
- For PRs: `diff` blocks for the hunks that carry the idea, a `chart` for the shape of the change, links to jDiff/GitHub for the rest.
- End with `takeaway` — it's what the user re-reads.

## Notes

- `explain.py --list` shows everything in the shared pool — including docs authored via jTicket (they're the same objects; a jTicket doc also renders at `/e/<documentKey>` here). The app's home page is <https://jexplain.local>.
- The app is jExplain in the jSuite (`~/code/anyway/jsuite/apps/jexplain`, port 43004). Start everything with `jsuite start`.
- Charts live in the shared chart pool — deleting an explainer never deletes its charts.
- Publishing goes to `POST /api/documents` (explain.py handles this). For a document that should sit on the jTicket board with project/status/labels, use `/to-jdoc` instead — same format, plus a tracker record.
- Opens in Arc by default. Override with `--browser "Google Chrome"` or `$JEXPLAIN_BROWSER`.
