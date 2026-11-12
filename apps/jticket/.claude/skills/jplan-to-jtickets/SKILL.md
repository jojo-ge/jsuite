---
name: jplan-to-jtickets
description: Turn a resolved jTicket plan project into a ticket plan — write the spec as a doc on the plan, draft the build tickets on it (each planned for a proposed build), and propose the graph's shape (builds sized as reviewable slices, a review after each, a plan review first when the plan is large or risky); then report back. Proposes only. Invoked as "/jplan-to-jtickets [PROJ-n]" by a plan project's Ticket plan button. Not for general use.
disable-model-invocation: true
argument-hint: "[PROJ-n]"
---

# jPlan → jTickets — draft the ticket plan

A plan project's Ticket plan button handed you a **plan** whose map has been
walked: its decisions are in its tickets' resolutions. You turn it into a
**ticket plan**: the spec, the build tickets, and the builds they go into.

The goal that decides every choice: **reasonably reviewable slices.** Each
build is one project whose work lands as one roll-up PR, and a person must be
able to review that PR in **one sitting**. Cut the work into as many builds as
that takes, never fewer to save steps.

You **propose**; the human disposes. Everything you write is a draft: draft
tickets on the plan (off every board, never dispatched) and **proposed**
nodes in the plan's graph (no projects yet). The human edits them in the
Ticket plan tab and presses Approve. Nobody is watching your pane: decide
rather than ask. You are done when the ticket plan's warnings are only the
ones you chose (§6) and you have reported back (§7).

```bash
P=PROJ-3   # the plan project key you were invoked with
```

Every jTicket call goes through `jt` (`jt help`), never hand-built `curl`.
Field formats (descriptions, notes, doc blocks): the `to-jdoc` skill.

## 1. Read the plan and the code

```bash
jt project $P | jq -r .description                                   # the map: Destination, Notes, Decisions so far, Out of scope
jt ls projectId=$P --json | jq '[.[] | {key, title, type, labels, status, description, resolution}]'
jt get "/api/docs?projectId=$P" | jq '[.[] | {key, title, documentKey, labels}]'   # read content: jt get /api/documents/<documentKey>
jt get /api/projects/$P/ticket-plan                                  # what an earlier run already drafted
```

A plan ticket still open is a decision not yet made: build around it only if
it doesn't change the shape; otherwise leave the affected work out and say so
in §7. You are cd'd into the repo: find the code each decision touches, what
already exists, and how large each change really is.

Done when you can name every change the destination needs, the area of code
each lands in, and its rough size in changed lines.

## 2. Write the spec

One doc on the plan, labelled `spec`, following `to-jdoc` (status `draft`).
It states what will be built and why, from the plan's decisions; it links the
deciding tickets rather than restating them. If a `spec` doc is already on
the plan, revise that one (`to-jdoc` → Revise) instead of adding another.

## 3. Cut the builds

A build is a **slice**: one coherent, self-contained change a reviewer can
hold in their head, verifiable on its own. Size it by its diff:

| Diff | Verdict |
| --- | --- |
| up to ~400 changed lines, ~15 files | a good slice |
| ~400–800 lines | acceptable when it is one idea; say why in the note |
| over ~800 lines or ~30 files | too large — the review briefing flags it; split it |

- **Split a large build** along seams the code already has (a prefactor
  first, then the feature; the data layer, then the screens that use it;
  one module at a time for a wide refactor, expand → migrate → contract).
- **Stack** a build on another when it needs that build's code before it is
  merged. The human chooses the base at Move on, so write the upstream it
  expects to stack on in its note. Builds that don't need each other's code
  come off the plan side by side.
- **Review after every build** — a Review node right after it — unless the
  build is trivial (a doc, config, a handful of lines); then say in its note
  why it goes unreviewed. When in doubt, review.
- **Plan review first** when the plan is large (roughly four builds or more)
  or risky (a migration, a security boundary, a public contract, a decision
  that was close): a `planreview` node between the plan and the first builds.

Every node's `note` is what the human reads beside the drafts. For a build:

```markdown
**Slice:** <what this build delivers, one or two lines>
**Size:** ~<n> changed lines across ~<m> files (<the areas>)
**Stacks on:** <upstream build's title> | the default branch
**Why its own build:** <the seam it cuts along>
```

For a review: what to look hardest at. For a plan review: why the plan
warrants one.

## 4. Propose the shape

The plan's graph, get-or-create (the button already made it; this is
idempotent):

```bash
read G PLAN < <(jt post /api/projects/$P/ticket-plan/graph | jq -r '"\(.graph.key) \(.planNodeId)"')
```

