---
name: j-grilling
description: Grill the user about a plan through the jGrilling browser UI — YOU are the interviewer. Run the grilling design-tree loop, post each question to jGrilling as jspec blocks, and monitor the session file in .data/jgrilling for the answer before asking the next. Use when the user wants to be grilled "in the browser" / "in jgrilling", or when a HITL jTicket ticket needs its human-in-the-loop questions asked.
---

# j-grilling — you interview, the browser answers

jGrilling (`https://jgrilling.local`, API on `:43005`) is a **passive question
room**: it renders whatever session state exists in `.data/jgrilling/` and
records the user's answers. It has no interviewer of its own — **you own the
whole interview**: what to ask, when it's done, and every bit of session state,
all driven through the HTTP API. This is how the human side of a **HITL
jTicket** runs when you're working in herdr, and how any "grill me in the
browser" request runs.

For an in-terminal grilling (answers typed to you), use the plain `grilling`
skill instead.

## The interview algorithm

This skill wraps the `grilling` skill's doctrine — read it if you haven't:
map the plan as a **design tree**, keep a **frontier** of askable decisions,
and put exactly **one question at a time** to the user — the most important
unresolved decision — always with your recommended answer. **Facts are your
job** (look them up in the repo / with sub-agents); only **decisions** go to
the user. Done means the frontier is empty: nothing left silently assumed.

## 1. Open the room

```sh
curl -sk -X POST https://jgrilling.local/api/sessions \
  -H 'content-type: application/json' \
  -d '{
    "title": "Short plan title",
    "plan": "…the plan/context under interrogation, markdown…",
    "repoPath": "/absolute/path/to/repo",
    "key": "optional-slug"
  }'
# -> { "key": "short-plan-title", "path": "/g/short-plan-title" }

open "https://jgrilling.local/g/<key>"
```

`plan` is shown to the user for context — include enough that the questions
make sense on their own. For a HITL ticket, key the session after the ticket
(`tick-7-cache-policy`) and put the ticket description + relevant context in
`plan`. If the POST fails the app probably isn't running:
`cd ~/code/anyway/jsuite && ./jsuite status` then `./jsuite start`.

## 2. Post a question

The question body is **jspec-format blocks** — the shared block-document
vocabulary from the `j-explain` skill (prose, callout, compare, code, diff,
steps, chart-with-`mermaid`, …). Lead with a short prose block that states the
question; use `compare` for options, `callout` for stakes, `code`/`diff` for a
shape the decision hinges on. One decision per question.

```sh
curl -sk -X POST https://jgrilling.local/api/sessions/<key>/questions \
  -H 'content-type: application/json' -d @- <<'JSON'
{
  "topic": "cache invalidation",
  "why": "Everything downstream of the read path depends on this.",
  "recommendation": "TTL of 60s — the data tolerates a minute of staleness and it avoids the bus entirely.",
  "blocks": [
    { "id": "q", "type": "prose", "md": "## How should the cache invalidate?\n\nThe plan says \"cache the lookups\" but not how entries die…" },
    { "id": "opts", "type": "compare", "title": "Options", "columns": ["Approach", "Cost", "Staleness"],
      "rows": [["TTL", "none", "bounded"], ["Event bus", "new infra", "none"]] }
  ]
}
JSON
```

One open question at a time — the API 409s if the last one is unanswered.
`recommendation` (markdown) is required: always recommend an answer.

## 3. Monitor for the answer

The user answers in the browser; the answer lands in the session file. **Set
up a monitor on `.data/jgrilling/<key>.json` and block until the open turn is
answered** — run this in the background (`run_in_background`) so you're
re-invoked the moment it exits, or foreground with a generous timeout and
re-run on expiry (humans take their time):

```sh
SESSION=~/code/anyway/jsuite/.data/jgrilling/<key>.json
until jq -e '.turns[-1].answer != null' "$SESSION" >/dev/null 2>&1; do sleep 3; done
jq -r '.turns[-1] | "\(.id) · \(.topic)\n\(.answer)"' "$SESSION"
```

Never write the `answer` field yourself and never proceed on a guessed answer
— the whole point is that the human decides. Read the answer, update your
design tree, and loop back to step 2 with the next frontier question.

## 4. Finish

When the frontier is empty, publish the debrief as a shared block document —
decision table (`compare`), risk `callout`s, a `takeaway`, and a mermaid
`chart` of the decision tree — then close the session:

```sh
curl -sk -X POST https://jgrilling.local/api/documents \
  -H 'content-type: application/json' -d @debrief.json
# -> { "key": "<documentKey>", … }

curl -sk -X POST https://jgrilling.local/api/sessions/<key>/finish \
  -H 'content-type: application/json' \
  -d '{ "verdict": "…closing statement, markdown…", "documentKey": "<documentKey>" }'
```

The room shows the verdict and links the debrief at `/e/<documentKey>`.

For a HITL ticket, also write the outcome back to jTicket: the decisions into
the ticket's `resolution` (or a comment if the ticket isn't done), linking the
session (`https://jgrilling.local/g/<key>`) and the debrief.

## Read a finished session back

```sh
curl -sk https://jgrilling.local/api/sessions/<key>          # turns, verdict, documentKey
curl -sk https://jgrilling.local/api/documents/<documentKey> # the debrief
```

Sessions are also readable on disk at `~/code/anyway/jsuite/.data/jgrilling/<key>.json`.
Treat the answers and debrief as the user's decisions: enact the plan against
them, don't re-litigate settled questions.
