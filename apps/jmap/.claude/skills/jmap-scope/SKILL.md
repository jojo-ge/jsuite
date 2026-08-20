---
name: jmap-scope
description: Run a jMap scoping ticket — explore the codebase top-down, publish a scoping doc on the jTicket project, create one jmap:domain ticket per part of the codebase, and resolve the scoping ticket. Use when "/jmap-scope <TICK-n>" is invoked (jTicket dispatches these into herdr on jMap-mode projects).
disable-model-invocation: true
---

# jmap-scope — divide the codebase into mappable domains

You were dispatched to run the SCOPING ticket of a jMap-mode jTicket project.
Your output is a scoping doc plus one ticket per domain — the tickets other
sessions will run with `/jmap-domain` to map each part in depth. Everything
lands in jTicket; you never write files.

Invocation: `/jmap-scope <TICK-n>`

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
curl -s "$JTICKET/api/tickets/TICK-n"          # description carries the repo + map key
curl -s "$JTICKET/api/projects/<PROJ-key>"     # the project — its `repo` is the codebase
curl -s -X PATCH "$JTICKET/api/tickets/TICK-n" -H 'content-type: application/json' \
  -d '{"assignee": "claude", "status": "in_progress"}'
```

You are already cd'd into the repo (herdr set the cwd to the project's repo).

## 2. Explore top-down

Breadth-first, minutes not hours: README / CLAUDE.md / docs, package manifests
and workspace layout, routers and page directories, server route trees, entry
points, build scripts. Skim structure; do not read implementation files end to
end.

Identify **5–15 domains** that together cover the codebase with minimal
overlap. Three kinds: **page** (a user-facing screen or flow), **surface** (an
externally-consumed interface — HTTP API, CLI, skill/plugin system), **system**
(an internal subsystem — data layer, shared package, build/deploy infra). Each
domain gets 2–6 repo-relative entry paths: the best starting files for a
mapper that knows nothing else.

## 3. Publish the scoping doc

One block document on the project — the map's table of contents:

```bash
curl -s -X POST "$JTICKET/api/docs" -H 'content-type: application/json' -d @- <<'JSON'
{ "title": "<project title> — scoping",
  "project": "<PROJ-key>", "labels": ["jmap", "jmap:scoping"], "status": "ready",
  "kicker": "JMAP SCOPING", "subtitle": "How this codebase divides into domains",
  "blocks": [
    { "type": "prose", "md": "## What this codebase is\n…" },
    { "type": "compare", "title": "The domains", "columns": ["Domain", "Kind", "What it does", "Entry paths"],
      "rows": [["Ticket board", "page", "…", "`app/pages/index.vue`"]] },
    { "type": "chart", "title": "Rough shape", "mermaid": "flowchart TD\n  …" },
    { "type": "prose", "md": "## What I deliberately left out\n…" }
  ] }
JSON
```

## 4. Create one ticket per domain

For EACH domain (these are what `/jmap-domain` sessions will run):

```bash
curl -s -X POST "$JTICKET/api/tickets" -H 'content-type: application/json' -d @- <<'JSON'
{ "title": "Map: <domain name>",
  "projectId": "<PROJ-key>", "type": "AFK", "labels": ["jmap", "jmap:domain"],
  "description": "Map the <domain name> domain (<kind>) of this codebase.\n\n<one paragraph: what this domain is and does>\n\nEntry paths:\n- `path/one`\n- `path/two`\n\nCover: how it works end to end, its key files, what it depends on (other domains by name, shared systems, external services), and its gotchas. The /jmap-domain skill carries the full contract.",
  "acceptanceCriteria": [
    "A walkthrough doc labelled jmap:domain + the ticket key is published on the project",
    "The doc has a Dependencies section naming what this domain leans on",
    "The ticket is resolved with a summary and the doc key"
  ] }
JSON
```

Rules:
- Name sibling domains EXACTLY as you name them in other tickets — the
  Dependencies sections cross-reference by these names.
- No `blockedBy` between domain tickets: they are independent and run in
  parallel herdr sessions.

## 5. Resolve your ticket

```bash
curl -s -X PATCH "$JTICKET/api/tickets/TICK-n" -H 'content-type: application/json' \
  -d "$(jq -n --arg r "$(cat resolution.md)" '{status: "done", resolution: $r, assignee: "claude"}')"
```

The resolution: the domain list (name — kind — one line each), the scoping doc
key, and anything the domain mappers should collectively know. Then tell the
user: N domain tickets are ready to Run in jTicket → Up next, and the map will
be synthesized at jMap once their docs land.

## Never

- Never cut branches, open PRs, or modify the repo — scoping is read-only.
- Never map a domain in depth yourself — that is the domain tickets' job.
- Never end without resolving the ticket (or, if truly blocked, PATCH a
  comment-style resolution explaining why and leave status in_progress).
