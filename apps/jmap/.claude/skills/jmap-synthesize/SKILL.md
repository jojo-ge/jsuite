---
name: jmap-synthesize
description: Run a jMap synthesis ticket — read the project's domain walkthrough docs, unify them into the system graph, POST it to jMap, and resolve the ticket. Use when "/jmap-synthesize <TICK-n>" is invoked (jTicket dispatches these into herdr on jMap-mode projects).
disable-model-invocation: true
---

# jmap-synthesize — unify the domain docs into the map

You were dispatched to run the SYNTHESIS ticket of a jMap-mode jTicket
project. The scoping and domain sessions before you documented every part of
the codebase; your job is to read those documents, build ONE system-level
graph, and hand it to jMap — which renders it as the interactive map. The
docs are your primary source; you may Read/Grep in the repo (you are cd'd
into it) to settle contradictions, but do not re-map domains.

Invocation: `/jmap-synthesize <TICK-n>`

## 0. Connect first — always

```bash
JTICKET="${JTICKET_URL:-http://localhost:43000}"
curl -s --max-time 3 "$JTICKET/api/projects" >/dev/null && echo jticket-up || echo jticket-down
JMAP="https://jmap.local"
curl -sk --max-time 3 "$JMAP/api/maps" >/dev/null && echo jmap-up || JMAP="http://localhost:43007"
curl -s --max-time 3 "$JMAP/api/maps" >/dev/null && echo jmap-up || echo jmap-down
```

If either is down: tell the user (`cd ~/code/anyway/jsuite && ./jsuite start`)
and STOP. Never fall back to writing files.

## 1. Read your ticket, claim it

```bash
curl -s "$JTICKET/api/tickets/TICK-n"   # description names the map key and project
curl -s -X PATCH "$JTICKET/api/tickets/TICK-n" -H 'content-type: application/json' \
  -d '{"assignee": "claude", "status": "in_progress"}'
```

The ticket description carries the jMap map key (`` `<mapKey>` ``) and the
project key — you need both.

## 2. Read every domain document

```bash
curl -s "$JTICKET/api/docs?projectId=<PROJ-key>&label=jmap:domain"
# for each: note its TICK-n label (that pairs doc ↔ domain), then
curl -s "$JTICKET/api/documents/<documentKey>"   # the block body
```

Read them ALL — every domain doc, especially each one's `## Dependencies`
section (the edges are drawn from those lines). The `jmap:scoping` doc gives
the overview. Ticket resolutions (`GET /api/projects/<PROJ-key>`) add color.

## 3. Build the graph

1. One node of kind `"domain"` per documented domain: id `domain:<slug>`,
   label = the domain's name, `ticketKey` = the TICK-n from the doc's labels
   (jMap uses it to link the node to its walkthrough), and a one-line summary
   in your own words.
2. Where several domains lean on the same thing (a shared data layer, an
   external service, a common package), promote it to its own node — id
   `shared:<slug>`, kind `external` for things outside the repo, otherwise
   the fitting kind (`store`/`service`/`util`/…) — and route their edges
   through it.
3. Edges from the docs' Dependencies sections, deduplicated: kinds
   `imports|calls|renders|data|http|depends`, one-line descriptions. Every
   edge's `from`/`to` must be a node id you emit (jMap drops the rest).
4. `groups`: cluster related domains (3–6 groups; every node in exactly one)
   with short labels.
5. `nodeNotes`: for EVERY node, a paragraph of markdown — what it is, why it
   exists, what would break without it, what a newcomer should know. This is
   the click-panel text; make it explanatory, not a label restatement.
6. `commentary`: the system-level story, markdown, a few paragraphs — how the
   pieces fit, the load-bearing seams, what surprised you.

## 4. Hand the graph to jMap — ONE POST

```bash
cat > /tmp/jmap-synthesis.json <<'JSON'
{ "nodes": [ {"id": "domain:ticket-board", "label": "Ticket board", "kind": "domain", "ticketKey": "TICK-12", "summary": "…"} ],
  "edges": [ {"from": "domain:ticket-board", "to": "shared:tracker-store", "kind": "data", "description": "…"} ],
  "groups": [ {"id": "ui", "label": "User interfaces", "nodeIds": ["domain:ticket-board"]} ],
  "nodeNotes": { "domain:ticket-board": "markdown…" },
  "commentary": "markdown…" }
JSON
curl -sk -X POST "$JMAP/api/maps/<mapKey>/synthesis" \
  -H 'content-type: application/json' -d @/tmp/jmap-synthesis.json
# -> { "ok": true, "nodes": N, "edges": N, "droppedEdges": N, "url": "https://jmap.local/m/<mapKey>" }
```

`droppedEdges > 0` means some edge named a node id you didn't emit — fix and
re-POST only if the drop lost a real dependency (a re-POST replaces the whole
graph).

## 5. Resolve your ticket

```bash
curl -s -X PATCH "$JTICKET/api/tickets/TICK-n" -H 'content-type: application/json' \
  -d "$(jq -n --arg r "$(cat resolution.md)" '{status: "done", resolution: $r, assignee: "claude"}')"
```

The resolution: node/edge/group counts, the map URL, and one paragraph on the
shape of the system. Tell the user the map is live at the URL, then stop.

## Never

- Never modify the repo — synthesis is read-only.
- Never invent domains the docs don't cover; a gap in the docs is worth a
  sentence in the commentary, not a made-up node.
- Never end without resolving the ticket; if truly blocked (e.g. no domain
  docs exist), post a comment saying why and leave it in_progress.
