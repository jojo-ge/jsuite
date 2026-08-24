---
name: jarchitect-scan
description: Run an architect scan ticket — explore the codebase for deepening opportunities, publish the assessment as a spec doc on the jTicket project, and create one HITL arch:candidate ticket per opportunity with strength tags. Use when "/jarchitect-scan <TICK-n>" is invoked (jTicket dispatches these into herdr on architect-mode projects).
disable-model-invocation: true
---

# jarchitect-scan — surface deepening opportunities as a jTicket board

You were dispatched to run the SCAN ticket of an architect-mode jTicket
project. Your output is an assessment spec doc plus one ticket per **deepening
opportunity** — refactors that turn shallow modules into deep ones, aimed at
testability and AI-navigability. The human triages the board afterwards; a
candidate's grilling runs later, as its own `/jarchitect-grill` session.

**You never enter the grilling loop and never propose interfaces.** This is
the standalone `improve-codebase-architecture` skill's steps 1–2 with jTicket
as the report — its step 3 belongs to `/jarchitect-grill`, one candidate at a
time, on the human's click.

Invocation: `/jarchitect-scan <TICK-n>`

## 0. Connect first — always

```bash
JTICKET="${JTICKET_URL:-http://localhost:43000}"
curl -s --max-time 3 "$JTICKET/api/projects" >/dev/null && echo up || echo down
```

If down: tell the user jTicket isn't running (`./jsuite start` from the jsuite
repo) and STOP. Never fall back to writing an HTML report or files.

## 1. Read your ticket, claim it

```bash
curl -s "$JTICKET/api/tickets/TICK-n"          # description carries the repo + any direction
curl -s "$JTICKET/api/projects/<PROJ-key>"     # the project — its `repo` is the codebase
curl -s -X PATCH "$JTICKET/api/tickets/TICK-n" -H 'content-type: application/json' \
  -d '{"assignee": "claude", "status": "in_progress"}'
```

You are already cd'd into the repo (herdr set the cwd to the project's repo).

## 2. Load the vocabulary

