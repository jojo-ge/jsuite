---
name: jmap-scope
description: Run a jMap scoping ticket — explore the codebase top-down, publish a jmap:scope doc on the jTicket project, create one jmap:domain ticket per part of the codebase, and resolve the scoping ticket. Use when "/jmap-scope [TICK-n]" is invoked (jTicket dispatches these into herdr on jMap-mode projects).
argument-hint: "[TICK-n]"
disable-model-invocation: true
---

# jmap-scope — divide the codebase into mappable domains

You were dispatched to run the SCOPING ticket of a jMap-mode jTicket project.
Your output is a scoping doc plus one ticket per domain — the tickets other
sessions will run with `/jmap-domain` to map each part in depth.

Standing rules:
- **Everything lands in jTicket.** The only files you write are scratch
  request bodies in a temp dir (the scratchpad dir if one exists, else
  `mktemp -d`) — never in the repo, never as the deliverable.
- Scoping is **read-only**: no branches, PRs or repo edits.
- jTicket is driven with the `jt` CLI (on PATH after `./jsuite setup`, else
  `bin/jt` in the jSuite checkout; `$JTICKET_URL` overrides the base). Values starting
  with `@` are read from a file; raw verbs take `@file.json` or `-` (stdin).

Invocation: `/jmap-scope [TICK-n]`

## 0. Connect first — always

```bash
jt projects >/dev/null && echo up || echo down
```

If down: tell the user jTicket isn't running (`jsuite
status`, then `jsuite start`) and STOP. Never fall back to writing files.

## 1. Read your ticket, claim it

```bash
jt show TICK-n            # description carries the repo + map key
jt project PROJ-key       # the project — its `repo` is the codebase
jt set TICK-n assignee=claude status=in_progress
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

One block document on the project — the map's table of contents. Label it
`jmap:scope` (the protocol label; `/jmap-synthesize` and the jMap room's
progress panel both read it by that name):

```bash
cat > "$TMP/scope-doc.json" <<'JSON'
{ "title": "<project title> — scoping",
  "project": "<PROJ-key>", "labels": ["jmap", "jmap:scope"], "status": "ready",
  "kicker": "JMAP SCOPING", "subtitle": "How this codebase divides into domains",
  "blocks": [
    { "type": "prose", "md": "## What this codebase is\n…" },
    { "type": "compare", "title": "The domains", "columns": ["Domain", "Kind", "What it does", "Entry paths"],
      "rows": [["Ticket board", "page", "…", "`app/pages/index.vue`"]] },
    { "type": "chart", "title": "Rough shape", "mermaid": "flowchart TD\n  …" },
    { "type": "prose", "md": "## What I deliberately left out\n…" }
  ] }
JSON
jt post /api/docs "@$TMP/scope-doc.json"      # -> { key: "DOC-n", documentKey: "…", … }
```

## 4. Create one ticket per domain

For EACH domain (these are what `/jmap-domain` sessions will run), write the
description and acceptance criteria to scratch files, then:

```bash
cat > "$TMP/desc.md" <<'MD'
Map the <domain name> domain (<kind>) of this codebase.

<one paragraph: what this domain is and does>

Entry paths:
- `path/one`
- `path/two`

Cover: how it works end to end, its key files, what it depends on (other domains by name, shared systems, external services), and its gotchas. The /jmap-domain skill carries the full contract.
MD
cat > "$TMP/ac.md" <<'MD'
A walkthrough doc labelled jmap:domain + the ticket key is published on the project
The doc has a Dependencies section naming what this domain leans on
The ticket is resolved with a summary and the doc key
MD
jt new PROJ-key "Map: <domain name>" type=docs labels=afk,jmap,jmap:domain \
  description="@$TMP/desc.md" acceptanceCriteria="@$TMP/ac.md"
```

(`acceptanceCriteria` is one criterion per line; `labels` comma-separated.)

Rules:
- Name sibling domains EXACTLY as you name them in other tickets — the
  Dependencies sections cross-reference by these names.
- No `blockedBy` between domain tickets: they are independent and run in
  parallel herdr sessions.

## 5. Resolve your ticket

Write the resolution to `$TMP/resolution.md`: the domain list (name — kind —
one line each), the scoping doc key, and anything the domain mappers should
collectively know. Then:

```bash
jt set TICK-n status=done assignee=claude resolution="@$TMP/resolution.md"
```

Tell the user: N domain tickets are ready to Run from the jTicket project's
board (`https://jticket.local/projects/PROJ-n`), and the map will be
synthesized at jMap once their docs land.

## Never

- Never cut branches, open PRs, or modify the repo — scoping is read-only.
- Never map a domain in depth yourself — that is the domain tickets' job.
- Never end without resolving the ticket; if truly blocked, `jt comment
  TICK-n "why"` (author `claude` by default) and leave it in_progress.
