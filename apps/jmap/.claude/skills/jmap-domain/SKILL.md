---
name: jmap-domain
description: Run a jMap domain-mapping ticket — explore one part of the codebase, publish its walkthrough doc (labelled jmap:domain + the ticket key) on the jTicket project, and resolve the ticket. Use when "/jmap-domain [TICK-n]" is invoked (jTicket dispatches these into herdr on jMap-mode projects).
argument-hint: "[TICK-n]"
disable-model-invocation: true
---

# jmap-domain — map one domain and document it

You were dispatched to run ONE domain-mapping ticket of a jMap-mode jTicket
project. Your output is a walkthrough document — both the human-readable tour
of this part of the codebase AND the input jMap's synthesis pass eats to build
the system map, so the Dependencies section is not optional.

Standing rules:
- **Everything lands in jTicket.** The only files you write are scratch
  request bodies in a temp dir (the scratchpad dir if one exists, else
  `mktemp -d`) — never in the repo, never as the deliverable.
- Mapping is **read-only**: no branches, PRs or repo edits.
- jTicket is driven with the `jt` CLI (on PATH after `./jsuite setup`, else
  `bin/jt` in the jSuite checkout; `$JTICKET_URL` overrides the base). Values starting
  with `@` are read from a file; raw verbs take `@file.json` or `-` (stdin).

Invocation: `/jmap-domain [TICK-n]`

## 0. Connect first — always

```bash
jt projects >/dev/null && echo up || echo down
```

If down: tell the user jTicket isn't running (`jsuite
status`, then `jsuite start`) and STOP. Never fall back to writing files.

## 1. Read your ticket, claim it

```bash
jt show TICK-n            # description: the domain, its entry paths
jt project PROJ-key       # sibling "Map: …" tickets = the other domains
jt set TICK-n assignee=claude status=in_progress
```

Note the names of the sibling domains — your Dependencies section must refer
to them by exactly those names. You are already cd'd into the repo.

## 2. Explore the domain

Read-only exploration (Read/Grep/Glob/git) from the ticket's entry paths
outward: trace imports, calls, data flow, and where this domain touches its
siblings. Stay inside your domain — when a trail crosses into a sibling's
territory, record the dependency and turn back rather than mapping their side.

## 3. Publish the walkthrough doc

One block document on the project. Structure (the j-explain vocabulary):

```bash
cat > "$TMP/doc.json" <<'JSON'
{ "title": "<domain name> — walkthrough",
  "project": "<PROJ-key>",
  "labels": ["jmap", "jmap:domain", "TICK-n"],
  "status": "ready",
  "kicker": "JMAP DOMAIN", "subtitle": "<one line on the domain>",
  "blocks": [
    { "type": "prose", "md": "## What this is\n…\n\n## How it works\n<the end-to-end story>" },
    { "type": "chart", "title": "Internal structure", "mermaid": "flowchart TD\n  …" },
    { "type": "compare", "title": "Key files", "columns": ["File", "Role"], "rows": [["`path`", "…"]] },
    { "type": "prose", "md": "## Dependencies\n- **<sibling domain name>** — <kind: imports|calls|renders|data|http|depends> — <one line why>\n- **<shared system, e.g. the tracker store>** — data — <one line>\n- **<external service>** — http — <one line>" },
    { "type": "callout", "tone": "warning", "title": "Gotchas", "md": "…" },
    { "type": "takeaway", "title": "Remember", "points": ["…"] }
  ],
  "glossary": { "term": "definition" } }
JSON
jt post /api/docs "@$TMP/doc.json"      # -> { key: "DOC-n", documentKey: "…", … }
```

Non-negotiable rules:
- **`labels` MUST include `jmap:domain` AND your ticket key** (`TICK-n`) —
  that is how the synthesis pass pairs the doc with the ticket.
- **The `## Dependencies` section MUST exist**, naming sibling domains by their
  exact names and shared/external systems explicitly, one line each with the
  dependency kind. The system map's edges are drawn from these lines.
- Include at least one mermaid chart of the domain's internal structure.

## 4. Resolve your ticket

Write `$TMP/resolution.md`: a one-paragraph summary of the domain, the doc key
(DOC-n), and the dependency list repeated one line each. Then:

```bash
jt set TICK-n status=done assignee=claude resolution="@$TMP/resolution.md"
```

Then stop — the map is synthesized in jMap once enough domains are documented.

## Never

- Never cut branches, open PRs, or modify the repo — mapping is read-only.
- Never map a sibling domain's internals — record the edge and turn back.
- Never end without resolving the ticket; if truly blocked, `jt comment
  TICK-n "why"` (author `claude` by default — a raw POST to
  `/api/tickets/TICK-n/comments` without `author` is anonymous) and leave it
  in_progress.
