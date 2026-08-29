---
name: j-grilling
description: Escalate ONE grilling question into the jGrilling browser room — three phases (the question, why it needs answering, the options as tabbed cases) — then monitor .data/jgrilling for the answer and return to the terminal. Use ONLY when the operator explicitly asks for it ("take that one to jgrilling", "grill me in the browser"). Never for a whole interview — grillings run in the terminal, HITL jTickets included.
---

# j-grilling — the browser room, one question at a time

jGrilling (`https://jgrilling.local`, API on `:43005`) is a **passive question
room**: it renders whatever session state exists in `.data/jgrilling/` and
records the user's answers. It has no interviewer of its own — **you own the
interview**, all of it, through the HTTP API.

## This is not the default. Never reach for it on your own.

A jGrilling question is expensive: three markdown phases, one block-document
case per option, tables and charts materialised into the shared pools. That
cost is worth paying for a **single decision the operator wants to go deep
on** — not for a whole interview.

**Every grilling runs in the terminal**, under the plain `grilling` skill:
rounds of questions, answers typed back to you. Read that skill; it owns the
interview algorithm (design tree, frontier, facts are your job, decisions are
the user's). This skill only covers what happens when **one** question leaves
the terminal.

**There is exactly one way in: the operator asks.** Mid-grilling they point at
a question and want the browser — *"take that one to jgrilling"*, *"jgrill
this"*, *"give me the tabbed version"*. You escalate **that one question**,
wait for the answer, and come back to the terminal.

That holds for a herdr-dispatched HITL jTicket too — a `wayfinder:grilling`
ticket, a todo grilling, `/jarchitect-grill`. Those grill **in the herdr pane**;
the human comes to the terminal to answer, and escalates a question here only
when they want it argued properly. A dispatched ticket is not a licence to run
the whole interview in the room.

If the operator hasn't asked, ask in the terminal. Don't offer the room, don't
open one speculatively, don't "upgrade" a question because it looks meaty.

## 1. Ensure a room — once per grilling

Open the room lazily, on the **first** escalation, and reuse its key for every
later one in the same grilling. Prior escalated turns collapse to question +
answer, so the room always shows exactly one open question — the single-question
view the operator asked for.

```sh
curl -sk -X POST https://jgrilling.local/api/sessions \
  -H 'content-type: application/json' \
  -d '{
    "title": "Short plan title",
    "plan": "…the plan under interrogation + what the terminal grilling has already settled, markdown…",
    "repoPath": "/absolute/path/to/repo",
    "key": "optional-slug"
  }'
# -> { "key": "short-plan-title", "path": "/g/short-plan-title" }

open "https://jgrilling.local/g/<key>"
```

`plan` is the operator's context for a question they're about to answer out of
band — include the decisions already made in the terminal, so the escalated
question stands on its own. Working a jTicket, key the session after the ticket
(`tick-7-cache-policy`) and mention the ticket in `plan`. If the POST fails the
app probably isn't running:
`cd ~/code/anyway/jsuite && ./jsuite status` then `./jsuite start`.

## 2. Post the question — three phases

Every question lands in the room in three phases, and the API takes one field
per phase:

1. **`question`** — the question itself, markdown. Lead with an `##` heading
   that *is* the question; a short paragraph under it says what's undecided.
2. **`why`** — why it needs answering *now*, markdown. What downstream
   decisions hang off it, what breaks if it's left implicit. This is the phase
   that earns the interruption — don't skip it.
3. **`options`** — the candidate answers, rendered as tabs. Each option argues
   its **own case** in jspec blocks: why you'd pick it, what it costs, the
   table/code/chart the argument rests on. Exactly one carries
   `recommended: true`.

`blocks` (optional) is shared context between phase 1 and phase 2 — the table,
diff or chart the *whole* question rests on, in the jspec/block vocabulary from
the `j-explain` skill (prose, callout, compare, code, diff, steps,
chart-with-`mermaid`, …). Facts that only matter to one option belong in that
option's blocks, not here.

```sh
curl -sk -X POST https://jgrilling.local/api/sessions/<key>/questions \
  -H 'content-type: application/json' -d @- <<'JSON'
{
  "topic": "cache invalidation",
  "question": "## How should the cache invalidate?\n\nThe plan says \"cache the lookups\" but never says how an entry dies.",
  "why": "Three later decisions hang off this one: whether the write path needs a publisher, whether the read path can be pure, and whether staleness is something the UI has to explain.",
  "blocks": [
    { "id": "ctx", "type": "compare", "title": "What the read path looks like today",
      "columns": ["Caller", "Reads", "Tolerance"],
      "rows": [["`useSeason()`", "season row", "seconds"], ["`useBadges()`", "badge grid", "**none**"]] }
  ],
  "options": [
    {
      "label": "TTL of 60s",
      "summary": "Entries expire on a clock. No invalidation machinery at all.",
      "recommended": true,
      "answer": "TTL of 60s — the data tolerates a minute of staleness and the write path stays free of cache knowledge.",
      "blocks": [
        { "id": "case", "type": "prose", "md": "One line in `cached()`, no new infrastructure…" },
        { "id": "cost", "type": "callout", "tone": "warning", "title": "What it costs", "md": "A user sees their own edit up to 60s late…" }
      ]
    },
    {
      "label": "Event bus",
      "summary": "Writers publish; the cache subscribes and evicts exactly.",
      "answer": "Event bus — exact invalidation, at the cost of new infrastructure.",
      "md": "Zero staleness, and the invalidation reads as documentation of what depends on what — but every write path has to remember to publish."
    }
  ]
}
JSON
```

Per option: `label` (the tab, a few words), `summary` (one line under the
label), `blocks` — or `md` as the shorthand for a prose-only case — and
`answer`, the text recorded when the user takes that tab. Write `answer` as the
decision in the user's voice, not the label alone.

`recommendation` (markdown) is optional when an option is `recommended` — it
defaults to that option's `answer` — and required when the question has no
options. If a question is worth escalating it almost always has candidates:
the tabbed cases are the entire reason this room beats the terminal. A
genuinely open "what should this be?" can ship phases 1–2 plus a
`recommendation`, but ask yourself first why it's in the browser at all.

One open question at a time — the API 409s if the last one is unanswered.

## 3. Monitor for the answer

The user answers in the browser; the answer lands in the session file. **Set
up a monitor on `.data/jgrilling/<key>.json` and block until the open turn is
answered** — run this in the background (`run_in_background`) so you're
re-invoked the moment it exits, or foreground with a generous timeout and
re-run on expiry (humans take their time):

```sh
SESSION=~/code/anyway/jsuite/.data/jgrilling/<key>.json
until jq -e '.turns[-1].answer != null' "$SESSION" >/dev/null 2>&1; do sleep 3; done
jq -r '.turns[-1] | "\(.id) · \(.topic)\n\(.answeredOptionId // "own words")\n\(.answer)"' "$SESSION"
```

`answeredOptionId` is set when the user took one of your option tabs — it tells
you which case they bought, not just the words they sent.

Never write the `answer` field yourself and never proceed on a guessed answer —
the whole point is that the human decides.

## 4. Go back to the terminal

Once the answer lands: **read it back in the terminal**, fold it into the
design tree, and **carry on grilling there**. The escalation is over. Don't
post the next question to the room — the operator has to ask for the browser
again, question by question. There is no mode in which the room takes over the
interview.

## 5. Finish

Close the room when the terminal grilling ends. A `verdict` is enough for a
handful of escalated turns; if the grilling was substantial, publish a debrief
as a shared block document first — decision table (`compare`), risk
`callout`s, a `takeaway`, and a mermaid `chart` of the decision tree:

```sh
curl -sk -X POST https://jgrilling.local/api/documents \
  -H 'content-type: application/json' -d @debrief.json
# -> { "key": "<documentKey>", … }

curl -sk -X POST https://jgrilling.local/api/sessions/<key>/finish \
  -H 'content-type: application/json' \
  -d '{ "verdict": "…closing statement, markdown…", "documentKey": "<documentKey>" }'
```

The room shows the verdict and links the debrief at `/e/<documentKey>`.

Writing the outcome back to jTicket is the **dispatched skill's** job, not
this one's — `/jwayfinder`, `/jimplement` and `/jarchitect-grill` each own
their ticket's resolution. Hand them the room URL
(`https://jgrilling.local/g/<key>`) and the debrief key to link.

## Read a finished session back

```sh
curl -sk https://jgrilling.local/api/sessions/<key>          # turns, verdict, documentKey
curl -sk https://jgrilling.local/api/documents/<documentKey> # the debrief
```

Sessions are also readable on disk at `~/code/anyway/jsuite/.data/jgrilling/<key>.json`.
Treat the answers and debrief as the user's decisions: enact the plan against
them, don't re-litigate settled questions.
