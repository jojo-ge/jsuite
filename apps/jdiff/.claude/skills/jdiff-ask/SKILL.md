---
name: jdiff-ask
description: Answer a jDiff reviewer's preset question about one specific line of a code change, grounded in the repo, and POST the answer back to the jDiff API. Use when "/jdiff-ask <args>" is invoked (jDiff dispatches these into herdr).
disable-model-invocation: true
---

# jdiff-ask — answer one question about one line of a change

You were dispatched by jDiff into a herdr session to help a code reviewer
understand one specific line of a change under review. You answer exactly one
preset question, grounded in this repository's actual code, and hand the
answer back over jDiff's HTTP API. You never write files and never modify the
repo.

Invocation (single line, key=value; `path` is quoted):

```
/jdiff-ask number=123 range=origin/main...refs/jdiff/pr-123 head=refs/jdiff/pr-123 path="src/thing.ts" line=42 side=RIGHT question=how
/jdiff-ask branch=my-branch base=main range=main...my-branch head=my-branch path="src/thing.ts" line=42 side=LEFT question=risks
```

- `number=` (a PR) or `branch=` + `base=` identify the target; every POST
  below carries the same params (`"number": "123"` or
  `"branch": "...", "base": "..."`).
- `side=RIGHT` means line N of the NEW version of the file (read it from
  `<head>`); `side=LEFT` means the OLD version (read it from the left side of
  `range` — the base, not the working tree).

## The questions

`question=` picks one of these. Keep this table in sync with
`apps/jdiff/app/utils/askQuestions.ts` — jDiff validates the id on POST.

| id | the reviewer is asking |
| --- | --- |
| `how` | Explain how this code works: what it does, what calls it, and what it depends on. Just the essentials — skip anything obvious from reading the line itself. |
| `new-system` | Is this change introducing a brand-new system, pattern, or abstraction to the codebase, or does it extend something that already exists? If it builds on existing code, point at where that lives. |
| `teach` | Teach me about this code as if I were new to this part of the codebase: the concepts, APIs, and patterns it uses. Only the background I actually need to review it — keep it tight. |
| `why` | Why might the author have written it this way? Name the strongest alternative and the trade-off versus what was chosen — no exhaustive survey. |
| `risks` | What are the real risks and edge cases around this line — inputs, states, or callers that could make it misbehave? List only plausible ones, not hypotheticals. |

## 1. Connect first — always

```bash
JDIFF="${JDIFF_URL:-http://localhost:43002}"
REPO="$(pwd)"   # herdr set the cwd to the repo under review
curl -s --max-time 3 -o /dev/null "$JDIFF/" && echo up || echo down
```

If down: tell the user jDiff isn't running
(`cd ~/code/jojo/jsuite && ./jsuite start`) and STOP.

## 2. Gather context, then answer

- The line itself, in the right version of the file:
  `git show <head>:<path>` (RIGHT) or `git show <left-of-range>:<path>` (LEFT),
  with ~25 lines of surrounding context.
- What the change does to that file: `git diff <range> -- <path>`.
- Whatever else the question needs — Read/Grep/Glob for callers, tests,
  sibling implementations. Ground every claim in code you actually looked at.

Answer the question directly. Be brief and to the point: lead with the
answer, use a few tight sentences or bullets, and stop as soon as the
question is answered. No preamble, no headings, no restating the context, no
closing summary. Plain markdown.

## 3. POST the answer — always

```bash
curl -s -X POST "$JDIFF/api/ask-result" -H 'content-type: application/json' -d @- <<'JSON'
{ "repo": "<pwd>", "number": "123",
  "path": "<path>", "line": <line>, "side": "<LEFT|RIGHT>",
  "question": "<question id>", "answer": "<your markdown answer>" }
JSON
```

The diff view is polling for this — until it lands the reviewer sees a
spinner. Then tell the user in one line that the answer is on the line in
jDiff.

## Never

- Never modify the repo — no branches, commits, fetches, or file writes.
- Never answer a different question than the id given, and never invent a new
  question id.
- Never end without POSTing — a session that answers only in the terminal
  leaves the reviewer's spinner hanging.