Add each node with its incoming edges (`after`: node ids). Capture each id,
and stop if one comes back empty or `null` — a failed add leaves the nodes
after it with an edge to nothing, which is dropped silently:

```bash
add() { local id; id=$(jt post /api/graphs/$G/nodes "$1" | jq -r '.node.id // empty'); [ -n "$id" ] || { echo "add failed: $1" >&2; return 1; }; echo "$id"; }
PR=$(add "$(jq -n --arg note "$PR_NOTE" --arg plan "$PLAN" '{mode:"planreview", title:"Plan review", note:$note, after:[$plan]}')")
B1=$(add "$(jq -n --arg note "$B1_NOTE" --arg up "$PR" '{mode:"standard", title:"Cart schema and API", note:$note, after:[$up]}')")
R1=$(add "$(jq -n --arg b "$B1" '{mode:"prreview", title:"Review: Cart schema and API", note:"…", after:[$b]}')")
B2=$(add "$(jq -n --arg note "$B2_NOTE" --arg b "$B1" --arg r "$R1" '{mode:"standard", title:"Cart UI", note:$note, after:[$b, $r]}')")
```

Edges carry work from one node to the next and decide what each briefing
shows:

- first builds come after the plan (or after the plan review);
- a review comes after its build;
- a stacked build comes after the build it stacks on (stacking needs that
  direct edge) **and** after that build's review, so its briefing shows the
  verdict.

Leave `stackOn` unset: it is the human's choice at Move on. Title a plan
review node `Plan review` — its project is then named after the plan.
Write each note line by line as in §3 (one `**Label:**` per line); the
Ticket plan tab keeps the line breaks.

## 5. Draft the tickets

One `POST /api/import` on the plan project, every ticket carrying
`plannedFor` = the id of the build it goes into. Follow `to-jticket`'s
[reference/to-tickets.md](../to-jticket/reference/to-tickets.md) for the
slicing and the ticket body (§3 vertical slices, §5 template); skip its quiz
step — the Ticket plan tab is where the human answers. Every draft is work an
agent or the human does in its build: `type` explicit (`story`, `task`, `bug`,
`docs`, …), exactly one of `afk`/`hitl`, a description that cites the spec's
`DOC-n`, checkable `acceptanceCriteria`.

```jsonc
{ "tickets": [
  { "title": "Persist the cart", "project": "PROJ-3", "plannedFor": "<B1>",
    "type": "story", "labels": ["afk"], "description": "…DOC-12…", "acceptanceCriteria": ["…"] },
  { "title": "Edit quantities", "project": "PROJ-3", "plannedFor": "<B2>",
    "type": "story", "labels": ["afk"], "blockedBy": ["Persist the cart"], "acceptanceCriteria": ["…"] }
] }
```

Give every draft a title unique within the import: `blockedBy` names a
draft by its title (or a ticket by its key), and a title matches this
import's tickets before any older ticket with the same title. `blockedBy`
may name drafts of the same build, drafts of a build **upstream**
of this one, or resolved plan tickets; a blocker in a build that isn't
upstream would leave two builds waiting on each other. An import with a bad
`plannedFor` fails whole (400) and creates nothing.

## 6. Check it

```bash
jt get /api/projects/$P/ticket-plan | jq '{builds: [.builds[] | {title, drafts: (.drafts | length), after, reviews}], unplaced: (.unplaced | length), problems}'
```

`problems` are warnings for the human, never refusals. Fix each `warning`
(a proposed build with no drafts, a draft whose build is gone, a blocker in a
build that isn't upstream); an `info` may stand when you meant it (a trivial
build with no review). Done when every build has drafts and every warning
left is one you intend.

**Revising an earlier ticket plan** (§1 found one): change it in place.
`jt set TICK-n plannedFor=<node>` moves a draft, `jt patch` edits it,
`jt delete /api/tickets/TICK-n` drops one; a node's title or note, or an
edge, is a whole-shape `PUT /api/graphs/$G` — GET the graph, change it, send
every node and edge back:

```bash
jt get /api/graphs/$G | jq '{nodes: [.nodes[] | {id, mode, projectId, title, note, stackOn}], edges}' > shape.json
# edit shape.json, then:
jt put /api/graphs/$G @shape.json | jq .problems
```

## 7. Report back — last

```bash
jt post /api/projects/$P/ticket-plan/built '{"summary": "<one line: N builds (sizes), M reviews, plan review or not, anything left out>"}'
```

This unlocks the tab. Then reply with a few lines — each build with its
slice and size, what stacks on what, where the reviews sit and why — and
stop. The build projects, Approve and every Move on are the human's.
