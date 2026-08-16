---
name: jwayfinder
description: Plan a huge chunk of work — more than one agent session can hold — as a shared map of investigation tickets in the local jTicket app, and resolve them one at a time until the way to the destination is clear.
disable-model-invocation: true
---

# jWayfinder

A loose idea has arrived — too big for one agent session, and wrapped in fog: the way
from here to the **destination** isn't visible yet. Wayfinding is about finding that way,
not charging at the destination. This skill charts the way as a **shared map** in
[jTicket](http://localhost:43000), then works its tickets one at a time until the route is
clear.

The destination varies per effort, and naming it is the first act of charting — it shapes
every ticket. It might be a spec to hand off and iterate on, a decision to lock before
planning starts, or a change made in place like a data-structure migration. The map is
domain-agnostic — engineering work, course content, whatever fits the shape.

## Connect first — always

```bash
JTICKET="${JTICKET_URL:-http://localhost:43000}"
curl -s --max-time 3 "$JTICKET/api/projects" >/dev/null && echo up || echo down
```

If it is **down**, tell the user and stop. The start command is `pnpm dev` in the jTicket
repo (`~/code/jTicket`). Full API reference: the `to-jticket` skill's
[reference/api.md](../to-jticket/reference/api.md); markdown dialect for map bodies,
questions, and answers: the `to-jspec` skill, [SKILL.md](../to-jspec/SKILL.md).

## Plan, don't do

jWayfinder is **planning** by default: each ticket resolves a decision, and the map is
done when the way is clear — nothing left to decide before someone goes and does the
thing. The pull to just do the work is usually the signal you've reached the edge of the
map and it's time to hand off. An effort can override this in its **Notes** — carrying
execution into the map itself — but absent that, produce decisions, not deliverables.

## Refer by name

Every map and ticket has a **name** — its title. In everything the human reads —
narration, the map's Decisions-so-far — refer to it by that name, never by a bare key or
id. A wall of `TICK-42, TICK-43, TICK-44` is illegible; names read at a glance. The key
and URL don't vanish — a name wraps its link — but they ride *inside* the name, never
stand in for it:

```markdown
[Choose the Rive runtime](http://localhost:43000/projects/PROJ-2) — settled on the web runtime
```

## How a map lives in jTicket

| Wayfinder concept | jTicket |
| --- | --- |
| The effort | a **project** with `"mode": "wayfinder"` |
| Map | the project's `description` **is** the map body |
| Ticket | a **ticket** whose `projectId` is that project; its `description` is the question |
| Ticket sub-type | a `wayfinder:research\|prototype\|grilling\|task` **label** |
| HITL / AFK | the ticket's **`type`** |
| Blocking | **`blockedBy`** (ticket keys) — rendered natively in the UI |
| Claim | set **`assignee`** — an assigned ticket leaves the frontier |
| Frontier | `GET /api/tickets?projectId=<project key>&frontier=true` — key-ordered |
| Close | `status: "done"` |
| Resolution comment | the ticket's **`resolution`** field — comments are for discussion, not the answer |

A wayfinder project renders its tickets grouped into **Frontier · In progress ·
Blocked · Resolved**, frontier ring-highlighted, map body one click away above them.

One project holds one map. When an effort splits into independent territories,
give each its own wayfinder project.

## The map body

The whole map at low resolution, loaded once per session, stored as the project's
`description`:

```markdown
## Destination

<what reaching the end of this map looks like — the spec, decision, or change this effort
is finding its way to. One or two lines; every session orients to it before choosing a
ticket.>

## Notes

<domain; skills every session should consult; standing preferences for this effort>

## Decisions so far

<!-- the index — one line per resolved ticket: enough to judge relevance, then open the
     ticket for the detail it holds -->

- [<resolved ticket title>](<ticket url>) — <one-line gist of the answer>

## Not yet specified

<!-- see "Fog of war": in-scope fog you can't ticket yet; graduates as the frontier advances -->

## Out of scope

<!-- see "Out of scope": work ruled beyond the destination; closed, never graduates -->
```

The map is an **index**, not a store. It lists the decisions made and points at the
tickets that hold their detail; a decision lives in exactly one place — its ticket — so
the map never restates it, only gists it and links. Open tickets are **not** listed; they
are found by query.

## Tickets

Each ticket belongs to the project. Its `description` is the question, sized to one
100K-token agent session:

```markdown
## Question

<the decision or investigation this ticket resolves>
```

Its `resolution` is empty until it resolves. Assets created while resolving are **linked**
from the resolution, not pasted into it.

A session **claims** a ticket by setting `assignee` to the dev driving the map, **first**,
before any work, so concurrent sessions skip it. That assignee *is* the claim: a `todo`,
unassigned ticket is unclaimed.

A ticket is **unblocked** when every ticket in its `blockedBy` is `done`; the **frontier**
is the `todo`, unblocked, unclaimed tickets. jTicket computes all three for you —
`blocked`, `claimed`, `frontier` come back on every GET.

## Ticket types

Every ticket is either **HITL** — human in the loop, worked *with* a human who speaks for
themselves — or **AFK**, driven by the agent alone. A HITL ticket only resolves through
that live exchange; the agent never stands in for the human's side of it (a grilling agent
that answers its own questions has broken this). This is the ticket's `type` field.

