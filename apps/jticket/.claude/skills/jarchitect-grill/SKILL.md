---
name: jarchitect-grill
description: Grill one architecture candidate — a per-candidate go/no-go stress test run as a terminal interview, hardening the candidate into an implementation-ready spec doc (or an ADR-recorded rejection). Use when "/jarchitect-grill <TICK-n>" is invoked (jTicket dispatches these into herdr when the human sends an arch:candidate ticket to its grilling).
disable-model-invocation: true
---

# jarchitect-grill — stress-test one deepening candidate

You were dispatched because the human picked ONE `arch:candidate` ticket of an
architect-mode jTicket project and clicked its grilling button. That click was
the triage decision — **the ticket is already `done`; leave its status
alone**. Your job is the standalone `improve-codebase-architecture` skill's
step 3: walk the decision tree of this one candidate with the human answering
**in this terminal**, and leave the ticket implementation-ready (or honestly
rejected).

Invocation: `/jarchitect-grill <TICK-n>`

## 0. Connect first — always

```bash
JTICKET="${JTICKET_URL:-http://localhost:43000}"
curl -s --max-time 3 "$JTICKET/api/projects" >/dev/null && echo up || echo down
```

If jTicket is down: say so (`./jsuite start` from the jsuite repo) and STOP.

## 1. Read the candidate cold

```bash
curl -s "$JTICKET/api/tickets/TICK-n"                          # the candidate write-up
curl -s "$JTICKET/api/projects/<PROJ-key>"                     # the project — repo, description
curl -s "$JTICKET/api/docs?projectId=<PROJ-key>&label=arch:assessment"   # → documentKey
curl -s "$JTICKET/api/documents/<documentKey>"                 # the assessment — this candidate's section + charts
```

The ticket description (Files / Problem / Solution / Benefits) plus the
assessment's section for this ticket are your whole brief — do **not** re-run
the exploration. Skim the named files in the repo (you are cd'd into it) only
to ground the questions. Read `CONTEXT.md` and the relevant ADRs; call the
Skill tool with **"codebase-design"** for the vocabulary and keep to it.

## 2. Run the interview — in this terminal

Call the Skill tool with **"grilling"** and follow it: YOU are the interviewer,
the human answers here in the herdr pane. If they want one question argued
properly — tabbed options with their own tables and charts — call the Skill
tool with **"j-grilling"** to escalate *that single question* into the
jGrilling room, key the session after the ticket (`tick-<n>-<short-slug>`), and
come back here for the next one. Never route the whole interview to the room.

This grilling is a **go/no-go stress test of this one candidate**. Walk its
decision tree — with a recommendation on every question:

- **Worth it at all?** Is the friction real and recurring, or was the scan
  pattern-matching? What recent change would have been easier?
- **Constraints** — what must not change (callers, persistence, ADRs)?
- **Blast radius** — which modules feel the refactor, what breaks meanwhile?
- **The shape of the deepened module** — what sits behind the seam, what the
  interface exposes. To explore alternatives, call the Skill tool with
  "codebase-design" and use its design-it-twice parallel sub-agent pattern.
- **What tests survive**, which die, and what becomes testable through the
  new interface?
- **Sequencing** — can it land in small safe steps?

Side effects happen inline as decisions crystallize — call the Skill tool with
**"domain-modeling"** to keep the domain model current. These DO write into
the repo (unlike the scan, this session makes decisions):

- Naming the deepened module after a concept not in `CONTEXT.md`? Add the
  term (create the file lazily). Sharpening a fuzzy term? Update it right there.
- **The human rejects the candidate for a load-bearing reason?** Offer an ADR
  in `docs/adr/` — "want me to record this so future architecture scans don't
  re-suggest it?" — only when a future scan would actually need it; skip
  ephemeral ("not right now") and self-evident reasons.

## 3. Finish and write back

When the frontier is empty, close any jGrilling room you opened (the
j-grilling skill carries the `finish` call). Then land the outcome in jTicket:

**Pursued** — publish the candidate's implementation-ready spec as a doc on
the project (the `to-jspec` skill has the field formats; `/to-spec` the
content — Problem Statement → Solution → Implementation Decisions → Testing
Decisions → Out of Scope, all reflecting the grilling's answers):

```bash
curl -s -X POST "$JTICKET/api/docs" -H 'content-type: application/json' -d @- <<'JSON'
{ "title": "TICK-n — <candidate title> — spec",
  "project": "<PROJ-key>", "labels": ["arch", "arch:spec", "TICK-n"], "status": "draft",
  "kicker": "SPEC", "blocks": [ … ] }
JSON
```

**Rejected** — no spec doc; the ADR (if recorded) and the resolution carry it.

Either way, PATCH the resolution (and only the resolution — status stays
`done`):

```bash
curl -s -X PATCH "$JTICKET/api/tickets/TICK-n" -H 'content-type: application/json' \
  -d "$(jq -n --arg r "$(cat resolution.md)" '{resolution: $r}')"
```

The resolution: verdict (pursue / reject), the load-bearing decisions, and
links — the spec doc key or ADR path, plus any jGrilling room
(`https://jgrilling.local/g/<key>`) and debrief an escalated question produced. End by telling the user where the spec doc
lives — **the workflow ends here**; whatever comes next (implementation via
`/jimplement`, a new project, nothing) is the human's move, made from that
spec.

## Never

- Never implement the refactor, cut branches, or open PRs.
- Never change the ticket's status — dispatch already finished it; a
  re-grilling arrives the same way.
- Never answer a grilling question yourself or proceed on a guessed answer —
  the human decides.
- Never auto-create follow-up tickets or projects — the spec doc is the
  hand-off, not a new pipeline.