Call the Skill tool with **"codebase-design"** for the architecture vocabulary
(**module**, **interface**, **depth**, **seam**, **adapter**, **leverage**,
**locality**) and its principles (the deletion test, "the interface is the
test surface", "one adapter = hypothetical seam, two = real"). Use these terms
exactly in every ticket and every doc block — never "component", "service",
"API", or "boundary".

Read the repo's domain glossary (`CONTEXT.md`) and any ADRs in `docs/adr/`
before exploring: the domain language names good seams, and ADRs record
decisions this scan must not re-litigate.

## 3. Scope before you scan — YAGNI

Deepening a module pays off by making future changes easier, so weight the
parts of the codebase that keep changing:

- If the ticket description names a direction (a module, a subsystem, a pain
  point), take it and skip the inference below.
- Otherwise walk back a good stretch of `git log --oneline` for the hot spots
  — the files and areas that keep coming up — and let those pull your
  attention first. Scattered changes with no hot spot ⇒ widen the net.

## 4. Explore

Use the Agent tool (`subagent_type=Explore`) to walk the scoped area. Don't
follow rigid heuristics; explore organically and note where you experience
friction:

- Where does understanding one concept require bouncing between many small modules?
- Where are modules **shallow**, with an interface nearly as complex as the implementation?
- Where have pure functions been extracted just for testability, but the real bugs hide in how they're called (no **locality**)?
- Where do tightly-coupled modules leak across their seams?
- Which parts are untested, or hard to test through their current interface?

Apply the **deletion test** to anything you suspect is shallow: would deleting
it concentrate complexity, or just move it? "Yes, concentrates" is the signal
you want. Expect **3–8 candidates**; fewer honest ones beat a padded list.

## 5. Create one HITL ticket per candidate

Each candidate ticket is the improvement work item itself, and its description
must be rich enough that a later grilling session can pick it up **cold** — no
re-exploration:

```bash
curl -s -X POST "$JTICKET/api/tickets" -H 'content-type: application/json' -d @- <<'JSON'
{ "title": "Deepen <module>: <one-line solution>",
  "projectId": "<PROJ-key>", "type": "HITL",
  "labels": ["arch", "arch:candidate", "arch:strong"],
  "description": "**Files**: `path/one`, `path/two`\n\n**Problem**: why the current shape causes friction — name the shallow module, the leaking seam.\n\n**Solution**: plain English, what would change. No interface design — that is the grilling's job.\n\n**Benefits**: in terms of locality and leverage, and how tests improve (what becomes testable through the interface).",
  "acceptanceCriteria": [
    "Grilled via /jarchitect-grill — decisions recorded in the resolution",
    "If pursued: an implementation-ready spec doc is published on the project"
  ] }
JSON
```

Rules:

- **Strength labels** — every candidate carries exactly one of `arch:strong`,
  `arch:worth-exploring`, `arch:speculative` (the board renders them as
  badges). Grade honestly; a scan of all-strong candidates has graded nothing.
- **Exactly one candidate** also gets `arch:top-pick` — the one you'd tackle
  first.
- **ADR conflicts**: if a candidate contradicts an existing ADR, only surface
  it when the friction is real enough to warrant revisiting the ADR, and say
  so in the description ("contradicts ADR-0007, but worth reopening because…").
  Don't list every theoretical refactor an ADR forbids.
- Use `CONTEXT.md` vocabulary for the domain: "the Order intake module", not
  "the FooBarHandler".
- No `blockedBy` between candidates — they are independent triage items.

## 6. Publish the assessment spec

One block document on the project — the report the HTML page used to be. Read
the **`to-jspec`** skill for field formats and the **`j-explain`** skill's
block vocabulary. Shape:

```bash
curl -s -X POST "$JTICKET/api/docs" -H 'content-type: application/json' -d @- <<'JSON'
{ "title": "<project title> — architecture assessment",
  "project": "<PROJ-key>", "labels": ["arch", "arch:assessment"], "status": "ready",
  "kicker": "ARCHITECTURE ASSESSMENT", "subtitle": "Deepening opportunities and how they rank",
  "blocks": [
    { "id": "state", "type": "prose", "md": "## Current state\n\nWhat the codebase is, where the hot spots are, what the scan covered…" },
    { "id": "ranking", "type": "compare", "title": "The candidates", "columns": ["Ticket", "Candidate", "Strength"],
      "rows": [["TICK-12", "Deepen the store module", "Strong ★ top pick"]] },
    { "id": "c1", "type": "prose", "md": "## TICK-12 — Deepen the store module\n\nProblem… Solution… Benefits…" },
    { "id": "c1-before", "type": "chart", "title": "TICK-12 — Before", "chartKey": "arch-tick-12-before", "mermaid": "flowchart TD\n  …" },
    { "id": "c1-after", "type": "chart", "title": "TICK-12 — After", "chartKey": "arch-tick-12-after", "mermaid": "flowchart TD\n  …" },
    { "id": "top", "type": "takeaway", "points": ["Top recommendation: TICK-12, because…"] }
  ] }
JSON
```

- **Every candidate gets a before/after pair**: two `chart` blocks with
  explicit stable `chartKey`s (`arch-tick-<n>-before` / `arch-tick-<n>-after`,
  lowercase). The mermaid materialises into real jChart charts the human can
  edit and annotate — draw the shallowness in Before and the deepened module
  in After. Re-publishing with identical mermaid never clobbers hand edits.
- One prose section per candidate, named by its ticket key, mirroring the
  ticket description (the doc is the readable whole; the tickets are the
  actionable parts).
- End with the **Top recommendation** takeaway — which candidate first and why.

## 7. Resolve your ticket

```bash
curl -s -X PATCH "$JTICKET/api/tickets/TICK-n" -H 'content-type: application/json' \
  -d "$(jq -n --arg r "$(cat resolution.md)" '{status: "done", resolution: $r, assignee: "claude"}')"
```

The resolution: the candidate list (key — title — strength, top pick marked),
the assessment doc key, and anything a grilling session should collectively
know. Then tell the user: the board is populated — grill a candidate with its
herdr button when one looks worth pursuing.

## Never

- Never enter the grilling loop, propose interfaces, or design the deepened
  module — that is `/jarchitect-grill`, per candidate, on the human's click.
- Never cut branches, open PRs, or modify the repo — the scan is read-only
  (even `CONTEXT.md`/ADR edits belong to the grilling, where decisions are
  actually made).
- Never write an HTML report or any file as a fallback — jTicket down means stop.
- Never end without resolving the ticket (or, if truly blocked, PATCH a
  comment-style resolution explaining why and leave status in_progress).