- **Research** (AFK) — `wayfinder:research`. Reading documentation, third-party APIs, or
  local resources like knowledge bases. Creates a markdown summary as a linked asset —
  in jTicket that's a **doc** (`POST /api/docs`, labelled `wayfinder:asset`), linked from
  the resolution. Use when knowledge outside the current working directory is required.
- **Prototype** (HITL) — `wayfinder:prototype`. Raise the fidelity of the discussion by
  making a cheap, rough, concrete artifact to react to — an outline, a rough take, a stub,
  or UI/logic code via the `/prototype` skill. Links the prototype as an asset. Use when
  "how should it look" or "how should it behave" is the key question.
- **Grilling** (HITL) — `wayfinder:grilling`. Conversation via the `/grilling` and
  `/domain-modeling` skills, one question at a time. The default case.
- **Task** (HITL or AFK) — `wayfinder:task`. Manual work that must happen before a
  *decision* can be made — nothing to decide, prototype, or research, but the discussion
  is blocked until it's done. Signing up for a service so its API can be judged,
  provisioning access, moving data so its shape can be seen. This is the one type that
  *does* rather than decides — and it earns its place by unblocking a decision, not by
  delivering the destination. The agent drives it alone where it can (AFK); otherwise it
  hands the human a precise checklist (HITL). Resolved when the work is done; the
  resolution records what was done and any resulting facts (credentials location, new
  URLs, row counts) later tickets depend on.

## Fog of war

The map is _deliberately_ incomplete: don't chart what you can't yet see. Beyond the live
tickets lies the **fog of war** — the dim view of decisions and investigations you can
tell are coming but can't yet pin down, because they hang on questions still open.
Resolving a ticket clears the fog ahead of it, graduating whatever's now specifiable into
fresh tickets — one at a time, until the way to the destination is clear and no tickets
remain.

The map's **Not yet specified** section is where that dim view is written down: the
suspected question, the area to revisit later. It's the undiscovered frontier _toward_ the
destination — everything here is in scope, just not sharp enough to ticket. Write as
loosely or as fully as the view allows; it doubles as a signpost for collaborators reading
where the effort is headed.

**Fog or ticket?** The test is whether you can state the question precisely now — _not_
whether you can answer it now.

- **Ticket when** the question is already sharp — even if it's blocked and you can't act
  on it yet.
- **Not yet specified when** you can't yet phrase it that sharply. Don't pre-slice the fog
  into ticket-sized pieces: it's coarser than a ticket, and one patch may graduate into
  several tickets, or none, once the frontier reaches it.

**Not yet specified** excludes what's already decided (Decisions so far), what's already a
live ticket, and what's out of scope.

## Out of scope

Fog only ever gathers _toward_ the destination. The destination fixes the scope, so work
beyond it is **out of scope** — it isn't fog, and it doesn't belong in **Not yet
specified**. It gets its own **Out of scope** section on the map: work you've consciously
ruled out of _this_ effort. Scope, not sharpness, lands it here.

Out-of-scope work never graduates — the frontier stops at the destination — so it returns
only if the destination is redrawn, and then as a fresh effort, not a resumption.

Ruling something out of scope is a scoping act, not a step on the route. When a ticket
that already exists turns out to sit past the destination — mis-scoped in while charting,
or exposed by a resolution — **close it** (`status: "done"`, so it is unambiguously off
the frontier), label it `wayfinder:out-of-scope` so it is distinguishable from a ticket
that was actually walked, and leave one line in the map's **Out of scope** section: the
gist plus why it's out of scope, linking the closed ticket. It stays out of **Decisions so
far**, which records the route actually walked — a scope boundary isn't a step on it.

## Invocation

Two modes. Either way, **never resolve more than one ticket per session.**

### Chart the map

The user invokes with a loose idea.

1. **Name the destination.** Run a `/grilling` and `/domain-modeling` session to pin down
   what this map is finding its way to — the spec, decision, or change. The destination
   fixes the scope, so it's settled first.
2. **Map the frontier.** Grill again, **breadth-first** this time: fan out across the
   whole space rather than deep on any one thread, surfacing the open decisions and the
   first steps takeable now. **If this surfaces no fog** — the way to the destination is
   already clear, the whole journey small enough for one session — you don't need a map.
   Stop and ask the user how they'd like to proceed.
3. **Create the project (its description is the map) and the tickets you can specify
   now** — one `POST /api/import`. Import resolves `project` and `blockedBy` by **title
   or key**, and wires edges in a second pass after every ticket exists, so a single
   call is enough — no create-then-wire dance.
4. Everything you can't yet specify stays in the fog — the **Not yet specified** section
   of the map body.
5. **Verify** the edges landed (import drops unresolvable refs silently), then report the
   map by name with its URL.
