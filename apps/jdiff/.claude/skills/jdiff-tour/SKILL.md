---
name: jdiff-tour
description: Generate the fine-grained DETAIL walkthrough of a code change for jDiff — 20-40 stops that engage with the actual logic — and POST it back to the jDiff API. Use when "/jdiff-tour <args>" is invoked (jDiff dispatches these into herdr).
disable-model-invocation: true
---

# jdiff-tour — the detail walkthrough of one code change

You were dispatched by jDiff into a herdr session to produce the DETAIL tour
of a change under review. The reviewer already has (or can get) the overview
tour — a 5-20-stop first read that deliberately skims. Your tour is the
opposite altitude: it walks the change at the grain a careful line-by-line
review happens at. You hand it back over jDiff's HTTP API; you never write
files and never modify the repo.

Invocation (single line, key=value):

```
/jdiff-tour number=123 range=origin/main...refs/jdiff/pr-123 head=refs/jdiff/pr-123
/jdiff-tour branch=my-branch base=main range=main...my-branch head=my-branch
```

- `number=` (a PR) or `branch=` + `base=` identify the target; every POST
  below carries the same params (`"number": "123"` or
  `"branch": "...", "base": "..."`).
- `range=` is the exact `git diff` range; `head=` is the ref holding the new
  version of the files. jDiff fetched these before dispatching — do not fetch.

## 1. Connect first — always

```bash
JDIFF="${JDIFF_URL:-http://localhost:43002}"
REPO="$(pwd)"   # herdr set the cwd to the repo under review
curl -s --max-time 3 -o /dev/null "$JDIFF/" && echo up || echo down
```

If down: tell the user jDiff isn't running
(`cd ~/code/jojo/jsuite && ./jsuite start`) and STOP.

## 2. Read the change — all of it

- `git diff <range>` (per file when large), `git log <range>`,
  `git diff --numstat -M <range>`.
- Read/Grep/Glob and `git show <head>:<path>` for the surrounding code a hunk
  doesn't show — callers, tests, the state a condition guards.

The detail tour's whole value is specificity: a note that could have been
written without reading the code is a defect.

## 3. Produce and POST the tour

```bash
curl -s -X POST "$JDIFF/api/review-artifact" -H 'content-type: application/json' -d @- <<'JSON'
{ "repo": "<pwd>", "number": "123", "tool": "tour", "variant": "detail",
  "artifact": {
    "overview": "<2-4 short paragraphs of markdown: what the change does, how it is structured, and what this DETAIL walk covers that a first read would miss>",
    "stops": [
      { "path": "<file path exactly as in the diff>",
        "side": "<RIGHT for lines in the new version (the usual case), LEFT only when pointing at deleted lines>",
        "line": <first line number of the region, in that version of the file>,
        "endLine": <last line number; keep regions under ~25 lines>,
        "title": "<short label, a few words>",
        "note": "<2-4 sentences engaging with the actual logic: what this code does, the edge cases / error paths / interactions worth scrutiny, and precisely what the reviewer should verify>" }
    ] } }
JSON
```

- 20 to 40 stops (jDiff caps at 40), ordered as a narrative through the
  change. Cover what an overview tour skips: the secondary branches, the
  error handling, the tricky conditions, the tests, the mechanical edits
  worth one confirming glance.
- Notes must engage with the logic — name the variables, trace the condition,
  state the invariant. "Updates the handler" is an overview note, not a
  detail note.
- Anchor stops on lines the change actually touches. When the logic demands
  it you MAY anchor on nearby unchanged lines of a touched file (RIGHT side,
  head-version line numbers) — jDiff expands the context to show them.
- Line numbers must be real: count them from the diff hunk headers or read
  the file at `<head>`. Do not guess.

## 4. Sign off — always

```bash
curl -s -X POST "$JDIFF/api/review-complete" -H 'content-type: application/json' -d @- <<'JSON'
{ "repo": "<pwd>", "number": "123", "job": "detail",
  "failures": [ { "tool": "tour", "message": "<only if the tour could not be produced>" } ] }
JSON
```

Omit `failures` (or send `[]`) on a clean run. Then tell the user in one line
that the detail tour is live in jDiff.

## Never

- Never modify the repo — no branches, commits, fetches, or file writes.
- Never end without POSTing the tour or a failure — jDiff shows a spinner
  until one lands.
