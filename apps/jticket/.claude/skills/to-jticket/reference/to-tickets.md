# Mode: tickets

Break a plan, spec, or conversation into a set of **tickets** — tracer-bullet vertical
slices, each declaring the tickets that **block** it — and publish them to jTicket.

This mirrors the `to-tickets` skill; jTicket is the tracker, and `blockedBy` is its
native blocking relationship.

## 1. Gather context

Work from whatever is already in the conversation. If the user passes a reference — a
spec path, a `DOC-n` key, an issue number or URL — fetch it and read the full body.

```bash
curl -s "$JTICKET/api/docs/DOC-3" | jq -r .body     # a spec already in jTicket
```

## 2. Explore the codebase

If you have not already, explore to understand the current state of the code. Ticket
titles and descriptions should use the project's domain glossary vocabulary and respect
any ADRs in the area you are touching.

Look for opportunities to prefactor to make the implementation easier — "make the change
easy, then make the easy change."

## 3. Draft vertical slices

<vertical-slice-rules>

- Each slice cuts a narrow but COMPLETE path through every layer (schema, API, UI, tests)
  — vertical, NOT a horizontal slice of one layer
- A completed slice is demoable or verifiable on its own
- Each slice is sized to fit in a single fresh context window
- Any prefactoring should be done first

</vertical-slice-rules>

Give each ticket its **blocking edges** — the other tickets that must complete before it
can start. A ticket with no blockers can start immediately.

Set each ticket's **`type`**: `AFK` if an agent can pick it up cold with no human
context, `HITL` if it needs a human in the loop.

**Wide refactors are the exception to vertical slicing.** A wide refactor is one
mechanical change — rename a column, retype a shared symbol — whose **blast radius** fans
across the whole codebase, so a single edit breaks thousands of call sites at once and no
vertical slice can land green. Don't force it into a tracer bullet; sequence it as
**expand–contract**. First expand: add the new form beside the old so nothing breaks.
Then migrate the call sites in batches sized by blast radius (per package, per
directory), each batch its own ticket blocked by the expand, keeping CI green batch to
batch because the old form still exists. Finally contract: delete the old form once no
caller remains, in a ticket blocked by every migrate batch. When even the batches can't
stay green alone, keep the sequence but let them share an integration branch that all
block a final integrate-and-verify ticket — green is promised only there.

## 4. Quiz the user

Present the proposed breakdown as a numbered list. For each ticket show:

- **Title** — short descriptive name
- **Blocked by** — which other tickets (if any) must complete first
- **What it delivers** — the end-to-end behaviour this ticket makes work
- **AFK / HITL**

Ask the user:

- Does the granularity feel right? (too coarse / too fine)
- Are the blocking edges correct — does each ticket only depend on tickets that
  genuinely gate it?
- Should any tickets be merged or split further?
- Which project and epic should these land under — a new one, or an existing one?

**Iterate until the user approves the breakdown. Do not publish before that.**

Resolve the destination before publishing:

```bash
curl -s "$JTICKET/api/projects" | jq '.[] | {key, title, mode}'
curl -s "$JTICKET/api/epics"    | jq '.[] | {key, title, projectId}'
```

## 5. Publish

One `POST /api/import` for the whole breakdown. Import resolves `project`, `epic`, and
`blockedBy` by **title or key**, so no ids are needed and edges can reference tickets
declared later in the same call.

```bash
curl -s "$JTICKET/api/import" -H 'content-type: application/json' -d '{
  "projects": [{ "title": "Checkout", "description": "Everything payments-related" }],
  "epics":    [{ "title": "Checkout revamp", "description": "New payment flow",
                 "project": "Checkout" }],
  "tickets": [
    { "title": "Add cart schema", "description": "Persist a cart across sessions.",
      "type": "AFK", "epic": "Checkout revamp",
      "acceptanceCriteria": ["A cart survives a refresh", "Two tabs see one cart"] },
    { "title": "Cart UI", "description": "Edit quantities from the cart page.",
      "type": "AFK", "epic": "Checkout revamp", "blockedBy": ["Add cart schema"],
      "acceptanceCriteria": ["Quantity edits persist"] }
  ]
}'
```

**Reuse, don't duplicate.** Import always creates — it never upserts. If the project or
epic already exists, omit it from the payload and reference it **by key** from the
tickets:

```jsonc
{ "tickets": [ { "title": "…", "epic": "EPIC-2", "blockedBy": ["TICK-3"] } ] }
```

Ticket bodies follow this shape — see the `to-jspec` skill
([SKILL.md](../../to-jspec/SKILL.md)) for the markdown dialect:

<ticket-template>

**`title`** — short descriptive name.

**`description`** — the end-to-end behaviour this ticket makes work, from the user's
perspective; not layer-by-layer implementation. Reference the source spec (`DOC-n`) or
parent ticket if there is one.

**`acceptanceCriteria`** — one line each, checkable, inline markdown only.

**`blockedBy`** — the titles or keys of the tickets that gate this one; omit or `[]` for
"can start immediately".

</ticket-template>

Avoid specific file paths and code snippets — they go stale fast. Exception: if a
prototype produced a snippet that encodes a decision more precisely than prose can
(state machine, reducer, schema, type shape), inline it and note briefly that it came
from a prototype. Trim to the decision-rich parts.

Do **not** modify or close any parent ticket or doc.

## 6. Verify and report

Import drops unresolvable refs silently, so check the edges actually landed:

```bash
curl -s "$JTICKET/api/tickets?epicId=EPIC-2" \
  | jq '.[] | {key, title, type, blockedBy, blocked, frontier}'
```

Report the created keys and titles, flag anything whose `blockedBy` came back empty when
it shouldn't have, and point the user at `$JTICKET/projects/PROJ-n`.

Then work the **frontier** — any ticket with `frontier: true` — one at a time with
`/implement`, clearing context between tickets.
