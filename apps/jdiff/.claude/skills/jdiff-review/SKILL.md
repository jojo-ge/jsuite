---
name: jdiff-review
description: Run a jDiff review-guidance session — read a code change inside its repo and POST five artifacts (reviewability rating, per-file risk map, guided tour, ask-yourself questions, findings) back to the jDiff API, then report findings to jTicket when a ticket/project context was given. Use when "/jdiff-review <args>" is invoked (jDiff dispatches these into herdr).
disable-model-invocation: true
---

# jdiff-review — generate review guidance for one code change

You were dispatched by jDiff into a herdr session to prepare five pieces of
review guidance for a code change: a reviewability rating, a per-file risk
map, a guided tour, big-picture questions the reviewer must answer for
themselves, and findings — concrete defects you spotted. Everything lands
back in jDiff over its HTTP API; you never write files and never modify the
repo. When a jTicket context was given, the findings are also reported into
jTicket (step 5).

Invocation (single line, key=value):

```
/jdiff-review number=123 range=origin/main...refs/jdiff/pr-123 head=refs/jdiff/pr-123
/jdiff-review branch=my-branch base=main range=main...my-branch head=my-branch
/jdiff-review branch=tick/TICK-12-x base=proj/PROJ-3-y range=... head=... ticket=TICK-12
/jdiff-review branch=proj/PROJ-3-y base=main range=... head=... project=PROJ-3
```

- `number=` (a PR) or `branch=` + `base=` (a local branch) identify the target.
- `range=` is the exact `git diff` range; `head=` is the ref holding the new
  version of the files. jDiff fetched these before dispatching — do not fetch.
- `ticket=` / `project=` are optional jTicket keys: jTicket dispatched this
  review and wants the findings reported back (step 5). `ticket=` means the
  change is one ticket's branch; `project=` means it is the project's
  integration branch. If both somehow appear, `ticket=` wins.

## 0. Connect first — always

```bash
JDIFF="${JDIFF_URL:-http://localhost:43002}"
REPO="$(pwd)"   # herdr set the cwd to the repo under review
curl -s --max-time 3 -o /dev/null "$JDIFF/" && echo up || echo down
```

If down: tell the user jDiff isn't running
(`cd ~/code/jojo/jsuite && ./jsuite start`) and STOP.

Every POST below identifies the target with the same params: `"number": "123"`
for a PR, or `"branch": "my-branch", "base": "main"` for a branch.

## 1. Read the change

You are inside the repository being reviewed. Read the change yourself:

- `git diff <range>` for the whole diff, or `git diff <range> -- <path>` one
  file at a time when it is large.
- `git log <range>` for how the change was built up commit by commit.
- `git diff --numstat -M <range>` for the per-file line counts.
- Read/Grep/Glob and `git show <head>:<path>` for the surrounding code a hunk
  doesn't show — callers of a changed function, the tests that cover it,
  whether a removed branch is dead everywhere.
- Title/description: `gh pr view <number> --json title,body` for a PR;
  `git log -1 --format='%s%n%n%b' <head>` for a branch.

Read enough to be specific. A tour stop or risk rating that could have been
written from the file names alone is not worth showing a reviewer.

## 2. Anchor the rating for consistency

The same diff must always land on the same score. Before rating:

```bash
curl -s "$JDIFF/api/rating?repo=$REPO&number=123"        # or &branch=...
MB=$(git merge-base <left-of-range> <head>)              # range is LEFT...RIGHT
OID=$(git rev-parse "<head>^{commit}")
printf '%s' "$MB..$OID" | shasum -a 256 | cut -d' ' -f1  # this run's diffHash
```

If the saved rating's `diffHash` equals yours, the code has not changed since
that rating: keep its score unless it got a concrete, nameable fact wrong (and
if you do change it, name that fact in a factor). Score churn between
identical runs is a bug, not a judgement call.

## 3. Produce and POST the five artifacts

POST each artifact as soon as it is ready — they save independently, so a
problem with one never costs the others:

```bash
curl -s -X POST "$JDIFF/api/review-artifact" -H 'content-type: application/json' -d @- <<'JSON'
{ "repo": "<pwd>", "number": "123", "tool": "<rating|risk|tour|questions|findings>", "artifact": { ... } }
JSON
```

### rating — how easy is this change to REVIEW (not how good the code is)

Consider: total size, how much is real source vs tests/docs/generated noise,
number of files and how scattered the change is, complexity of the logic in
the diff, renames/moves, whether tests accompany source changes, and anything
risky (migrations, config, security-sensitive code).

