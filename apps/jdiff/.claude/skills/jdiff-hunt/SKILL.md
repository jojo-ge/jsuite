---
name: jdiff-hunt
description: The bug-and-vulnerability hunt for jDiff — stage=scope reviews a change adversarially and POSTs the manifest of every defect it finds (jDiff then auto-dispatches one walkthrough session per HIGH issue); issue=<slug> walks one high-severity issue end-to-end and POSTs the tour that explains it in depth. Use when "/jdiff-hunt <args>" is invoked (jDiff dispatches these into herdr).
disable-model-invocation: true
---

# jdiff-hunt — find the bugs, then explain them in depth

The other walkthroughs explain what a change *does*. This one assumes the
change is wrong and goes looking for proof: logic bugs, broken invariants,
and security vulnerabilities. It runs in two kinds of session, discriminated
by the invocation args. You hand everything back over jDiff's HTTP API; you
never write files, never modify the repo, and **never fix anything** — a fix
belongs to the human reading your report.

Invocation (single line, key=value):

```
/jdiff-hunt stage=scope number=123 range=origin/main...refs/jdiff/pr-123 head=refs/jdiff/pr-123
/jdiff-hunt issue=missing-repo-check number=123 range=origin/main...refs/jdiff/pr-123 head=refs/jdiff/pr-123
/jdiff-hunt stage=scope branch=my-branch base=main range=main...my-branch head=my-branch
```

- `stage=scope` — hunt for issues, POST the manifest, stop.
- `issue=<slug>` — walk exactly that one issue from the saved manifest.
- `number=` (a PR) or `branch=` + `base=` identify the target; every POST
  below carries the same params. `range=` is the exact `git diff` range;
  `head=` holds the new files. jDiff fetched these before dispatching — do
  not fetch.

## 0. Connect first — always (both stages)

```bash
JDIFF="${JDIFF_URL:-http://localhost:43002}"
REPO="$(pwd)"   # herdr set the cwd to the repo under review
curl -s --max-time 3 -o /dev/null "$JDIFF/" && echo up || echo down
```

If down: tell the user jDiff isn't running
(`cd ~/code/jojo/jsuite && ./jsuite start`) and STOP.

## stage=scope — review the change for defects

1. Read the whole change: `git diff <range>` (per file when large),
   `git log <range>`, `git diff --numstat -M <range>`. Then read *outward*
   with Read/Grep and `git show <head>:<path>` — most real defects are
   invisible in the hunk and only show up in the caller, the other branch of
   the state machine, or the test that no longer covers the path.

2. Hunt along these lines, and stay concrete:

   - **Logic** — off-by-one, inverted condition, wrong default, a case the
     new branch silently drops, an early return that skips cleanup.
   - **State & lifecycle** — races between an await and the state it read,
     stale caches, listeners never torn down, partial writes on failure.
   - **Contracts** — a caller this change breaks, a return shape that widened
     to include null/undefined, an error now swallowed, a type assertion
     standing in for a real check.
   - **Input handling** — unvalidated user/agent input reaching a command,
     path, query, template or `eval`; injection (shell, SQL, prompt), path
     traversal, SSRF, unsafe deserialization, `v-html`/`innerHTML` on
     untrusted content.
   - **AuthZ & exposure** — a route or capability that lost its check, an id
     trusted from the client, secrets in logs/responses/URLs, a new file or
     endpoint that widens what a caller can reach.
   - **Resource safety** — unbounded input, missing timeouts, recursion on
     user-shaped data.

3. Judge severity honestly — the whole feature rests on it, because **HIGH is
   what gets a walkthrough**:

   - `high` — you can name the input and the path that makes it go wrong, and
     the consequence is real (wrong data, crash, a boundary crossed).
   - `medium` — a defect that needs an unusual precondition, or whose blast
     radius is contained.
   - `low` — a smell, a latent trap, a missing guard nothing exercises today.

   Do NOT pad the list and do NOT inflate severity to get a walkthrough. A
   hunt that finds nothing is a real, valuable result: POST an empty
   `issues` array. Guessing costs the reviewer more than silence.

4. POST the manifest (every issue, worst first — jDiff keeps 12):

