---
name: j-map
description: Map a codebase in jMap — creating a map creates a jMap-mode jTicket project whose herdr-dispatched tickets scope the repo and document each domain, and jMap synthesizes the docs into an interactive dependency map. Use when the user says "map this codebase", "make a jmap", "jmap this repo", or wants an architecture map of a repository.
---

# j-map — send a codebase to jMap

jMap (https://jmap.local) maps a codebase through jTicket:

1. Creating a map creates a **jMap-mode jTicket project** (repo = the mapped
   directory) with a **scoping ticket**. Running that ticket in herdr (the Run
   button on jTicket → Up next dispatches `/jmap-scope`) divides the repo into
   domains — a scoping doc plus one `jmap:domain` ticket per part.
2. Running the domain tickets (each dispatches `/jmap-domain`; "Run all" takes
   the whole frontier) documents every domain as a walkthrough doc on the
   project.
3. The map room's Synthesize button creates a `jmap:synthesize` ticket;
   Running it dispatches `/jmap-synthesize`, and that session unifies the
   docs into the graph and POSTs it to jMap — the interactive map renders at
   `https://jmap.local/m/<key>`.

Your job here is only to open the door — the phases run from jTicket and the
map room.

## 1. Connect first — always

```bash
curl -sk --max-time 3 https://jmap.local/api/maps >/dev/null && echo up || echo down
```

If down: tell the user the suite isn't running
(`cd ~/code/anyway/jsuite && ./jsuite status`, then `./jsuite start`) and STOP.
Do not fall back to mapping the codebase yourself in this session. Creating a
map also needs jTicket up — the same `./jsuite start` covers both.

## 2. Create the map

`repoPath` is the ABSOLUTE path of the repo to map (usually the cwd):

```bash
curl -sk -X POST https://jmap.local/api/maps \
  -H 'content-type: application/json' \
  -d '{"repoPath": "/absolute/path/to/repo", "title": "repo name"}'
# -> { "key": "…", "title": "…", "path": "/m/<key>", "projectKey": "PROJ-n" }
```

This creates the jTicket project + scoping ticket as a side effect.

## 3. Point the user at the two rooms, then stop

```bash
open "https://jmap.local/m/<key>"
```

Tell the user: the scoping ticket is ready to Run in herdr from
`https://jticket.local/next` (project `PROJ-n`), and the jMap room tracks
progress and holds the Synthesize button. Then stop — the mapping continues in
herdr sessions dispatched from jTicket, without you.

## 4. Reading results back later

- `curl -sk https://jmap.local/api/maps/<key>` — the map + synthesis graph
- `curl -sk https://jmap.local/api/maps/<key>/progress` — live ticket/doc state
- `curl -s http://localhost:43000/api/docs?projectId=PROJ-n` — the project's docs
- `curl -sk https://jmap.local/api/documents/<documentKey>` — a doc's blocks
- On disk: `~/code/anyway/jsuite/.data/jmap/<key>.json`

The synthesis's `nodes`/`edges`/`nodeNotes`/`commentary` are the distilled
architecture — quote from them rather than re-deriving the map by hand.