```json
{ "score": <integer 1-10, 10 = trivially easy to review>,
  "effort": "<quick|moderate|involved|heavy>",
  "summary": "<one or two sentences a reviewer would want to know before opening the PR>",
  "factors": [
    { "label": "<short factor name>", "impact": "<good|neutral|bad>", "detail": "<one short sentence>" }
  ],
  "readingOrder": [
    { "path": "<file path exactly as in the diff>", "note": "<what this file does in the change and what to check, one short sentence>" }
  ] }
```

Include 3 to 6 factors, most significant first. For readingOrder, list files
in the order a reviewer should read them to understand the change fastest —
start with the file that anchors the change (schema, core logic, interface),
then what depends on it, tests near the source they cover. Omit generated
files, lockfiles, and files too trivial to need a note; at most 20 entries.

Anchor the score to these bands (count only real source-code changes; tests,
docs, and generated files cost far less review effort):

- 9-10 (effort "quick"): under ~50 source lines, one file or one tight concern, nothing risky.
- 7-8 ("quick" or "moderate"): under ~200 source lines in a few files with straightforward logic, or a larger change that is mostly tests/docs/generated noise.
- 5-6 ("moderate"): up to ~500 source lines across a handful of files, ordinary logic changes.
- 3-4 ("involved"): roughly 500-1500 source lines, changes scattered across many files, or risky areas (migrations, auth, concurrency, data handling, error paths).
- 1-2 ("heavy"): thousands of source lines, sweeping refactors, or multiple risky areas at once.

Pick the band from the measurable numbers first (`git diff --numstat`), then
move at most 1 point within the band for judgement calls. The effort field
must agree with the band.

### risk — how much careful review each changed file needs

This is about where mistakes could hide, not code quality. Rate EVERY file in
`git diff --numstat -M <range>` (use the NEW path for renames):

```json
{ "files": [
    { "path": "<file path exactly as in the diff>", "level": "<low|medium|high>", "note": "<one short sentence: why this level, and what to check>" }
  ] }
```

- "high": subtle or risky changes that deserve line-by-line scrutiny — core
  behavior changes, tricky edge cases, concurrency, security-sensitive code,
  data migrations, error handling that could swallow failures.
- "medium": ordinary logic changes to read normally.
- "low": mechanical, generated, formatting-only, docs, or trivially safe
  changes the reviewer can skim.

### tour — a guided walkthrough for a reviewer who has not seen the change

```json
{ "overview": "<2-4 short paragraphs of markdown: what this change does and why, how it is structured, and any concepts the reviewer needs before reading code. Written for someone about to review it, not marketing copy.>",
  "stops": [
    { "path": "<file path exactly as in the diff>",
      "side": "<RIGHT for lines in the new version (the usual case), LEFT only when pointing at deleted lines>",
      "line": <first line number of the region, in that version of the file>,
      "endLine": <last line number; keep regions under ~40 lines>,
      "title": "<short label, a few words>",
      "note": "<1-3 sentences: what this code does in the change, why it is at this point in the tour, and what the reviewer should check>" }
  ] }
```

- 5 to 20 stops, ordered as a narrative: start where the change is anchored
  (schema, core logic, key interface), then follow the consequences outward;
  put tests near the code they cover.
- Anchor every stop on lines the change actually touches, so it lands on
  visible diff lines.
- Cover the parts that matter; skip generated files, lockfiles, and
  repetitive mechanical edits (mention those once in the overview instead).
- Line numbers must be real: count them from the diff hunk headers or read
  the file at `<head>`. Do not guess.

### questions — make the reviewer think critically before signing off

```json
{ "questions": [
    { "topic": "<2-4 word label, e.g. architecture, new pattern, API contract>",
      "question": "<the question, addressed to the reviewer, that they must answer for themselves before approving>",
      "why": "<1-2 sentences on why this matters for this particular change — what is at stake if answered carelessly>" }
  ] }
```

- Exactly 3 questions, and make them the big ones: the architectural direction
  this change commits the codebase to, new patterns / abstractions /
  dependencies it introduces, decisions that will be hard to reverse later,
  changed boundaries or contracts between parts of the system.
- Do NOT ask nitty-gritty code-level questions (naming, style, off-by-one,
  missing null check) — those belong as inline comments on the diff.
- Each question must be specific to this change: name the actual files,
  modules, or concepts involved. No generic checklist filler.
- Ask genuinely open questions a thoughtful reviewer could answer either way —
  the point is to make them form and defend a judgement, not to hint at a
  correct answer.

### findings — concrete defects in the change

Findings are DEFECTS, not guidance: bugs, broken contracts, unhandled errors
or error handling that swallows failures, security or data-loss risks, race
conditions, dead or contradictory logic. Not style, naming, or preferences —
those belong to the other tools. Only report what you can point at in the
diff and defend in one breath.

