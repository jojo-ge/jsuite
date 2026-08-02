---
name: j-grilling
description: Send a plan to jGrilling — the local app where Claude (the app's own headless claude) grills the user about it one question at a time in a browser UI, ending in a shared debrief document. Use when the user wants to be grilled "in the browser" / "in jgrilling", or wants a grilling session they can answer in a UI instead of the terminal.
---

# j-grilling — browser grilling sessions

jGrilling (`https://jgrilling.local`, API on `:43005`) runs the *grilling*
interview — relentless one-question-at-a-time interrogation of a plan, each
question with a recommended answer — but **the app's server plays the
interviewer** (it drives the local `claude` CLI itself via `@jsuite/claude`).
Your job is only to hand the plan over and point the user at the room.

Use this skill when the user wants a browser grilling. For an in-terminal
grilling (answers typed to you), use the plain `grilling` skill instead.

## Start a session

POST the plan. Include the repo path when the plan concerns a codebase — the
interviewer then looks *facts* up itself and only asks the user for *decisions*.

```sh
curl -sk -X POST https://jgrilling.local/api/sessions \
  -H 'content-type: application/json' \
  -d '{
    "title": "Short plan title",
    "plan": "…the full plan, markdown…",
    "repoPath": "/absolute/path/to/repo"
  }'
# -> { "key": "short-plan-title", "title": "…", "path": "/g/short-plan-title" }
```

Write the plan field from the current conversation: everything the interviewer
needs to grill well (goals, constraints, the approach so far, open questions).
Don't summarise it away — the interviewer only knows what's in this field plus
the repo.

Then open the room for the user and stop — the session continues in the
browser without you:

```sh
open "https://jgrilling.local/g/<key>"
```

If the request fails, the app probably isn't running:
`cd ~/code/anyway/jsuite && ./jsuite status` then `./jsuite start`.

## Read the results back

When the user says the grilling is done (or asks you to act on it):

```sh
curl -sk https://jgrilling.local/api/sessions/<key>
```

The session JSON holds every question, recommendation and answer (`turns`),
claude's closing `verdict`, and `documentKey` — the debrief in the shared
document pool. Fetch the debrief (decision table, risks, takeaways, chart)
with:

```sh
curl -sk https://jgrilling.local/api/documents/<documentKey>
```

Treat the answers and the debrief as the user's decisions: enact the plan
against them, don't re-litigate settled questions. Sessions are also readable
on disk at `~/code/anyway/jsuite/.data/jgrilling/<key>.json`.
