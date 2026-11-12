---
name: jdiff-tour
description: Write the DETAIL guided tour of a diff for jTicket's Diff tab (20–40 stops that engage with the actual logic) and POST it back to jTicket. Use when "/jdiff-tour [args]" is invoked (the Diff tab's Build tour button dispatches it into herdr).
disable-model-invocation: true
argument-hint: 'project=PROJ-n target={…} range=BASE...HEAD head=HEAD'
---

# jdiff-tour — the detail walkthrough of one diff

jTicket's Diff tab dispatched you into herdr to write the **detail tour** of
one diff: a walk at the grain a careful line-by-line review happens at. The
human walks it in the tab's floating tour bar, stop by stop. You read the
code and hand the tour back over jTicket's API; the repo stays exactly as you
found it.

Invocation (single line, key=value):

```
/jdiff-tour project=PROJ-81 target={"pr":"PR-12"} range=3f2a…...9c1d… head=9c1d…
```

- `project=` is the jTicket project whose Diff tab asked.
- `target=` is a JSON object naming the Diff tab target (`{"pr":"PR-n"}`,
  `{"gh":"123"}`, `{"head":"…","base":"…"}` or `{}` for the project's own
  branch). Copy its fields verbatim into every POST below.
- `range=` is the exact `git diff` range (base commit `...` head commit);
  `head=` is the commit holding the new version of the files. Both are
  already in the clone.

## 1. Connect first — always

```bash
jt projects >/dev/null && echo up || echo down
```

`jt` reaches jTicket (it honours `$JTICKET_URL`, which a sandbox sets). If it
is down, say jTicket isn't running and stop.

## 2. Read the change — all of it

- `git diff <range>` (per file when large), `git log <range>`,
  `git diff --numstat -M <range>`.
- Read/Grep/Glob and `git show <head>:<path>` for the code a hunk doesn't
  show: callers, tests, the state a condition guards.

The tour's whole value is specificity: a note that could have been written
without reading the code is a defect.

## 3. Write and POST the tour

```bash
jt post /api/projects/<project>/diff/tour/artifact - <<'JSON'
{ <target fields, e.g. "pr": "PR-12">,
  "head": "<the head= commit you were given, in full>",
  "artifact": {
    "overview": "<2-4 short paragraphs of markdown: what the change does, how it is structured, and what this walk covers that a first read would miss>",
    "stops": [
      { "path": "<file path exactly as in the diff>",
        "side": "<RIGHT for lines in the new version (the usual case), LEFT only for deleted lines>",
        "line": <first line of the region, in that version of the file>,
        "endLine": <last line; keep regions under ~25 lines>,
        "title": "<short label, a few words>",
        "note": "<2-4 sentences engaging with the logic: what this code does, the edge cases / error paths / interactions worth scrutiny, and precisely what the reader should verify>" }
    ] } }
JSON
```

- 20 to 40 stops (jTicket keeps the first 40), ordered as a narrative through
  the change. Cover the secondary branches, the error handling, the tricky
  conditions, the tests, and the mechanical edits worth one confirming glance.
- Notes name the variables, trace the condition, state the invariant.
- Anchor stops on lines the change touches. When the logic demands it, anchor
  on nearby unchanged lines of a touched file (RIGHT side, head-version line
  numbers): the Diff tab expands the hidden context to show them.
- Line numbers are real: count them from the hunk headers or read the file at
  `<head>`.

- `"head"` is how the Diff tab knows which commit the tour describes: when
  the target moves on, it warns the reader the tour is out of date.

A 400 names what was wrong with the shape; fix it and POST again.

## 4. Sign off — always

```bash
jt post /api/projects/<project>/diff/tour/complete - <<'JSON'
{ <target fields>, "failures": [ { "message": "<only if the tour could not be produced>" } ] }
JSON
```

Send `"failures": []` on a clean run. Then say in one line that the tour is
live on the Diff tab.

## Guardrails

- Read-only on the repo: no branches, commits, fetches or file writes.
- Every run ends with the tour POSTed or a failure reported — the Diff tab
  shows a spinner until one lands.