```json
{ "findings": [
    { "severity": "<high|medium|low>",
      "path": "<file path exactly as in the diff (new path for renames)>",
      "line": <RIGHT-side line number in the head version, or null for a file-level finding>,
      "title": "<short and specific — 'race between X and Y', not 'possible issue'>",
      "detail": "<1-3 sentences: what is wrong, when it bites, what fixing looks like>" }
  ] }
```

- "high": would corrupt data, break the feature, or open a security hole.
- "medium": wrong in a reachable case, or a contract violation that will bite
  the next caller.
- "low": real but minor — an edge case, a misleading fallback, a latent trap.
- An empty list is a good answer. A clean review MUST still POST
  `{ "findings": [] }` — that is how jDiff records "reviewed, nothing found".

## 4. Sign off — always

When all five are posted (or a tool could not be produced):

```bash
curl -s -X POST "$JDIFF/api/review-complete" -H 'content-type: application/json' -d @- <<'JSON'
{ "repo": "<pwd>", "number": "123",
  "failures": [ { "tool": "<rating|risk|tour|questions|findings>", "message": "<why it could not be produced>" } ] }
JSON
```

Omit `failures` (or send `[]`) on a clean run. Then tell the user in one short
message what landed: the score, the riskiest files, how many tour stops, and
how many findings — the artifacts are already live in jDiff.

## 5. Report to jTicket — only when `ticket=` or `project=` was given

Skip this entire step when the invocation carried neither key. After
review-complete:

```bash
JTICKET="${JTICKET_URL:-http://localhost:43000}"
JDIFF_PUBLIC="https://jdiff.local"   # browser link base — matches jTicket's own links
```

If jTicket doesn't answer, say so in your final message and stop — the
findings are already saved in jDiff and nothing is lost.

Build the jDiff deep link once (URL-encode the repo path):
`$JDIFF_PUBLIC/branch-summary?repo=<repo>&branch=<branch>&base=<base>` for the
summary, `$JDIFF_PUBLIC/branch?repo=<repo>&branch=<branch>&base=<base>` for
the diff.

### `ticket=TICK-n` — one comment on the ticket, always (clean or not)

```bash
curl -s -X POST "$JTICKET/api/tickets/TICK-12/comments" -H 'content-type: application/json' -d @- <<JSON
{ "author": "jdiff-review",
  "body": "## jDiff review — \`<branch>\`\n\n<N> finding(s) · [full review](<summary link>)\n\n- **high** \`server/foo.ts:42\` — <title>: <detail>\n- **low** \`app/bar.vue:10\` — <title>: <detail>" }
JSON
```

With zero findings the body is:
`## jDiff review — \`<branch>\`\n\nNo findings — the review came back clean. [full review](<summary link>)`

### `project=PROJ-n` — one fix ticket per finding, deduped

The change is the project's integration branch; findings become dispatchable
fix tickets. Re-running a review must not refile what is already tracked:

1. Fingerprint each finding:
   `printf '%s' "<path>|<lowercased title>" | shasum -a 256 | cut -c1-12`
2. List what exists:
   `curl -s "$JTICKET/api/tickets?projectId=PROJ-3&label=review:finding"`
   SKIP any finding whose fingerprint appears in the description of a ticket
   with status `todo` or `in_progress`. A match on a `done`/`merged` ticket
   means the issue resurfaced — file it again.
3. File the rest, one ticket per finding:

```bash
curl -s -X POST "$JTICKET/api/tickets" -H 'content-type: application/json' -d @- <<JSON
{ "title": "[review] <finding title>",
  "projectId": "PROJ-3",
  "type": "AFK",
  "labels": ["review:finding", "severity:<severity>"],
  "description": "**<severity>** \`<path>:<line>\`\n\n<detail>\n\n[View in jDiff](<diff link>)\n\nfinding-fingerprint: <hash>" }
JSON
```

Zero findings ⇒ file nothing; just say the integration branch came back clean.
End with one line naming what was filed or commented (e.g. "filed 2 fix
tickets in PROJ-3: TICK-31, TICK-32").

## Never

- Never modify the repo — no branches, commits, fetches, or file writes.
  Review guidance is read-only.
- Never skip the review-complete POST, even after a failure — without it jDiff
  keeps showing the run for an hour.
- Never invent line numbers or file paths; the server drops entries that
  don't match the diff.
- Never post anything to jTicket unless the invocation carried `ticket=` or
  `project=`; never create tickets without `project=`; never edit, close, or
  resolve existing jTicket tickets.
