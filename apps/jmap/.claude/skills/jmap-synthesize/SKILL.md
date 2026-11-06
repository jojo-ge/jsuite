---
name: jmap-synthesize
description: Run a jMap synthesis ticket — read the project's jmap:domain walkthrough docs, unify them into the system graph, POST it to jMap (/api/maps/:key/synthesis), and resolve the ticket. Use when "/jmap-synthesize [TICK-n]" is invoked (jTicket dispatches these into herdr on jMap-mode projects).
argument-hint: "[TICK-n]"
disable-model-invocation: true
---

# jmap-synthesize — unify the domain docs into the map

You were dispatched to run the SYNTHESIS ticket of a jMap-mode jTicket
project. The scoping and domain sessions before you documented every part of
the codebase; your job is to read those documents, build ONE system-level
graph, and hand it to jMap — which renders it as the interactive map.

Standing rules:
- The docs are your primary source; Read/Grep in the repo (you are cd'd into
  it) only to settle contradictions. Do not re-map domains.
- **Everything lands in jTicket and jMap.** The only files you write are
  scratch request bodies in a temp dir (the scratchpad dir if one exists,
  else `mktemp -d`) — never in the repo, never as the deliverable.
- Synthesis is **read-only** on the repo.
- jTicket is driven with the `jt` CLI (on PATH after `./jsuite setup`, else
  `~/code/jsuite/bin/jt`; `$JTICKET_URL` overrides the base). jMap (:43007)
  is plain curl.

Invocation: `/jmap-synthesize [TICK-n]`

## 0. Connect first — always

```bash
jt projects >/dev/null && echo jticket-up || echo jticket-down
JMAP="https://jmap.local"
curl -sk --max-time 3 "$JMAP/api/maps" >/dev/null && echo jmap-up || JMAP="http://localhost:43007"
curl -s --max-time 3 "$JMAP/api/maps" >/dev/null && echo jmap-up || echo jmap-down
```

If either is down: tell the user (`cd ~/code/jsuite && ./jsuite status`, then
`./jsuite start`) and STOP. Never fall back to writing files.

## 1. Read your ticket, claim it

```bash
jt show TICK-n            # description names the map key and project
jt set TICK-n assignee=claude status=in_progress
```

The ticket description carries the jMap map key (`` `<mapKey>` ``) and the
project key — you need both.

## 2. Read every domain document

```bash
jt get "/api/docs?projectId=PROJ-key&label=jmap:domain"   # records: key, documentKey, labels, …
# for each: note its TICK-n label (that pairs doc ↔ domain), then
jt get /api/documents/<documentKey>                       # the block body
```

Doc CONTENT is only at `/api/documents/<documentKey>` — the `/api/docs`
records carry no body. Read them ALL — every domain doc, especially each
one's `## Dependencies` section (the edges are drawn from those lines). The
`jmap:scope` doc (`label=jmap:scope`) gives the overview. Ticket resolutions
(`jt project PROJ-key`) add color.

## 3. Build the graph

1. One node of kind `"domain"` per documented domain: id `domain:<slug>`,
   label = the domain's name, `ticketKey` = the TICK-n from the doc's labels
   (jMap uses it to link the node to its walkthrough), and a one-line summary
   in your own words (cut to 300 chars server-side).
2. Where several domains lean on the same thing (a shared data layer, an
   external service, a common package), promote it to its own node — id
   `shared:<slug>`, kind `external` for things outside the repo, otherwise
   the fitting kind — and route their edges through it. Node kinds:
   `domain|component|route|store|service|model|util|external`; anything
   else becomes `external`.
3. Edges from the docs' Dependencies sections, deduplicated: kinds
   `imports|calls|renders|data|http|depends` (unknown → `depends`),
   one-line descriptions (cut to 300 chars). Every edge's `from`/`to` must be
   a node id you emit — jMap drops the rest, and self-edges.
4. `groups`: cluster related domains (3–6 groups) with short labels. Aim for
   every node in exactly one group; jMap doesn't enforce it, so you must.
5. `nodeNotes`: for EVERY node, a paragraph of markdown — what it is, why it
   exists, what would break without it, what a newcomer should know. This is
   the click-panel text; make it explanatory, not a label restatement.
6. `commentary`: the system-level story, markdown, a few paragraphs — how the
   pieces fit, the load-bearing seams, what surprised you.

## 4. Hand the graph to jMap — ONE POST

```bash
cat > "$TMP/jmap-synthesis.json" <<'JSON'
{ "nodes": [ {"id": "domain:ticket-board", "label": "Ticket board", "kind": "domain", "ticketKey": "TICK-12", "summary": "…"} ],
  "edges": [ {"from": "domain:ticket-board", "to": "shared:tracker-store", "kind": "data", "description": "…"} ],
  "groups": [ {"id": "ui", "label": "User interfaces", "nodeIds": ["domain:ticket-board"]} ],
  "nodeNotes": { "domain:ticket-board": "markdown…" },
  "commentary": "markdown…" }
JSON
curl -sk -X POST "$JMAP/api/maps/<mapKey>/synthesis" \
  -H 'content-type: application/json' -d "@$TMP/jmap-synthesis.json"
# -> { "ok": true, "nodes": N, "edges": N, "groups": N, "droppedEdges": N, "url": "https://jmap.local/m/<mapKey>" }
```

A body with no usable nodes is a 400. `droppedEdges > 0` means some edge
named a node id you didn't emit — fix and re-POST only if the drop lost a real
dependency (a re-POST replaces the whole graph).

## 5. Resolve your ticket

Write `$TMP/resolution.md`: node/edge/group counts, the map URL, and one
paragraph on the shape of the system. Then:

```bash
jt set TICK-n status=done assignee=claude resolution="@$TMP/resolution.md"
```

Tell the user the map is live at the URL, then stop.

## Never

- Never modify the repo — synthesis is read-only.
- Never invent domains the docs don't cover; a gap in the docs is worth a
  sentence in the commentary, not a made-up node.
- Never end without resolving the ticket; if truly blocked (e.g. no domain
  docs exist), `jt comment TICK-n "why"` and leave it in_progress.
