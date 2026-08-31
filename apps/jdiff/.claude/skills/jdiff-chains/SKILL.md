---
name: jdiff-chains
description: The system-chains walkthrough for jDiff — stage=scope decomposes a change into its distinct system chains and POSTs the manifest (jDiff then auto-dispatches one walker session per chain); chain=<slug> walks one chain end-to-end, including unchanged code, and POSTs its tour. Use when "/jdiff-chains <args>" is invoked (jDiff dispatches these into herdr).
disable-model-invocation: true
---

# jdiff-chains — walk a change's system chains

A change is rarely one thing: it is a handful of distinct behaviors, each
threading through several systems (schema → endpoint → store → composable →
component). This skill produces jDiff's CHAINS walkthrough in two kinds of
session, discriminated by the invocation args. You hand everything back over
jDiff's HTTP API; you never write files and never modify the repo.

Invocation (single line, key=value):

```
/jdiff-chains stage=scope number=123 range=origin/main...refs/jdiff/pr-123 head=refs/jdiff/pr-123
/jdiff-chains chain=ask-dispatch-flow number=123 range=origin/main...refs/jdiff/pr-123 head=refs/jdiff/pr-123
/jdiff-chains stage=scope branch=my-branch base=main range=main...my-branch head=my-branch
```

- `stage=scope` — find the chains, POST the manifest, stop.
- `chain=<slug>` — walk exactly that one chain from the saved manifest.
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

## stage=scope — decompose the change into chains

1. Read the whole change: `git diff <range>` (per file when large),
   `git log <range>`, `git diff --numstat -M <range>`; follow key symbols
   outward with Read/Grep and `git show <head>:<path>` until you can say what
   distinct behaviors the change adds or alters.
2. Identify **2 to 8 chains** (jDiff caps at 8). Each chain is one piece of
   behavior traced end-to-end across the systems it touches — not a file
   group, not a layer. A good chain reads as a sentence: "a reviewer clicks
   ask → dispatch endpoint → herdr session → ask-result POST → diff view
   polls it in". Small unrelated leftovers can share one "everything else"
   chain; do not pad the count.
3. POST the manifest:

```bash
curl -s -X POST "$JDIFF/api/review-artifact" -H 'content-type: application/json' -d @- <<'JSON'
{ "repo": "<pwd>", "number": "123", "tool": "chains",
  "artifact": {
    "overview": "<1-2 short markdown paragraphs: how the change decomposes into these chains>",
    "chains": [
      { "id": "<slug, /^[a-z][a-z0-9-]{0,39}$/, unique>",
        "title": "<what this chain does, ≤80 chars>",
        "summary": "<1-3 sentences: the behavior, end to end>",
        "seedPaths": ["<up to 10 files a walker should start from — changed or not>"] }
    ] } }
JSON
```

4. **Do NOT walk the chains yourself.** The moment the manifest lands, jDiff
   dispatches one walker session per chain automatically. Sign off with
   `job: "chains-scope"` (step "Sign off" below) and tell the user in one
   line how many chain walkers jDiff is starting.

## chain=<slug> — walk one chain end-to-end

1. Fetch your chain from the saved manifest (the prompt carries only the
   slug):

```bash
curl -s "$JDIFF/api/chains?repo=$REPO&number=123"   # or &branch=...&base=...
```

   Find your `id` in `.chains[]`; its `title`/`summary`/`seedPaths` are your
   brief. If the manifest or your slug is missing, report that as a failure
   (sign-off below) and stop.

2. Walk the chain: start from the seed paths, follow the behavior end-to-end
   — through the diff AND through the code it plugs into. This tour exists to
   tell the full story, so stops **may and often should land on unchanged
   code**: the existing caller, the store a new endpoint writes, the
   component that renders the result. Read everything you point at
   (`git show <head>:<path>`).

3. POST the chain's tour:

```bash
curl -s -X POST "$JDIFF/api/review-artifact" -H 'content-type: application/json' -d @- <<'JSON'
{ "repo": "<pwd>", "number": "123", "tool": "tour", "variant": "chain:<slug>",
  "artifact": {
    "overview": "<1-2 short markdown paragraphs: this chain's story and where the change sits in it>",
    "stops": [
      { "path": "<file path at <head>>",
        "side": "RIGHT",
        "line": <first line of the region, in the HEAD version of the file>,
        "endLine": <last line; keep regions under ~40 lines>,
        "title": "<short label, a few words>",
        "note": "<1-3 sentences: this link in the chain — what it does, how the previous stop reaches it, and (when it is unchanged code) how the change lands on it>" }
    ] } }
JSON
```

- 5 to 20 stops, ordered along the chain (entry point → consequence), not by
  file. Every stop is `side: "RIGHT"` with **head-version line numbers**
  (`git show <head>:<path>` — count real lines, never guess); jDiff renders
  unchanged files and regions read-only around your stops.
- Say explicitly in the note when a stop is context rather than change —
  the reviewer should always know which links of the chain this PR forged.

## Sign off — always (both stages)

```bash
curl -s -X POST "$JDIFF/api/review-complete" -H 'content-type: application/json' -d @- <<'JSON'
{ "repo": "<pwd>", "number": "123", "job": "<chains-scope | chain:<slug>>",
  "failures": [ { "tool": "<chains|tour>", "message": "<only if the artifact could not be produced>" } ] }
JSON
```

Omit `failures` (or send `[]`) on a clean run.

## Never

- Never modify the repo — no branches, commits, fetches, or file writes.
- Scope sessions never walk chains; walker sessions never re-scope or touch
  another chain's slug.
- Never end without POSTing your artifact or a failure — jDiff shows the
  chain as pending until one lands.