6. Stop — charting the map is one session's work; do not also resolve tickets.

```bash
curl -s "$JTICKET/api/import" -H 'content-type: application/json' -d '{
  "projects": [{ "title": "Rive Story Assets", "mode": "wayfinder",
                 "description": "## Destination\n\n…\n\n## Notes\n\n…\n\n## Decisions so far\n\n## Not yet specified\n\n- …\n\n## Out of scope\n\n" }],
  "tickets":  [
    { "title": "Choose the Rive runtime", "project": "Rive Story Assets", "type": "AFK",
      "wayfinderType": "research",
      "description": "## Question\n\nWhich Rive runtime fits a Nuxt app — web, or the canvas build?" },
    { "title": "Decide the asset hand-off format", "project": "Rive Story Assets", "type": "HITL",
      "wayfinderType": "grilling", "blockedBy": ["Choose the Rive runtime"],
      "description": "## Question\n\nWhat does a designer hand over, and where does it live?" }
  ]
}'
```

```bash
# verify: every ticket, its edges, and what the frontier actually is
curl -s "$JTICKET/api/tickets?projectId=PROJ-3" \
  | jq '.[] | {key, title, type, labels, blockedBy, blocked, frontier}'
```

Use `jq -n --arg body "$(cat map.md)"` to build the payload when the map body is long —
hand-escaping `\n` into a shell string will mangle it.

### Work through the map

The user invokes with a map (a project key, or a name). A ticket is **optional** —
without one, you pick the next decision, not the user.

1. **Load the map** — the low-res view, not every ticket body:

   ```bash
   curl -s "$JTICKET/api/projects" | jq '.[] | select(.mode == "wayfinder")'
   curl -s "$JTICKET/api/projects/PROJ-3" | jq -r .description
   ```

2. **Choose the ticket.** If the user named one, use it. Otherwise take the first frontier
   ticket in key order:

   ```bash
   curl -s "$JTICKET/api/tickets?projectId=PROJ-3&frontier=true" | jq '.[0]'
   ```

   **Claim it before any work** — assignee first, then read the question:

   ```bash
   curl -s -X PATCH "$JTICKET/api/tickets/TICK-7" -H 'content-type: application/json' \
     -d '{ "assignee": "claude", "status": "in_progress" }'
   ```

3. **Resolve it — zoom as needed.** Fetch the full body of any related or resolved ticket
   on demand (`GET /api/tickets/TICK-n` → `.description`, `.resolution`); invoke the
   skills the map's `## Notes` names. If in doubt, use `/grilling` and `/domain-modeling`.
   Respect the ticket's type: a HITL ticket resolves only through live exchange with the
   human — never answer their side of it.

4. **Record the resolution** — the answer into `resolution`, close the ticket, then append
   a one-line gist to the map's **Decisions so far**:

   ```bash
   curl -s -X PATCH "$JTICKET/api/tickets/TICK-7" -H 'content-type: application/json' \
     -d "$(jq -n --arg r "$(cat answer.md)" '{status:"done", resolution:$r}')"
   ```

   The map body is a whole-field replace: GET the project's `description`, insert the
   line under **Decisions so far**, PATCH the complete body back. Never PATCH a fragment.

5. **Advance the frontier.** Add newly-surfaced tickets (one import call, edges and all);
   graduate any fog the answer has made specifiable, **clearing each graduated patch from
   Not yet specified** so it lives only as its new ticket. If the answer reveals a ticket —
   this one or another — sits beyond the destination, **rule it out of scope** rather than
   resolving it on the route. If the decision invalidates other parts of the map, update
   or delete those tickets.

The user may run unblocked tickets in parallel, so expect other sessions to be editing
jTicket concurrently. Before writing the map body, re-read it — another session may have
appended a decision since you loaded it.

## Gotchas

- Outside `POST /api/import`, refs resolve by **id or key only** — a title in `blockedBy`
  or `projectId` on `POST`/`PATCH /api/tickets` is silently dropped. Use keys.
- Import **always creates, never upserts**. To add tickets to an existing map, send only
  `tickets` and reference the project by key. Passing the project again duplicates it.
- `wayfinderType` shorthand only exists on import. Elsewhere set the
  `wayfinder:<type>` label explicitly in `labels`.
- Every array field — `blockedBy`, `labels`, `acceptanceCriteria` — is **replaced
  wholesale** by PATCH. Read, append, write back.
- `blocked` / `claimed` / `frontier` are derived on read; writing them does nothing.
- `completedAt` is stamped by the server when a ticket moves to `done` (and cleared when it
  moves out) — writing it does nothing. `?finished=true` lists resolved tickets
  newest-first, which is how you recap what a map has landed.
- The answer goes in `resolution`; longer assets become docs. Ticket **comments**
  (`POST /api/tickets/:id/comments`) are for discussion only — human direction left
  before handoff (read them before working a ticket) and your own questions or progress
  notes, never the resolution itself.
- Deletes are immediate and unrecoverable — the store is one JSON file. Delete a ticket
  only when the user asks for that ticket by key.
