---
name: jmap-domain
description: Run a jMap domain-mapping ticket — explore one part of the codebase, publish its walkthrough doc on the jTicket project, and resolve the ticket. Use when "/jmap-domain <TICK-n>" is invoked (jTicket dispatches these into herdr on jMap-mode projects).
disable-model-invocation: true
---

# jmap-domain — map one domain and document it

You were dispatched to run ONE domain-mapping ticket of a jMap-mode jTicket
project. Your output is a walkthrough document — it is both the human-readable
tour of this part of the codebase AND the input jMap's synthesis pass eats to
build the system map, so the Dependencies section is not optional. Everything
lands in jTicket; you never write files.

Invocation: `/jmap-domain <TICK-n>`

## 0. Connect first — always

```bash
JTICKET="${JTICKET_URL:-http://localhost:43000}"
curl -s --max-time 3 "$JTICKET/api/projects" >/dev/null && echo up || echo down
```

If down: tell the user jTicket isn't running
(`cd ~/code/anyway/jsuite && ./jsuite start`) and STOP. Never fall back to
writing files.

## 1. Read your ticket, claim it

```bash
curl -s "$JTICKET/api/tickets/TICK-n"      # description: the domain, its entry paths
curl -s "$JTICKET/api/projects/<PROJ-key>" # sibling "Map: …" tickets = the other domains
curl -s -X PATCH "$JTICKET/api/tickets/TICK-n" -H 'content-type: application/json' \
  -d '{"assignee": "claude", "status": "in_progress"}'
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
curl -s -X POST "$JTICKET/api/docs" -H 'content-type: application/json' -d @- <<'JSON'
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
```

Non-negotiable rules:
- **`labels` MUST include `jmap:domain` AND your ticket key** (`TICK-n`) —
  that is how the synthesis pass pairs the doc with the ticket.
- **The `## Dependencies` section MUST exist**, naming sibling domains by their
  exact names and shared/external systems explicitly, one line each with the
  dependency kind. The system map's edges are drawn from these lines.
- Include at least one mermaid chart of the domain's internal structure.

## 4. Resolve your ticket

```bash
curl -s -X PATCH "$JTICKET/api/tickets/TICK-n" -H 'content-type: application/json' \
  -d "$(jq -n --arg r "$(cat resolution.md)" '{status: "done", resolution: $r, assignee: "claude"}')"
```

The resolution: a one-paragraph summary of the domain, the doc key (DOC-n),
and the dependency list repeated in one line each. Then stop — the map is
synthesized in jMap once enough domains are documented.

## Never

- Never cut branches, open PRs, or modify the repo — mapping is read-only.
- Never map a sibling domain's internals — record the edge and turn back.
- Never end without resolving the ticket; if truly blocked, post a comment
  (`POST /api/tickets/TICK-n/comments`) saying why and leave it in_progress.