```bash
curl -s -X POST "$JDIFF/api/review-artifact" -H 'content-type: application/json' -d @- <<'JSON'
{ "repo": "<pwd>", "number": "123", "tool": "hunt",
  "artifact": {
    "overview": "<1-2 short markdown paragraphs: what you hunted through, and the shape of what you found (or that it came back clean)>",
    "issues": [
      { "id": "<slug, /^[a-z][a-z0-9-]{0,39}$/, unique>",
        "severity": "<high|medium|low>",
        "kind": "<bug|vulnerability>",
        "title": "<the defect in one line, ≤120 chars>",
        "summary": "<1-3 sentences: the input or state that triggers it, and what goes wrong>",
        "path": "<file path exactly as in the diff, where the defect lives>",
        "line": <RIGHT-side line number in the head version, or null>,
        "seedPaths": ["<up to 10 files a walkthrough should start from — the entry point, the missing guard, the sink>"] }
    ] } }
JSON
```

5. **Do NOT walk the issues yourself.** The moment the manifest lands, jDiff
   dispatches one walkthrough session per HIGH issue automatically. Sign off
   with `job: "hunt-scope"` (step "Sign off" below) and tell the user in one
   line what you found and how many walkthroughs jDiff is starting.

## issue=<slug> — explain one high-severity issue in depth

1. Fetch your issue from the saved manifest (the prompt carries only the
   slug):

```bash
curl -s "$JDIFF/api/hunt?repo=$REPO&number=123"   # or &branch=...&base=...
```

   Find your `id` in `.issues[]`; its `title`/`summary`/`path`/`seedPaths`
   are your brief. If the manifest or your slug is missing, report that as a
   failure (sign-off below) and stop.

2. **Verify before you explain.** Re-derive the defect from the code
   yourself: read the sink, the guards that should have stopped it, the
   callers that reach it, the tests that were supposed to cover it. If the
   evidence does not hold up — the guard exists elsewhere, the input can't
   actually reach it, the caller already validates — say so plainly in the
   tour's overview and make the stops show *why* it is not exploitable. A
   walkthrough that quietly argues for a defect it disproved is worse than
   no walkthrough.

3. POST the walkthrough as this issue's tour:

```bash
curl -s -X POST "$JDIFF/api/review-artifact" -H 'content-type: application/json' -d @- <<'JSON'
{ "repo": "<pwd>", "number": "123", "tool": "tour", "variant": "issue:<slug>",
  "artifact": {
    "overview": "<2-4 short markdown paragraphs: what the defect is, the exact input or sequence that triggers it, what it costs, and — if you disproved it — why it does not hold>",
    "stops": [
      { "path": "<file path at <head>>",
        "side": "RIGHT",
        "line": <first line of the region, in the HEAD version of the file>,
        "endLine": <last line; keep regions under ~40 lines>,
        "title": "<short label, a few words>",
        "note": "<1-3 sentences: this link in the defect's story — where the bad value enters, which check fails to stop it, where it does damage>" }
    ] } }
JSON
```

- 5 to 20 stops, ordered as the defect happens (entry → missing guard →
  sink → consequence), not by file. Every stop is `side: "RIGHT"` with
  **head-version line numbers** (`git show <head>:<path>` — count real lines,
  never guess); jDiff renders unchanged files read-only around your stops.
- Stops may and often should land on **unchanged code** — the guard that
  isn't there, the caller that passes the value in. Say in the note which
  stops are the change and which are the ground it landed on.
- Close with what a fix has to satisfy, in the last stop's note or the
  overview. Do not write the fix, and do not touch the repo.

## Sign off — always (both stages)

```bash
curl -s -X POST "$JDIFF/api/review-complete" -H 'content-type: application/json' -d @- <<'JSON'
{ "repo": "<pwd>", "number": "123", "job": "<hunt-scope | issue:<slug>>",
  "failures": [ { "tool": "<hunt|tour>", "message": "<only if the artifact could not be produced>" } ] }
JSON
```

Omit `failures` (or send `[]`) on a clean run.

## Never

- Never modify the repo — no branches, commits, fetches, or file writes, and
  no fixes: this skill reports defects, it does not repair them.
- Never write a working exploit. Explain the path and the consequence; that
  is what a reviewer needs.
- Scope sessions never walk issues; walkthrough sessions never re-hunt or
  touch another issue's slug.
- Never inflate a severity to earn a walkthrough, and never end without
  POSTing your artifact or a failure — jDiff shows the issue as pending until
  one lands.
